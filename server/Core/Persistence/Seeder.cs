using System.Text.Json;
using Aurora.Core.Adt;
using Aurora.Core.Ai;
using Aurora.Core.Identity;
using Aurora.Core.MasterData;
using Aurora.Core.Orders;
using Aurora.Core.LabImaging;
using Aurora.Core.Shared;
using Aurora.Modules.Icu.Roster;
using Microsoft.EntityFrameworkCore;

namespace Aurora.Core.Persistence;

/* create + seed the database at startup if empty. Seed JSON files are
   GENERATED from the frontend mock stores (see each domain's notes) —
   never hand-edit them. The roster block reads Modules.Icu.Roster types:
   part of the sanctioned temporary seam documented on AuroraDb.

   PERSISTENCE REGIME (Stage 10 — database persistence):
   - Postgres: Database.Migrate() applies the EF Core migrations
     (Core/Persistence/Migrations — generated in the FINAL relocated
     namespaces), then the seed-if-empty blocks below fill an empty
     database once. Writes SURVIVE restarts/redeploys from here on;
     schema changes are new migrations, never a reseed.
   - SQLite demo fallback (no DATABASE_URL): the ORIGINAL ephemeral
     regime — rebuild + reseed every boot. Local demo only (production
     refuses it — BootGuards T2).

   SEED MODES (environment-separation §11 step 2):
   - development / staging: the full demo set, exactly as always — the
     14 demo patients, demo staff with the shared demo password,
     clinical seed data, the active reference formulary. Byte-identical
     to the pre-split seeding.
   - production: NO demo patients, NO demo staff, NO shared password.
     Only (a) non-hospital-specific reference data — beds as starting
     configuration the hospital adjusts at install, the frequency
     vocabulary, interaction rules, the lab catalogue, order sets — and
     the formulary per the FORMULARY_SEED install policy ("starter" =
     seeded DEACTIVATED so it is structurally unprescribable until
     Pharmacy validates by reactivating; "empty" = none, the hospital
     imports its own through the Layer 4 screen); (b) the reserved
     system principal; and (c) ONE bootstrap administrator whose
     credential is supplied at provision time (ADMIN_BOOTSTRAP_PASSWORD
     — never hardcoded, never the demo password, rotated via Layer 3
     after first login). Clinical tables start EMPTY: the first
     clinical row arrives through the UI by an authenticated
     individual. */
static class Seeder
{
    public static void SeedAll(WebApplication app, string demoPassword, string dbLabel)
    {
        using var scope = app.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AuroraDb>();
        if (db.Database.IsNpgsql())
        {
            db.Database.Migrate();
        }
        else
        {
            /* EPHEMERAL demo mode — every write is lost on restart. The DB
               is a startup-built cache rebuilt every boot so the demo never
               needs migrations against a stale file. (Unreachable in
               production: T2 refuses to boot without DATABASE_URL.) */
            app.Logger.LogWarning(
                "DATABASE_URL is not set — running the EPHEMERAL SQLite demo mode ({Db}): all writes are lost on restart. Set DATABASE_URL (Postgres) for durable persistence.",
                dbLabel);
            db.Database.EnsureDeleted();
            db.Database.EnsureCreated();
        }

        if (BootGuards.Production) SeedProduction(app, db);
        else SeedDemo(app, db, demoPassword, dbLabel);

        /* ENCOUNTER-SCOPE BACKFILL (one-time, idempotent — the ORD-113
           fix): resolve EncounterId for any order that has none (seeds
           carry none; the create path stores it from here on) and restore
           the invariant for orders whose encounter closed before it
           existed. See OrderLogic.BackfillEncounterScope for the rule.
           (No-op on an empty production database.) */
        var (scoped2, restored) = OrderLogic.BackfillEncounterScope(db);
        if (scoped2 > 0 || restored > 0)
            app.Logger.LogInformation(
                "Encounter-scope backfill: {Scoped} orders scoped to their encounter, {Restored} auto-discontinued (closed encounter)",
                scoped2, restored);

        /* RESULT AUDIT BACKFILL (one-time, idempotent — results audit PR):
           scope EncounterId for results that predate result scoping (same
           rule as orders) and RESTRUCTURE existing acknowledgments into
           the append-only event history from their own stored actor/time
           fields — never invented. See ResultsLogic.BackfillResultAudit. */
        var (rScoped, restructured) = ResultsLogic.BackfillResultAudit(db);
        if (rScoped > 0 || restructured > 0)
            app.Logger.LogInformation(
                "Result-audit backfill: {Scoped} results scoped to their encounter, {Restructured} existing acknowledgments restructured into event history",
                rScoped, restructured);

        /* resume the generated-id counters from the persisted data — on a
           fresh database this resolves to the historical floors, so
           first-boot behavior is unchanged (see OrderLogic notes) */
        OrderLogic.InitializeCounters(db);
        AdtLogic.InitializeCounters(db);
        ResultsLogic.InitializeCounters(db);
        Aurora.Core.Assignments.AssignmentLogic.InitializeCounters(db);
        Aurora.Core.Observations.ObservationCatalog.InitializeCounters(db);
    }

    /* ---- development / staging: the full demo set, unchanged ---- */
    static void SeedDemo(WebApplication app, AuroraDb db, string demoPassword, string dbLabel)
    {
        if (!db.Patients.Any())
        {
            var seedPath = Path.Combine(AppContext.BaseDirectory, "Data", "roster-seed.json");
            var records = JsonSerializer.Deserialize<List<RosterRecordDto>>(
                File.ReadAllText(seedPath), JsonOpts.Web)!;
            db.Patients.AddRange(records.Select(PatientRow.FromDto));
            db.SaveChanges();
            app.Logger.LogInformation("Seeded {Count} roster records into {Db}", records.Count, dbLabel);
        }
        if (!db.Users.Any())
        {
            var seedPath = Path.Combine(AppContext.BaseDirectory, "Data", "users-seed.json");
            var staff = JsonSerializer.Deserialize<List<UserSeedDto>>(
                File.ReadAllText(seedPath), JsonOpts.Web)!;
            /* one hash per user (same demo password, distinct salts — hashes
               must never reveal that two users share a password) */
            db.Users.AddRange(staff.Select(s => new UserRow
            {
                Username = s.Username,
                Name = s.Name,
                JobTitle = s.JobTitle,
                RolesJson = JsonSerializer.Serialize(new[] { s.JobTitle }, JsonOpts.Web),
                PasswordHash = BCrypt.Net.BCrypt.HashPassword(demoPassword, workFactor: 10),
            }));
            db.SaveChanges();
            app.Logger.LogInformation("Seeded {Count} user accounts", staff.Count);
        }
        SeedSystemPrincipal(app, db);
        if (!db.LabDraws.Any())
        {
            var labs = JsonSerializer.Deserialize<List<LabDrawDto>>(
                File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Data", "labs-seed.json")), JsonOpts.Web)!;
            var imaging = JsonSerializer.Deserialize<List<ImagingStudyDto>>(
                File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Data", "imaging-seed.json")), JsonOpts.Web)!;
            db.LabDraws.AddRange(labs.Select(LabDrawRow.FromDto));
            db.ImagingStudies.AddRange(imaging.Select(ImagingStudyRow.FromDto));
            db.SaveChanges();
            app.Logger.LogInformation("Seeded {Labs} lab draws + {Imaging} imaging studies", labs.Count, imaging.Count);
        }
        if (!db.Orders.Any())
        {
            var orders = JsonSerializer.Deserialize<List<OrderDto>>(
                File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Data", "orders-seed.json")), JsonOpts.Web)!;
            db.Orders.AddRange(orders.Select((o, i) => OrderRow.FromDto(o, i + 1)));
            db.SaveChanges();
            app.Logger.LogInformation("Seeded {Count} orders", orders.Count);
        }
        if (!db.AiRisks.Any())
        {
            var profiles = JsonSerializer.Deserialize<List<AiProfileDto>>(
                File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Data", "ai-seed.json")), JsonOpts.Web)!;
            db.AiRisks.AddRange(profiles.Select((p, i) => AiRiskRow.FromDto(p, i + 1)));
            db.SaveChanges();
            app.Logger.LogInformation("Seeded {Count} AI risk profiles", profiles.Count);
        }

        /* Layer 2 ADT (Aurora Core): Patients + open Encounters are derived
           at boot from the SAME roster-seed.json the bedside table uses —
           one source, zero drift between the module snapshot and the Core
           identity/encounter records. Seed encounter ids map 1:1 to seed
           patients (P-1001 → ENC-1001); historical seeds carry no admission
           time. Beds come from Data/beds-seed.json (GENERATED from
           src/lib/api/data/beds.ts BED_LAYOUT — never hand-edit). */
        if (!db.AdtPatients.Any())
        {
            var records = JsonSerializer.Deserialize<List<RosterRecordDto>>(
                File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Data", "roster-seed.json")), JsonOpts.Web)!;
            db.AdtPatients.AddRange(records.Select(r => new Patient
            {
                PatientId = r.PatientId, Mrn = r.Mrn, Name = r.Name,
                Age = r.Age, Sex = r.Sex, Allergies = r.Allergies,
            }));
            db.Encounters.AddRange(records.Select(r => new Encounter
            {
                EncounterId = $"ENC-{r.PatientId[(r.PatientId.IndexOf('-') + 1)..]}",
                PatientId = r.PatientId, BedId = r.BedId, Diagnosis = r.Diagnosis,
                Attending = r.Attending, Status = "open",
                AdmittedAt = "", AdmittedBy = "", EventsJson = "[]",
            }));
            db.SaveChanges();
            app.Logger.LogInformation("Seeded {Count} ADT patients + open encounters", records.Count);
        }
        SeedBeds(app, db);
        SeedDemoAssignments(app, db);

        /* Layer 4 Master Data (Aurora Core): the formulary, the named
           frequency vocabulary (moved from OrderLogic's hardcoded array),
           and the interaction rules — all GENERATED from
           src/lib/api/data/formulary.ts (never hand-edit the seeds).
           Seed rows carry empty audit histories (historical data — the
           ADT convention: facts are never invented). */
        if (!db.FormularyDrugs.Any())
        {
            var drugs = JsonSerializer.Deserialize<List<FormularyDrugDto>>(
                File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Data", "formulary-seed.json")), JsonOpts.Web)!;
            db.FormularyDrugs.AddRange(drugs.Select((d, i) => FormularyDrugRow.FromDto(d, i + 1)));
            db.SaveChanges();
            app.Logger.LogInformation("Seeded {Count} formulary drugs", drugs.Count);
        }
        SeedFrequencies(app, db);
        SeedInteractions(app, db);
        SeedLabCatalog(app, db);
        SeedOrderSets(app, db);
        SeedObservationCatalog(app, db);
    }

    /* Patient Assignment & Responsibility (§10): the DEMO assignments the
       retired client fixtures claimed — RN Maya Chen on P-1001/P-1004,
       Dr. Rahman's six-patient panel (incl. cross-cover) — so the demo
       workspaces stay populated and the suites stay meaningful. STAGING/
       DEV ONLY (production seeds none: existing open encounters start
       honestly UNASSIGNED and appear in the Unassigned panel until a real
       person assigns them). Guarded per encounter: a seed assignment is
       only created where the encounter is still OPEN at seed time (on a
       long-lived staging database some seed encounters may have closed —
       an active assignment on a closed episode would violate the
       lifecycle rule). Seed rows carry empty audit stamps (historical
       data — the ADT AdmittedAt convention: facts are never invented). */
    static void SeedDemoAssignments(WebApplication app, AuroraDb db)
    {
        if (db.Assignments.Any()) return;
        var demo = new (string EncounterId, string UserId, string Kind)[]
        {
            ("ENC-1001", "maya.chen", "nurse"), ("ENC-1004", "maya.chen", "nurse"),
            ("ENC-1001", "sara.rahman", "doctor"), ("ENC-1004", "sara.rahman", "doctor"),
            ("ENC-1007", "sara.rahman", "doctor"), ("ENC-1008", "sara.rahman", "doctor"),
            ("ENC-1012", "sara.rahman", "doctor"), ("ENC-1013", "sara.rahman", "doctor"),
        };
        var open = db.Encounters.AsNoTracking()
            .Where(e => e.Status == "open").Select(e => e.EncounterId).ToHashSet();
        var seq = 0;
        var rows = demo.Where(d => open.Contains(d.EncounterId))
            .Select(d => new Aurora.Core.Assignments.PatientAssignment
            {
                AssignmentId = $"ASG-{1001 + seq}",
                Seq = ++seq,
                EncounterId = d.EncounterId, UserId = d.UserId, Kind = d.Kind,
                Role = "primary", Shift = "day",
                AssignedAt = "", AssignedBy = "", AssignedByRole = "",
            }).ToList();
        if (rows.Count == 0) return;
        db.Assignments.AddRange(rows);
        db.SaveChanges();
        app.Logger.LogInformation("Seeded {Count} demo patient assignments (open encounters only)", rows.Count);
    }

    /* ---- production: reference data + bootstrap admin ONLY ---- */
    static void SeedProduction(WebApplication app, AuroraDb db)
    {
        app.Logger.LogInformation(
            "PRODUCTION seed mode: no demo patients, no demo staff, no shared password — reference data + bootstrap administrator only; clinical tables start empty");
        SeedBeds(app, db);
        SeedFrequencies(app, db);
        SeedInteractions(app, db);
        SeedLabCatalog(app, db);
        SeedOrderSets(app, db);
        SeedObservationCatalog(app, db);
        SeedProductionFormulary(app, db);
        SeedSystemPrincipal(app, db);
        SeedBootstrapAdmin(app, db);
    }

    /* Stage 11 §12 step 1: the Observation Type Catalogue — the §1
       clinical taxonomy as DATA (both modes: non-hospital-specific
       clinical reference, the lab-catalogue precedent). Idempotent
       seed-if-empty per table; the Devices group ships disabled. */
    static void SeedObservationCatalog(WebApplication app, AuroraDb db)
    {
        var hadGroups = db.ObservationGroups.Any();
        Aurora.Core.Observations.ObservationCatalog.Seed(db);
        if (!hadGroups)
            app.Logger.LogInformation(
                "Seeded the Observation Type Catalogue: {Groups} groups, {Types} types (Devices group disabled by default)",
                db.ObservationGroups.Count(), db.ObservationTypes.Count());
    }

    /* the FORMULARY_SEED install policy (validated by T2 before seeding
       ever runs): "starter" seeds the reference formulary with every drug
       DEACTIVATED and an audit event saying why — the existing safety
       enforcement rejects orders for inactive drugs, so unvalidated
       starter content is structurally unprescribable (a mechanism, not a
       label); Pharmacy validates drug-by-drug by REACTIVATING through
       the Layer 4 formulary screen, which is also how an operator
       supplies real formulary content in "empty" mode: the screen's
       existing create/edit flow, not seed files. */
    static void SeedProductionFormulary(WebApplication app, AuroraDb db)
    {
        var mode = Environment.GetEnvironmentVariable("FORMULARY_SEED");
        if (mode == "empty")
        {
            app.Logger.LogInformation("FORMULARY_SEED=empty — no formulary seeded; Pharmacy builds it through the formulary screen");
            return;
        }
        if (db.FormularyDrugs.Any()) return;
        var drugs = JsonSerializer.Deserialize<List<FormularyDrugDto>>(
            File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Data", "formulary-seed.json")), JsonOpts.Web)!;
        var stamp = JsonSerializer.Serialize(new List<FormularyEventDto>
        {
            new(FormularyLogic.Now(), "System", "seeded",
                "starter formulary content (deactivated) — requires pharmacy/clinical validation before clinical use: reactivate each drug through the formulary screen after review"),
        }, JsonOpts.Web);
        db.FormularyDrugs.AddRange(drugs.Select((d, i) =>
        {
            var row = FormularyDrugRow.FromDto(d, i + 1);
            row.Active = false;
            row.EventsJson = stamp;
            return row;
        }));
        db.SaveChanges();
        app.Logger.LogInformation(
            "Seeded {Count} STARTER formulary drugs — all DEACTIVATED pending pharmacy validation (unprescribable until reactivated)", drugs.Count);
    }

    /* production's ONE seeded account. The credential is supplied at
       provision time via ADMIN_BOOTSTRAP_PASSWORD — never hardcoded,
       never in the repo or image, refused outright if missing on a
       first boot or if it IS the demo password (T1 would also catch
       that after seeding; refusing here names the mistake precisely).
       Rotation happens through the existing Layer 3 flow after first
       login; the forced-change-on-first-login gate from the approved
       design needs a self-service password-change surface that does not
       exist yet — it rides the bootstrap-moment/install tooling of
       steps 4–5 and is recorded in 02 as such. */
    static void SeedBootstrapAdmin(WebApplication app, AuroraDb db)
    {
        if (db.Users.Any(u => u.Username != "system")) return; // already provisioned
        var pw = Environment.GetEnvironmentVariable("ADMIN_BOOTSTRAP_PASSWORD");
        if (string.IsNullOrWhiteSpace(pw))
            BootGuards.Refuse("MISSING BOOTSTRAP CREDENTIAL",
                "This is a first production boot (no accounts exist) and",
                "ADMIN_BOOTSTRAP_PASSWORD is not set. Production seeds exactly ONE",
                "bootstrap administrator whose credential is supplied at provision time —",
                "set ADMIN_BOOTSTRAP_PASSWORD (shown once to the operator; rotate via user",
                "administration after first login).");
        if (pw == BootGuards.DemoPassword)
            BootGuards.Refuse("T1 — DEMO CREDENTIAL IN PRODUCTION",
                "ADMIN_BOOTSTRAP_PASSWORD is the shared demo password. Production has no",
                "shared credentials — choose a real, individual credential.");
        db.Users.Add(new UserRow
        {
            Username = "admin",
            Name = "Bootstrap Administrator",
            /* User Management design (§5.1): the bootstrap account IS the
               seeded System Administrator — users.manage moved to that
               role, so a Hospital Administrator bootstrap could no longer
               provision accounts. Forced first-login change now applies
               (the §4 surface exists). */
            JobTitle = "System Administrator",
            RolesJson = JsonSerializer.Serialize(new[] { "System Administrator" }, JsonOpts.Web),
            MustChangePassword = true,
            PasswordHash = BCrypt.Net.BCrypt.HashPassword(pw, workFactor: 10),
            EventsJson = JsonSerializer.Serialize(new List<UserEventDto>
            {
                new(UserLogic.Now(), "System", null, "created",
                    "bootstrap administrator — credential supplied at provision time (ADMIN_BOOTSTRAP_PASSWORD, never hardcoded); rotate via user administration after first login; every further account is created individually through Layer 3"),
            }, JsonOpts.Web),
        });
        db.SaveChanges();
        app.Logger.LogInformation("Seeded the bootstrap administrator ('admin') — rotate its credential via user administration after first login");
    }

    /* ---- reference blocks shared by BOTH modes (bodies unchanged) ---- */

    /* Reserved SYSTEM principal (encounter-scoping fix): the audited
       actor for system/lifecycle writes — e.g. the encounter-scope
       backfill's auto-discontinuations — so a reader years from now
       sees a migration, not a clinician's decision. It can NEVER
       authenticate: Active=false (deactivated accounts get the same
       generic 401 with the bcrypt verify still executed — timing
       unchanged) and its hash is a valid bcrypt digest of a random
       GUID discarded here, so no password matches it. JobTitle
       "System" maps to NO permission profile, so even a forged token
       passes no RBAC check. NOT emptiness-gated: the live Users table
       is populated, so this block must be its own idempotent insert.
       UsersApi refuses to edit/reactivate/reset it (reserved). */
    static void SeedSystemPrincipal(WebApplication app, AuroraDb db)
    {
        if (db.Users.Any(u => u.Username == "system")) return;
        db.Users.Add(new UserRow
        {
            Username = "system",
            Name = "System",
            JobTitle = "System",
            RolesJson = "[\"System\"]",
            PasswordHash = BCrypt.Net.BCrypt.HashPassword(Guid.NewGuid().ToString(), workFactor: 10),
            Active = false,
            EventsJson = JsonSerializer.Serialize(new List<UserEventDto>
            {
                new(UserLogic.Now(), "System", null, "created",
                    "reserved system principal — records system/migration actions in audit trails; can never authenticate"),
            }, JsonOpts.Web),
        });
        db.SaveChanges();
        app.Logger.LogInformation("Seeded the reserved 'system' principal (inactive — never authenticates)");
    }

    static void SeedBeds(WebApplication app, AuroraDb db)
    {
        if (db.Beds.Any()) return;
        var beds = JsonSerializer.Deserialize<List<BedSeedDto>>(
            File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Data", "beds-seed.json")), JsonOpts.Web)!;
        db.Beds.AddRange(beds.Select((b, i) => new BedRow { BedId = b.BedId, Area = b.Area, Seq = i + 1 }));
        db.SaveChanges();
        app.Logger.LogInformation("Seeded {Count} beds", beds.Count);
    }

    static void SeedFrequencies(WebApplication app, AuroraDb db)
    {
        if (db.NamedFrequencies.Any()) return;
        var freqs = JsonSerializer.Deserialize<List<string>>(
            File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Data", "frequencies-seed.json")), JsonOpts.Web)!;
        db.NamedFrequencies.AddRange(freqs.Select((v, i) => new NamedFrequencyRow { Value = v, Seq = i + 1 }));
        db.SaveChanges();
        app.Logger.LogInformation("Seeded {Count} named frequencies", freqs.Count);
    }

    static void SeedInteractions(WebApplication app, AuroraDb db)
    {
        if (db.InteractionRules.Any()) return;
        var rules = JsonSerializer.Deserialize<List<InteractionRuleDto>>(
            File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Data", "interactions-seed.json")), JsonOpts.Web)!;
        db.InteractionRules.AddRange(rules.Select(r => new InteractionRuleRow
        {
            A = r.A, B = r.B, Severity = r.Severity, Note = r.Note,
        }));
        db.SaveChanges();
        app.Logger.LogInformation("Seeded {Count} interaction rules", rules.Count);
    }

    /* Layer 4 phase 2: the lab test catalogue (GENERATED from
       src/lib/api/data/catalog.ts — the panels the seeded labs domain
       already implies, so catalogue and results agree by construction)
       and order sets (GENERATED from formulary.ts ORDER_SET_DEFS). */
    static void SeedLabCatalog(WebApplication app, AuroraDb db)
    {
        if (db.LabTests.Any()) return;
        var tests = JsonSerializer.Deserialize<List<LabTestDto>>(
            File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Data", "labcatalog-seed.json")), JsonOpts.Web)!;
        db.LabTests.AddRange(tests.Select((t, i) => LabTestRow.FromDto(t, i + 1)));
        db.SaveChanges();
        app.Logger.LogInformation("Seeded {Count} lab catalogue tests", tests.Count);
    }

    static void SeedOrderSets(WebApplication app, AuroraDb db)
    {
        if (db.OrderSets.Any()) return;
        var sets = JsonSerializer.Deserialize<List<OrderSetDto>>(
            File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Data", "ordersets-seed.json")), JsonOpts.Web)!;
        db.OrderSets.AddRange(sets.Select((x, i) => OrderSetRow.FromDto(x, i + 1)));
        db.SaveChanges();
        app.Logger.LogInformation("Seeded {Count} order sets", sets.Count);
    }
}

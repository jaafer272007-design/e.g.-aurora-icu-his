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
     regime — rebuild + reseed every boot. Local demo only. */
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
               needs migrations against a stale file. */
            app.Logger.LogWarning(
                "DATABASE_URL is not set — running the EPHEMERAL SQLite demo mode ({Db}): all writes are lost on restart. Set DATABASE_URL (Postgres) for durable persistence.",
                dbLabel);
            db.Database.EnsureDeleted();
            db.Database.EnsureCreated();
        }
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
                PasswordHash = BCrypt.Net.BCrypt.HashPassword(demoPassword, workFactor: 10),
            }));
            db.SaveChanges();
            app.Logger.LogInformation("Seeded {Count} user accounts", staff.Count);
        }
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
        if (!db.Users.Any(u => u.Username == "system"))
        {
            db.Users.Add(new UserRow
            {
                Username = "system",
                Name = "System",
                JobTitle = "System",
                PasswordHash = BCrypt.Net.BCrypt.HashPassword(Guid.NewGuid().ToString(), workFactor: 10),
                Active = false,
                EventsJson = JsonSerializer.Serialize(new List<UserEventDto>
                {
                    new(UserLogic.Now(), "System", "created",
                        "reserved system principal — records system/migration actions in audit trails; can never authenticate"),
                }, JsonOpts.Web),
            });
            db.SaveChanges();
            app.Logger.LogInformation("Seeded the reserved 'system' principal (inactive — never authenticates)");
        }
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
        if (!db.Beds.Any())
        {
            var beds = JsonSerializer.Deserialize<List<BedSeedDto>>(
                File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Data", "beds-seed.json")), JsonOpts.Web)!;
            db.Beds.AddRange(beds.Select((b, i) => new BedRow { BedId = b.BedId, Area = b.Area, Seq = i + 1 }));
            db.SaveChanges();
            app.Logger.LogInformation("Seeded {Count} beds", beds.Count);
        }

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
        if (!db.NamedFrequencies.Any())
        {
            var freqs = JsonSerializer.Deserialize<List<string>>(
                File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Data", "frequencies-seed.json")), JsonOpts.Web)!;
            db.NamedFrequencies.AddRange(freqs.Select((v, i) => new NamedFrequencyRow { Value = v, Seq = i + 1 }));
            db.SaveChanges();
            app.Logger.LogInformation("Seeded {Count} named frequencies", freqs.Count);
        }
        if (!db.InteractionRules.Any())
        {
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
        if (!db.LabTests.Any())
        {
            var tests = JsonSerializer.Deserialize<List<LabTestDto>>(
                File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Data", "labcatalog-seed.json")), JsonOpts.Web)!;
            db.LabTests.AddRange(tests.Select((t, i) => LabTestRow.FromDto(t, i + 1)));
            db.SaveChanges();
            app.Logger.LogInformation("Seeded {Count} lab catalogue tests", tests.Count);
        }
        if (!db.OrderSets.Any())
        {
            var sets = JsonSerializer.Deserialize<List<OrderSetDto>>(
                File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Data", "ordersets-seed.json")), JsonOpts.Web)!;
            db.OrderSets.AddRange(sets.Select((x, i) => OrderSetRow.FromDto(x, i + 1)));
            db.SaveChanges();
            app.Logger.LogInformation("Seeded {Count} order sets", sets.Count);
        }

        /* ENCOUNTER-SCOPE BACKFILL (one-time, idempotent — the ORD-113
           fix): resolve EncounterId for any order that has none (seeds
           carry none; the create path stores it from here on) and restore
           the invariant for orders whose encounter closed before it
           existed. See OrderLogic.BackfillEncounterScope for the rule. */
        var (scoped, restored) = OrderLogic.BackfillEncounterScope(db);
        if (scoped > 0 || restored > 0)
            app.Logger.LogInformation(
                "Encounter-scope backfill: {Scoped} orders scoped to their encounter, {Restored} auto-discontinued (closed encounter)",
                scoped, restored);

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
    }
}

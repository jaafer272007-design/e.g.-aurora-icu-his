using System.Text.Json;
using Aurora.Core.Ai;
using Aurora.Core.Identity;
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

        /* resume the generated-id counters from the persisted data — on a
           fresh database this resolves to the historical floors, so
           first-boot behavior is unchanged (see OrderLogic notes) */
        OrderLogic.InitializeCounters(db);
    }
}

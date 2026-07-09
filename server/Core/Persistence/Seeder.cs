using System.Text.Json;
using Aurora.Core.Ai;
using Aurora.Core.Identity;
using Aurora.Core.Orders;
using Aurora.Core.LabImaging;
using Aurora.Core.Shared;
using Aurora.Modules.Icu.Roster;

namespace Aurora.Core.Persistence;

/* create + seed the database at startup if empty. Seed JSON files are
   GENERATED from the frontend mock stores (see each domain's notes) —
   never hand-edit them. The roster block reads Modules.Icu.Roster types:
   part of the sanctioned temporary seam documented on AuroraDb. */
static class Seeder
{
    public static void SeedAll(WebApplication app, string demoPassword, string dbPath)
    {
        using var scope = app.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AuroraDb>();
        /* The DB is a startup-built cache (Render free tier disks are ephemeral
           anyway) — rebuild it every boot so schema changes (e.g. Phase 2's
           Users table) never need migrations against a stale file. */
        db.Database.EnsureDeleted();
        db.Database.EnsureCreated();
        if (!db.Patients.Any())
        {
            var seedPath = Path.Combine(AppContext.BaseDirectory, "Data", "roster-seed.json");
            var records = JsonSerializer.Deserialize<List<RosterRecordDto>>(
                File.ReadAllText(seedPath), JsonOpts.Web)!;
            db.Patients.AddRange(records.Select(PatientRow.FromDto));
            db.SaveChanges();
            app.Logger.LogInformation("Seeded {Count} roster records into {Db}", records.Count, dbPath);
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
    }
}

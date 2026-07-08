using System.ComponentModel.DataAnnotations;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;

/* AURORA ICU — Stage 10 Phase 1: the roster/patients service.
   One real endpoint (GET /api/icu/patients) serving the canonical unit
   roster from SQLite, seeded with the same 14-patient data as the frontend
   mock store (Data/roster-seed.json is GENERATED from src/lib/api/data/
   roster.ts, not hand-copied).

   SQLite is a deliberate, documented Phase 1 simplification: swapping to
   SQL Server later is an EF Core provider change (UseSqlite → UseSqlServer
   + connection string), not a rewrite. The container never bakes the DB —
   it is created and seeded at startup, so the hosting choice stays
   swappable (Docker anywhere). */

var builder = WebApplication.CreateBuilder(args);

/* Render (and most PaaS) inject PORT; default 8080 for local Docker runs. */
var port = Environment.GetEnvironmentVariable("PORT") ?? "8080";
builder.WebHost.UseUrls($"http://0.0.0.0:{port}");

/* SQLite file lives under ./data (ephemeral on Render free tier — reseeded
   on every boot, which is correct for Phase 1 read-only roster data). */
var dbPath = Environment.GetEnvironmentVariable("DB_PATH") ?? "data/aurora.db";
Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(dbPath))!);
builder.Services.AddDbContext<RosterDb>(o => o.UseSqlite($"Data Source={dbPath}"));

/* CORS — explicit allowlist only. The deployed GitHub Pages origin is the
   default; override/extend with CORS_ORIGINS (semicolon-separated). */
var corsOrigins = (Environment.GetEnvironmentVariable("CORS_ORIGINS")
    ?? "https://jaafer272007-design.github.io;http://localhost:5173;http://localhost:4173")
    .Split(';', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
builder.Services.AddCors(o => o.AddDefaultPolicy(p =>
    p.WithOrigins(corsOrigins).AllowAnyHeader().WithMethods("GET")));

var app = builder.Build();
app.UseCors();

/* create + seed the database at startup if empty */
using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<RosterDb>();
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
}

/* health/warmup probe (also Render's health check path) */
app.MapGet("/healthz", () => Results.Json(new { status = "ok", service = "aurora-icu-roster", phase = "stage10-phase1" }));

/* GET /api/icu/patients — the canonical unit roster (Phase 1's single real
   endpoint). Matches the contract documented on the frontend mock adapter;
   note alertCount is NOT served: it is a DERIVED value (AI alerts + unacked
   results + bed alert) and those domains are still mock — the frontend
   adapter derives it, same as before (derived state is never stored). */
app.MapGet("/api/icu/patients", (RosterDb db) =>
    Results.Json(db.Patients.AsNoTracking()
        .OrderBy(p => p.PatientId)
        .AsEnumerable()
        .Select(p => p.ToDto()), JsonOpts.Web));

app.Run();

static class JsonOpts
{
    public static readonly JsonSerializerOptions Web = new(JsonSerializerDefaults.Web);
}

/* ---------- persistence ---------- */

class RosterDb(DbContextOptions<RosterDb> options) : DbContext(options)
{
    public DbSet<PatientRow> Patients => Set<PatientRow>();
}

/* One row per patient. Scalar roster fields are real columns; nested
   value objects (vitals, alert, trend, organs, flags) are stored as JSON
   text — fine for SQLite now and portable to SQL Server later. */
class PatientRow
{
    [Key]
    public string PatientId { get; set; } = "";
    public string BedId { get; set; } = "";
    public string Name { get; set; } = "";
    public string Mrn { get; set; } = "";
    public int Age { get; set; }
    public string Sex { get; set; } = "";
    public string Diagnosis { get; set; } = "";
    public int Los { get; set; }
    public string Allergies { get; set; } = "";
    public string Attending { get; set; } = "";
    public string CodeStatus { get; set; } = "";
    public string Rhythm { get; set; } = "";
    public bool Isolation { get; set; }
    public string Severity { get; set; } = "";
    public int Sofa { get; set; }
    public int Ews { get; set; }
    public string FlagsJson { get; set; } = "[]";
    public string BedsideVitalsJson { get; set; } = "{}";
    public string BedAlertJson { get; set; } = "{}";
    public string MapTrendJson { get; set; } = "[]";
    public string MonitorVitalsJson { get; set; } = "{}";
    public string OrgansJson { get; set; } = "{}";

    public static PatientRow FromDto(RosterRecordDto d) => new()
    {
        PatientId = d.PatientId, BedId = d.BedId, Name = d.Name, Mrn = d.Mrn,
        Age = d.Age, Sex = d.Sex, Diagnosis = d.Diagnosis, Los = d.Los,
        Allergies = d.Allergies, Attending = d.Attending, CodeStatus = d.CodeStatus,
        Rhythm = d.Rhythm, Isolation = d.Isolation, Severity = d.Severity,
        Sofa = d.Sofa, Ews = d.Ews,
        FlagsJson = JsonSerializer.Serialize(d.Flags, JsonOpts.Web),
        BedsideVitalsJson = JsonSerializer.Serialize(d.BedsideVitals, JsonOpts.Web),
        BedAlertJson = JsonSerializer.Serialize(d.BedAlert, JsonOpts.Web),
        MapTrendJson = JsonSerializer.Serialize(d.MapTrend, JsonOpts.Web),
        MonitorVitalsJson = JsonSerializer.Serialize(d.MonitorVitals, JsonOpts.Web),
        OrgansJson = JsonSerializer.Serialize(d.Organs, JsonOpts.Web),
    };

    public RosterRecordDto ToDto() => new(
        PatientId, BedId, Name, Mrn, Age, Sex, Diagnosis, Los, Allergies,
        Attending, CodeStatus, Rhythm, Isolation, Severity, Sofa, Ews,
        JsonSerializer.Deserialize<List<string>>(FlagsJson, JsonOpts.Web)!,
        JsonSerializer.Deserialize<JsonElement>(BedsideVitalsJson, JsonOpts.Web),
        JsonSerializer.Deserialize<JsonElement>(BedAlertJson, JsonOpts.Web),
        JsonSerializer.Deserialize<List<double>>(MapTrendJson, JsonOpts.Web)!,
        JsonSerializer.Deserialize<JsonElement>(MonitorVitalsJson, JsonOpts.Web),
        JsonSerializer.Deserialize<JsonElement>(OrgansJson, JsonOpts.Web));
}

/* ---------- wire contract (camelCase over the wire) ----------
   Mirrors the frontend RosterRecordDto in src/lib/api/types.ts. Nested
   objects are passed through as-is (JsonElement) so the wire shape is
   exactly the seeded shape. */
record RosterRecordDto(
    string PatientId, string BedId, string Name, string Mrn, int Age, string Sex,
    string Diagnosis, int Los, string Allergies, string Attending, string CodeStatus,
    string Rhythm, bool Isolation, string Severity, int Sofa, int Ews,
    List<string> Flags, JsonElement BedsideVitals, JsonElement BedAlert,
    List<double> MapTrend, JsonElement MonitorVitals, JsonElement Organs);

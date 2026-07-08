using System.ComponentModel.DataAnnotations;
using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;

/* AURORA ICU — Stage 10: roster/patients service + authentication.
   Phase 1: GET /api/icu/patients serves the canonical unit roster from
   SQLite, seeded with the same 14-patient data as the frontend mock store
   (Data/roster-seed.json is GENERATED from src/lib/api/data/roster.ts).
   Phase 2: real authentication — a users table (the same 20 staff as the
   Stage 9 preset list; Data/users-seed.json is GENERATED from src/lib/
   session.ts) with bcrypt-hashed passwords, POST /api/auth/login issuing
   a JWT, and JWT bearer validation applied to the roster endpoint. All 20
   demo users share ONE password (DEMO_PASSWORD env, default "Aurora2026!")
   — a documented NON-PRODUCTION credential; no registration/reset flow yet.

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
    p.WithOrigins(corsOrigins).AllowAnyHeader().WithMethods("GET", "POST")));

/* ---- JWT (Stage 10 Phase 2) ----
   Signing key from JWT_SECRET (any length — hashed to 256 bits). When the
   env var is unset a random per-boot key is generated: fine for the demo
   (tokens simply expire when the free-tier service restarts), and it means
   no secret ever lives in the repo. Validation is registered ONCE here so
   Phase 3 endpoints opt in with just `.RequireAuthorization()`. */
var jwtSecret = Environment.GetEnvironmentVariable("JWT_SECRET");
if (string.IsNullOrWhiteSpace(jwtSecret))
    jwtSecret = Convert.ToBase64String(RandomNumberGenerator.GetBytes(48));
var jwtKey = new SymmetricSecurityKey(SHA256.HashData(Encoding.UTF8.GetBytes(jwtSecret)));
const string JwtIssuer = "aurora-icu";
const string JwtAudience = "aurora-icu-client";

builder.Services
    .AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(o => o.TokenValidationParameters = new TokenValidationParameters
    {
        ValidIssuer = JwtIssuer,
        ValidAudience = JwtAudience,
        IssuerSigningKey = jwtKey,
        ValidateIssuer = true,
        ValidateAudience = true,
        ValidateIssuerSigningKey = true,
        ValidateLifetime = true,
        ClockSkew = TimeSpan.FromMinutes(1),
    });
builder.Services.AddAuthorization();

var app = builder.Build();
app.UseCors();
app.UseAuthentication();
app.UseAuthorization();

/* Shared demo password — bcrypt-hashed once at startup, NEVER stored or
   logged in plaintext beyond this env read. Non-production, documented. */
var demoPassword = Environment.GetEnvironmentVariable("DEMO_PASSWORD") ?? "Aurora2026!";
/* verified against when the username doesn't exist, so unknown-user and
   wrong-password take the same time (no user enumeration via timing) */
var decoyHash = BCrypt.Net.BCrypt.HashPassword(Guid.NewGuid().ToString(), workFactor: 10);

/* create + seed the database at startup if empty */
using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<RosterDb>();
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
}

/* health/warmup probe (also Render's health check path) */
app.MapGet("/healthz", () => Results.Json(new { status = "ok", service = "aurora-icu-roster", phase = "stage10-phase1" }));

/* POST /api/auth/login — Phase 2's authentication endpoint (anonymous).
   Accepts username OR full display name + password; verifies against the
   bcrypt hash; returns a JWT whose claims carry the user's identity and
   JobTitle. Failure is ALWAYS the same generic 401 — never reveals whether
   the username or the password was wrong. */
app.MapPost("/api/auth/login", (LoginRequest req, RosterDb db) =>
{
    var input = (req.Username ?? "").Trim().ToLowerInvariant();
    var user = input.Length == 0 ? null : db.Users.AsNoTracking()
        .AsEnumerable()
        .FirstOrDefault(u => u.Username == input || u.Name.ToLowerInvariant() == input);
    var verified = BCrypt.Net.BCrypt.Verify(req.Password ?? "", user?.PasswordHash ?? decoyHash);
    if (user is null || !verified)
        return Results.Json(new { error = "Invalid credentials" }, JsonOpts.Web, statusCode: 401);

    var now = DateTime.UtcNow;
    var token = new JwtSecurityTokenHandler().WriteToken(new JwtSecurityToken(
        issuer: JwtIssuer,
        audience: JwtAudience,
        claims:
        [
            new Claim(JwtRegisteredClaimNames.Sub, user.Username),
            new Claim(JwtRegisteredClaimNames.Jti, Guid.NewGuid().ToString()),
            new Claim("name", user.Name),
            new Claim("jobTitle", user.JobTitle),
        ],
        notBefore: now,
        expires: now.AddHours(12), // one shift
        signingCredentials: new SigningCredentials(jwtKey, SecurityAlgorithms.HmacSha256)));
    return Results.Json(new { token, name = user.Name, jobTitle = user.JobTitle }, JsonOpts.Web);
});

/* GET /api/icu/patients — the canonical unit roster (Phase 1's single real
   endpoint; Phase 2 puts it behind JWT bearer auth — future endpoints adopt
   the same middleware with just .RequireAuthorization()). Matches the
   contract documented on the frontend mock adapter; note alertCount is NOT
   served: it is a DERIVED value (AI alerts + unacked results + bed alert)
   and those domains are still mock — the frontend adapter derives it, same
   as before (derived state is never stored). */
app.MapGet("/api/icu/patients", (RosterDb db) =>
    Results.Json(db.Patients.AsNoTracking()
        .OrderBy(p => p.PatientId)
        .AsEnumerable()
        .Select(p => p.ToDto()), JsonOpts.Web))
    .RequireAuthorization();

app.Run();

static class JsonOpts
{
    public static readonly JsonSerializerOptions Web = new(JsonSerializerDefaults.Web);
}

/* ---------- persistence ---------- */

class RosterDb(DbContextOptions<RosterDb> options) : DbContext(options)
{
    public DbSet<PatientRow> Patients => Set<PatientRow>();
    public DbSet<UserRow> Users => Set<UserRow>();
}

/* One row per staff account (Stage 10 Phase 2). Only the bcrypt hash is
   stored — never a plaintext password. PermissionProfile/permissions are
   deliberately NOT columns: they are derived from JobTitle at read time
   (locked RBAC rule), on the client today and server-side from Phase 3. */
class UserRow
{
    [Key]
    public string Username { get; set; } = "";
    public string Name { get; set; } = "";
    public string JobTitle { get; set; } = "";
    public string PasswordHash { get; set; } = "";
}

record UserSeedDto(string Username, string Name, string JobTitle);

record LoginRequest(string? Username, string? Password);

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

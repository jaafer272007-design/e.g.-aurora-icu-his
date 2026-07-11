using Aurora.Core.Adt;
using Aurora.Core.Ai;
using Aurora.Core.Identity;
using Aurora.Core.Mar;
using Aurora.Core.MasterData;
using Aurora.Core.Orders;
using Aurora.Core.Persistence;
using Aurora.Core.LabImaging;
using Aurora.Core.Timeline;
using Aurora.Modules.Icu.Roster;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;

/* AURORA — composition root (Stage 10 complete; Core relocation Step 1).

   Per the platform direction recorded in CLAUDE.md ("Platform Direction —
   Aurora Core + Modules"), the domains live under Core/ and Modules/Icu/
   INSIDE THIS ONE ASSEMBLY — a behavior-neutral relocation: every route,
   DTO, JSON option and RBAC check is byte-identical to the pre-split
   Program.cs. The csproj split into separate Core/module projects is
   deferred until a second module exists; until then the Core→Module
   dependency direction is enforced by convention and review rule.

   - Aurora.Core.*            — Identity (auth/RBAC), Orders, MAR, Results,
                                Timeline, AI, Persistence (AuroraDb + Seeder),
                                Shared (JsonOpts, ApiError)
   - Aurora.Modules.Icu.*     — the unit roster (deliberately NOT relocated:
                                it fuses Patient/Encounter with the ICU
                                bedside snapshot; it splits at Layer 2 ADT +
                                Stage 11 — see the note in RosterApi.cs)

   PERSISTENCE (Stage 10 — the blocking prerequisite for Layer 2 ADT):
   PostgreSQL via DATABASE_URL (Render blueprint database; the connection
   string lives ONLY in the environment, never the repo) with EF Core
   migrations — writes survive restarts and redeploys. Without
   DATABASE_URL the service falls back to the ORIGINAL ephemeral SQLite
   demo mode (rebuilt + reseeded every boot, loudly logged) so a plain
   local `docker run` still works. See Core/Persistence. */

var builder = WebApplication.CreateBuilder(args);

/* Render (and most PaaS) inject PORT; default 8080 for local Docker runs. */
var port = Environment.GetEnvironmentVariable("PORT") ?? "8080";
builder.WebHost.UseUrls($"http://0.0.0.0:{port}");

/* provider selection — Postgres when DATABASE_URL is set (Render, real
   deployments), ephemeral SQLite demo mode otherwise (see Db notes) */
string dbLabel;
if (Db.UsePostgres)
{
    var conn = Db.NpgsqlConnectionString(Environment.GetEnvironmentVariable("DATABASE_URL")!);
    builder.Services.AddDbContext<AuroraDb>(o => o.UseNpgsql(conn));
    dbLabel = "postgres (DATABASE_URL)";
}
else
{
    var dbPath = Environment.GetEnvironmentVariable("DB_PATH") ?? "data/aurora.db";
    Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(dbPath))!);
    builder.Services.AddDbContext<AuroraDb>(o => o.UseSqlite($"Data Source={dbPath}"));
    dbLabel = dbPath;
}

/* CORS — explicit allowlist only. The deployed GitHub Pages origin is the
   default; override/extend with CORS_ORIGINS (semicolon-separated). */
var corsOrigins = (Environment.GetEnvironmentVariable("CORS_ORIGINS")
    ?? "https://jaafer272007-design.github.io;http://localhost:5173;http://localhost:4173")
    .Split(';', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
builder.Services.AddCors(o => o.AddDefaultPolicy(p =>
    p.WithOrigins(corsOrigins).AllowAnyHeader().WithMethods("GET", "POST", "PUT")));

/* JWT validation is registered ONCE here so endpoints opt in with just
   `.RequireAuthorization()` — key/issuer/audience live in Core/Identity. */
var jwtKey = Jwt.ResolveKey();
builder.Services
    .AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(o =>
    {
        /* keep original claim names ("sub"/"name"/"jobTitle") — the
           server-side RBAC reads jobTitle straight off the principal */
        o.MapInboundClaims = false;
        o.TokenValidationParameters = new TokenValidationParameters
        {
            ValidIssuer = Jwt.Issuer,
            ValidAudience = Jwt.Audience,
            IssuerSigningKey = jwtKey,
            ValidateIssuer = true,
            ValidateAudience = true,
            ValidateIssuerSigningKey = true,
            ValidateLifetime = true,
            ClockSkew = TimeSpan.FromMinutes(1),
        };
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

Seeder.SeedAll(app, demoPassword, dbLabel);

/* health/warmup probe (also Render's health check path). `build` carries
   the git commit this binary was deployed from (Render injects
   RENDER_GIT_COMMIT at runtime; "dev" outside Render) — every deployed
   E2E suite's warm-up asserts it matches the commit the workflow was
   dispatched against, so a suite can never again run green against a
   STALE deployment (the 2026-07-10 CI-evidence audit's biggest finding).
   `environment` is the ENVIRONMENT IDENTITY (step 1 of the merged
   environment-separation design): the freshness-gate mechanism extended
   by one field. It is CONFIGURATION, not code — read from APP_ENV at
   runtime (render.yaml sets "staging" for the deployed cloud tier; a
   future production install sets "production" through the same variable,
   no code change). Unset = a local dev process, per the design's tuple.
   Every data-writing suite asserts this field matches its declared
   target BEFORE running any write leg. */
var build = Environment.GetEnvironmentVariable("RENDER_GIT_COMMIT") ?? "dev";
var appEnv = Environment.GetEnvironmentVariable("APP_ENV") ?? "development";
app.MapGet("/healthz", () => Results.Json(new { status = "ok", service = "aurora-icu-api", phase = "stage10-phase3", build, environment = appEnv }));

/* endpoint groups — same registration order as the pre-split Program.cs;
   every route string is byte-identical (the /api/icu/ prefix on Core
   domains is accepted historical cosmetics — renaming it would break the
   deployed frontend and the E2E suite). */
AuthApi.Map(app, jwtKey, decoyHash);
UsersApi.Map(app);
RosterApi.Map(app);
AdtApi.Map(app);
OrdersApi.Map(app);
MarApi.Map(app);
TimelineApi.Map(app);
AiApi.Map(app);
ResultsApi.Map(app);
FormularyApi.Map(app);
LabCatalogApi.Map(app);
OrderSetsApi.Map(app);

app.Run();

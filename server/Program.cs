using Aurora.Core.Ai;
using Aurora.Core.Identity;
using Aurora.Core.Mar;
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

   SQLite is a deliberate, documented simplification: swapping to Postgres/
   SQL Server later is an EF Core provider change here + migrations in
   Core/Persistence, not a rewrite (the NEXT step after this relocation).
   The container never bakes the DB — it is created and seeded at startup,
   so the hosting choice stays swappable (Docker anywhere). */

var builder = WebApplication.CreateBuilder(args);

/* Render (and most PaaS) inject PORT; default 8080 for local Docker runs. */
var port = Environment.GetEnvironmentVariable("PORT") ?? "8080";
builder.WebHost.UseUrls($"http://0.0.0.0:{port}");

/* SQLite file lives under ./data (ephemeral on Render free tier — reseeded
   on every boot; the Postgres provider swap replaces this registration). */
var dbPath = Environment.GetEnvironmentVariable("DB_PATH") ?? "data/aurora.db";
Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(dbPath))!);
builder.Services.AddDbContext<AuroraDb>(o => o.UseSqlite($"Data Source={dbPath}"));

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

Seeder.SeedAll(app, demoPassword, dbPath);

/* health/warmup probe (also Render's health check path) */
app.MapGet("/healthz", () => Results.Json(new { status = "ok", service = "aurora-icu-api", phase = "stage10-phase3" }));

/* endpoint groups — same registration order as the pre-split Program.cs;
   every route string is byte-identical (the /api/icu/ prefix on Core
   domains is accepted historical cosmetics — renaming it would break the
   deployed frontend and the E2E suite). */
AuthApi.Map(app, jwtKey, decoyHash);
RosterApi.Map(app);
OrdersApi.Map(app);
MarApi.Map(app);
TimelineApi.Map(app);
AiApi.Map(app);
ResultsApi.Map(app);

app.Run();

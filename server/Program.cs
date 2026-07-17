using Aurora.Core.Adt;
using Aurora.Core.Ai;
using Aurora.Core.Identity;
using Aurora.Core.Mar;
using Aurora.Core.MasterData;
using Aurora.Core.Orders;
using Aurora.Core.Persistence;
using Aurora.Core.Shared;
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
   demo mode (rebuilt + reseeded every boot, loudly logged) so a local
   `docker run -e APP_ENV=development` still works — since §11 step 2
   every boot must name its environment, and production refuses the
   SQLite fallback outright (BootGuards T2). See Core/Persistence. */

/* ---- BOOT GATES (environment-separation §11 step 2) — BEFORE anything
   binds: an unknown or missing APP_ENV refuses to boot in every tier
   (the boot/seed-layer escalation of the aud rider, whose fail-closed
   token layer stays beneath this as defense in depth), and a production
   process refuses a dev configuration outright (T2). T1 — the
   demo-credential scan — runs after seeding, before serving (below).
   See Core/Persistence/BootGuards.cs for every tripwire's rationale. */
BootGuards.RefuseUnknownEnvironment();
BootGuards.ProductionConfigTripwire();

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
        /* NO ORACLE (aud rider): without this, the 401's WWW-Authenticate
           header carries error_description text that says WHY a token
           failed ("audience is invalid" vs "signature key not found") —
           a cross-environment probe could distinguish a right-secret/
           wrong-audience token from garbage. Every invalid token gets the
           same bare `Bearer error="invalid_token"`. */
        o.IncludeErrorDetails = false;
        o.TokenValidationParameters = new TokenValidationParameters
        {
            ValidIssuer = Jwt.Issuer,
            /* THE aud-CLAIM ENVIRONMENT RIDER (§11 step 1, deferred half):
               the token audience IS the environment. Validation requires
               aud == this process's APP_ENV, so a staging-minted token is
               structurally invalid on production (and vice versa) even if
               the signing secret were somehow shared — defense in depth on
               top of the per-environment JWT_SECRET. FAIL-CLOSED: when
               APP_ENV is missing or unknown, the valid audience is a
               random per-boot GUID no real token can carry — a
               misconfigured service validates NOTHING (and issues nothing;
               see AuthApi). Tokens minted before this rider carried the
               old fixed audience and fail validation once — a single
               forced re-login at deploy, recorded. */
            ValidAudience = AppEnv.IsKnown ? AppEnv.Name : Guid.NewGuid().ToString("N"),
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

/* ---- §11 step 3: SAME-ORIGIN FRONTEND (appliance Phase 1) ----
   When a compiled frontend bundle is present in wwwroot, this service
   serves it — the production model: ONE origin, the bundle calling its
   API with a RELATIVE base, no CORS surface, and frontend/API version
   skew unrepresentable (they ship together).
   [Superseded 2026-07-17, appliance Phase 1: the staging Render image
   NOW CARRIES wwwroot too — the Dockerfile builds the frontend into the
   image, so the appliance topology (server-served frontend) is exercised
   on staging from day one, at Render's own origin, while GitHub Pages
   keeps serving the cross-origin staging frontend unchanged.] The SPA
   fallback is mapped after the API endpoints, below. */
var wwwroot = Path.Combine(app.Environment.ContentRootPath, "wwwroot");
var servesFrontend = File.Exists(Path.Combine(wwwroot, "index.html"));
if (servesFrontend)
{
    app.UseDefaultFiles();
    app.UseStaticFiles();
}

/* Shared demo password — bcrypt-hashed once at startup, NEVER stored or
   logged in plaintext beyond this env read. Non-production by
   construction: T2 refuses production boot when DEMO_PASSWORD is set,
   the production seed path never uses this value, and T1 refuses to
   serve a production database where any active account matches it. The
   constant itself lives in BootGuards (the one place it is known). */
var demoPassword = Environment.GetEnvironmentVariable("DEMO_PASSWORD") ?? BootGuards.DemoPassword;
/* verified against when the username doesn't exist, so unknown-user and
   wrong-password take the same time (no user enumeration via timing) */
var decoyHash = BCrypt.Net.BCrypt.HashPassword(Guid.NewGuid().ToString(), workFactor: 10);

Seeder.SeedAll(app, demoPassword, dbLabel);
/* [T1] the demo-credential tripwire — after seeding (covers a fresh
   seed, a migrated database, and any account a human later touched),
   before the process ever serves. */
BootGuards.DemoCredentialTripwire(app);

/* health/warmup probe (also Render's health check path). `build` carries
   the git commit this binary was deployed from (Render injects
   RENDER_GIT_COMMIT at runtime; "dev" outside Render) — every deployed
   E2E suite's warm-up asserts it matches the commit the workflow was
   dispatched against, so a suite can never again run green against a
   STALE deployment (the 2026-07-10 CI-evidence audit's biggest finding).
   `environment` is the ENVIRONMENT IDENTITY (step 1 of the merged
   environment-separation design): the freshness-gate mechanism extended
   by one field. It is CONFIGURATION, not code — read from APP_ENV at
   runtime via AppEnv (render.yaml sets "staging" for the deployed cloud
   tier; a future production install sets "production" through the same
   variable, no code change). Since the aud rider, a missing/unknown
   APP_ENV is reported HONESTLY ("unset" or the raw value) instead of
   defaulting to "development" — because authentication now fails closed
   on it (see AppEnv.cs), healthz must not claim an environment the
   process cannot vouch for. Every data-writing suite asserts this field
   matches its declared target BEFORE running any write leg. */
var build = Environment.GetEnvironmentVariable("RENDER_GIT_COMMIT") ?? "dev";
if (!AppEnv.IsKnown)
    Console.WriteLine($"[AURORA] APP_ENV is '{AppEnv.Name}' — not a known environment (development|staging|production). " +
        "Authentication is FAIL-CLOSED: no token will be issued or validated until APP_ENV is configured.");
app.MapGet("/healthz", () => Results.Json(new { status = "ok", service = "aurora-icu-api", phase = "stage10-phase3", build, environment = AppEnv.Name }));

/* /build.txt (appliance Phase 1) — the SAME two-line contract the Pages
   deploy stamps into its artifact (sha, then environment), served
   DYNAMICALLY here so a server-served frontend has the same freshness
   probe. Runtime-resolved on purpose: the image is environment-agnostic
   (APP_ENV is configuration), so nothing environment-specific is baked
   into a static file. Frontend and API ship together in the image, so
   this sha IS the served bundle's commit. */
app.MapGet("/build.txt", () => Results.Text($"{build}\n{AppEnv.Name}\n", "text/plain"));

/* endpoint groups — same registration order as the pre-split Program.cs;
   every route string is byte-identical (the /api/icu/ prefix on Core
   domains is accepted historical cosmetics — renaming it would break the
   deployed frontend and the E2E suite). */
AuthApi.Map(app, jwtKey, decoyHash);
UsersApi.Map(app);
RosterApi.Map(app);
AdtApi.Map(app);
Aurora.Core.Assignments.AssignmentsApi.Map(app);
OrdersApi.Map(app);
MarApi.Map(app);
TimelineApi.Map(app);
AiApi.Map(app);
ResultsApi.Map(app);
FormularyApi.Map(app);
LabCatalogApi.Map(app);
OrderSetsApi.Map(app);
Aurora.Core.Observations.ObservationsApi.Map(app);

/* SPA fallback (only when this service carries the frontend): unmatched
   non-API routes serve index.html so the router owns deep links — but
   the /api namespace stays HONEST: an unknown API route remains a plain
   404, never a 200 HTML page (the four-code convention would be
   unauditable if absent endpoints answered with markup). */
if (servesFrontend)
{
    app.MapFallback(async ctx =>
    {
        /* the guard list, asserted in BOTH directions by the deployed
           frontend suite (appliance Phase 1): /api/*, /healthz and
           /build.txt must NEVER resolve to index.html — a missing API
           endpoint answered with markup would be a silent blank page
           instead of an auditable 404. (/healthz and /build.txt are
           mapped above so they normally never reach this fallback; the
           guard makes the contract explicit rather than incidental.) */
        if (ctx.Request.Path.StartsWithSegments("/api")
            || ctx.Request.Path.StartsWithSegments("/healthz")
            || ctx.Request.Path.StartsWithSegments("/build.txt"))
        {
            ctx.Response.StatusCode = 404;
            return;
        }
        ctx.Response.ContentType = "text/html";
        await ctx.Response.SendFileAsync(Path.Combine(wwwroot, "index.html"));
    });
}

app.Run();

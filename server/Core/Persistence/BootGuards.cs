using Aurora.Core.Shared;
using Microsoft.EntityFrameworkCore;

namespace Aurora.Core.Persistence;

/* ---- Boot tripwires (environment-separation §11 step 2) ----
   The design principle, applied verbatim: a production environment must
   REFUSE TO RUN if it is in any state that would be acceptable in dev
   but dangerous in production — not "configured not to": refuses to
   boot. Every guard fails closed and LOUDLY; the refusal banner names
   the tripwire and the fix, because a refusing production instance is a
   configuration error to repair immediately, never a silent degradation.

   Order in the boot pipeline (Program.cs):
     1. RefuseUnknownEnvironment  — every tier must name itself
     2. ProductionConfigTripwire  — T2, env-only checks, before binding
     3. (Seeder.SeedAll — mode-aware; production seeding has its own
        refusals for missing install decisions)
     4. DemoCredentialTripwire    — T1, after seeding, before serving

   Consistency with the aud rider: the rider's fail-closed token layer
   (login 503 + unmatchable validation audience on unknown APP_ENV)
   STAYS in place beneath gate 1 as defense in depth — with the boot
   gate it is unreachable at runtime, and that redundancy is the point. */
static class BootGuards
{
    /* the ONE place the shared demo password is known to the server:
       Program.cs derives the dev/staging seed password from
       DEMO_PASSWORD ?? this constant, and T1 scans production hashes
       against exactly this constant. It is a compile-time constant of
       the demo regime — not a secret — and is never logged or stored
       in plaintext anywhere. */
    public const string DemoPassword = "Aurora2026!";

    public static bool Production => AppEnv.Raw == "production";

    /* Values FORMULARY_SEED must take in production — the install-time
       operational policy from the approved design (owner amendment 2):
       "starter" seeds the reference formulary DEACTIVATED (structurally
       unprescribable until Pharmacy validates by reactivating each drug
       through the existing Layer 4 screen — the safety enforcement
       already rejects inactive drugs, so the marking is a mechanism,
       not a label); "empty" seeds none and the hospital's pharmacy
       builds its own. */
    public static readonly string[] FormularyModes = ["starter", "empty"];

    /* [boot gate] an unknown or missing APP_ENV refuses to BOOT, in
       every tier — the boot/seed-layer escalation of the aud rider's
       fail-closed token layer. A process that cannot name its own
       environment must not come up at all. */
    public static void RefuseUnknownEnvironment()
    {
        if (AppEnv.IsKnown) return;
        Refuse("UNKNOWN ENVIRONMENT",
            $"APP_ENV is '{AppEnv.Name}' — not one of: {string.Join(" | ", AppEnv.Known)}.",
            "Set it explicitly: render.yaml sets 'staging' for the deployed cloud tier,",
            "a production install sets 'production', local development sets 'development'.");
    }

    /* [T2] demo-config tripwire: production refuses to run with a dev
       configuration. The enumerated set, each justified:
       - DEMO_PASSWORD set — a knob that exists only to vary the SHARED
         demo seed password; production has no shared credentials at all,
         so the knob's presence proves a demo-shaped provisioning;
       - DATABASE_URL missing — the ephemeral SQLite fallback rebuilds
         and reseeds on every boot; a system of record cannot run on a
         database that forgets;
       - JWT_SECRET missing — the per-boot random key is a dev
         convenience (every restart logs everyone out) and its absence
         proves the secret was never provisioned; production's signing
         secret must be explicit and stable;
       - CORS_ORIGINS missing, or carrying a localhost/loopback origin —
         the built-in default allowlist includes the Vite dev ports, and
         a dev origin allowed against production would let any local page
         in a clinician's browser call the system of record. (The
         end-state per the design is same-origin with NO cross-origins
         at all — §11 step 3; until then the origin list must be
         explicit and non-local.)
       - FORMULARY_SEED missing or unknown — the formulary install policy
         is an explicit install decision recorded in configuration; a
         production install that never made the decision must not guess. */
    public static void ProductionConfigTripwire()
    {
        if (!Production) return;
        if (Environment.GetEnvironmentVariable("DEMO_PASSWORD") is not null)
            Refuse("T2 — DEMO CONFIG",
                "DEMO_PASSWORD is set. That knob exists only to vary the SHARED demo seed",
                "password; production has no shared credentials. Unset it.");
        if (!Db.UsePostgres)
            Refuse("T2 — DEMO CONFIG",
                "DATABASE_URL is not set — that is the ephemeral SQLite demo fallback,",
                "which rebuilds and reseeds on every boot. Production requires PostgreSQL:",
                "set DATABASE_URL.");
        if (string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable("JWT_SECRET")))
            Refuse("T2 — DEMO CONFIG",
                "JWT_SECRET is not set — the per-boot random signing key is a dev",
                "convenience. Provision an explicit, stable secret for production.");
        var cors = Environment.GetEnvironmentVariable("CORS_ORIGINS");
        if (string.IsNullOrWhiteSpace(cors))
            Refuse("T2 — DEMO CONFIG",
                "CORS_ORIGINS is not set — the built-in default allowlist includes the",
                "localhost dev ports. Production must declare its own origin(s) explicitly.");
        if (cors.Contains("localhost", StringComparison.OrdinalIgnoreCase) ||
            cors.Contains("127.0.0.1"))
            Refuse("T2 — DEMO CONFIG",
                $"CORS_ORIGINS contains a localhost/loopback origin ({cors}).",
                "A dev origin allowed against production lets any local page in a",
                "clinician's browser call the system of record. Remove it.");
        var fm = Environment.GetEnvironmentVariable("FORMULARY_SEED");
        if (fm is null || !FormularyModes.Contains(fm))
            Refuse("T2 — MISSING INSTALL DECISION",
                $"FORMULARY_SEED is '{fm ?? "<unset>"}' — it must be one of: {string.Join(" | ", FormularyModes)}.",
                "This is the install-time formulary policy from the approved design:",
                "'starter' seeds the reference formulary DEACTIVATED (pharmacy validates by",
                "reactivating each drug before clinical use); 'empty' seeds none and the",
                "hospital's pharmacy builds its own. The decision must be explicit.");
    }

    /* [T1] demo-credential tripwire: on every production boot — fresh
       install, migrated database, or a database some human later touched
       — verify the demo password against every ACTIVE account's bcrypt
       hash; any match refuses to serve. This is what makes the shared
       demo password STRUCTURALLY IMPOSSIBLE in production: a database
       carrying it cannot be booted, no matter how it got there. The scan
       verifies the compile-time constant against stored hashes in memory
       only; it logs matching USERNAMES, never any password material. */
    public static void DemoCredentialTripwire(WebApplication app)
    {
        if (!Production) return;
        using var scope = app.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AuroraDb>();
        var matches = db.Users.AsNoTracking().Where(u => u.Active).AsEnumerable()
            .Where(u => BCrypt.Net.BCrypt.Verify(DemoPassword, u.PasswordHash))
            .Select(u => u.Username)
            .ToList();
        if (matches.Count == 0)
        {
            app.Logger.LogInformation("T1 demo-credential scan: clean ({Count} active accounts checked)",
                db.Users.Count(u => u.Active));
            return;
        }
        Refuse("T1 — DEMO CREDENTIAL IN PRODUCTION",
            $"{matches.Count} ACTIVE account(s) verify against the shared demo password:",
            $"  {string.Join(", ", matches)}",
            "A production database carrying the demo credential cannot be served.",
            "Fix: reset those accounts' passwords (Layer 3 user administration from a",
            "clean environment) or provision a clean production database.");
    }

    /* the refusal itself — unambiguous, loud, and terminal. Written to
       stderr so it survives any logging configuration; the process never
       binds a port. */
    public static void Refuse(string tripwire, params string[] lines)
    {
        Console.Error.WriteLine("==============================================================");
        Console.Error.WriteLine($"AURORA REFUSES TO BOOT — {tripwire}");
        foreach (var l in lines) Console.Error.WriteLine("  " + l);
        Console.Error.WriteLine("  A refusing production instance is a configuration error to");
        Console.Error.WriteLine("  fix, not a degradation to tolerate.");
        Console.Error.WriteLine("==============================================================");
        Environment.Exit(1);
    }
}

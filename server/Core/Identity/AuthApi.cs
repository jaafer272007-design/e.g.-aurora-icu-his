using System.ComponentModel.DataAnnotations;
using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text.Json;
using System.Text.Json.Serialization;
using Aurora.Core.Persistence;
using Aurora.Core.Shared;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;

namespace Aurora.Core.Identity;

static class AuthApi
{
    /* ---- Multi-role login (User Management design §2) ----
       A person may HOLD several roles but ACTS AS exactly one per session,
       chosen at login — the session token's jobTitle claim IS the active
       role, so the locked RBAC derivation (jobTitle → profile →
       permissions, computed per request) is completely unchanged.

       FLAGGED MECHANISM (§2 / open item 1): the server never issues a
       usable session token before the role is chosen. Intermediate steps
       (role selection, forced password change) get short-lived STEP
       tokens whose JWT audience is "<env>#role-select" / "<env>#pw-change"
       — the composition root validates session tokens against audience ==
       APP_ENV exactly, so a step token is STRUCTURALLY invalid on every
       API endpoint (same defence pattern as the aud environment rider);
       only the matching auth step accepts it, via manual validation.

       Order of steps: password change comes FIRST (before role selection
       and before any session) — an expired initial credential is replaced
       before anything else proceeds. Roles are still only ever revealed
       AFTER a correct password (decision 7): the change-password response
       carries the role list / session exactly as a normal login would.

       Failure stays ONE generic 401 for wrong password, unknown user AND
       deactivated account (decision + flagged wording, open item 2): the
       login surface must not be an account-state oracle, so the
       deactivated message is the SAME "Invalid credentials" — the honest
       trade-off (a departed employee is told nothing beyond "no") chosen
       over a specific "account deactivated" that would leak state. The
       decoy-hash compare keeps unknown-user timing identical. */
    public static void Map(WebApplication app, SymmetricSecurityKey jwtKey, string decoyHash)
    {
        app.MapPost("/api/auth/login", (LoginRequest req, AuroraDb db) =>
        {
            /* FAIL-CLOSED (aud rider): a service whose APP_ENV is missing
               or unknown must not mint tokens. */
            if (!AppEnv.IsKnown)
                return Results.Json(new { error = "authentication unavailable — APP_ENV is missing or unknown (fail-closed)" }, JsonOpts.Web, statusCode: 503);

            var input = (req.Username ?? "").Trim().ToLowerInvariant();
            var user = input.Length == 0 ? null : db.Users.AsNoTracking()
                .AsEnumerable()
                .FirstOrDefault(u => u.Username == input || u.Name.ToLowerInvariant() == input);
            var verified = BCrypt.Net.BCrypt.Verify(req.Password ?? "", user?.PasswordHash ?? decoyHash);
            if (user is null || !verified || !user.Active)
                return Results.Json(new { error = "Invalid credentials" }, JsonOpts.Web, statusCode: 401);

            return Proceed(user, jwtKey);
        });

        /* POST /api/auth/change-password — the forced-change step (first
           login / after an admin reset). Consumes a pw-change step token;
           on success continues the login exactly where it left off. */
        app.MapPost("/api/auth/change-password", (ChangePasswordRequest req, AuroraDb db) =>
        {
            if (!AppEnv.IsKnown)
                return Results.Json(new { error = "authentication unavailable — APP_ENV is missing or unknown (fail-closed)" }, JsonOpts.Web, statusCode: 503);
            var username = ValidateStepToken(req.Token, jwtKey, PwChangeAudience);
            if (username is null)
                return Results.Json(new { error = "Invalid credentials" }, JsonOpts.Web, statusCode: 401);
            var user = db.Users.FirstOrDefault(u => u.Username == username);
            if (user is null || !user.Active || !user.MustChangePassword)
                return Results.Json(new { error = "Invalid credentials" }, JsonOpts.Web, statusCode: 401);
            if (UserLogic.ValidatePassword(req.NewPassword, "newPassword") is string pErr)
                return ApiError.BadRequest(pErr);
            if (BCrypt.Net.BCrypt.Verify(req.NewPassword, user.PasswordHash))
                return ApiError.BadRequest("the new password must differ from the current one");

            user.PasswordHash = BCrypt.Net.BCrypt.HashPassword(req.NewPassword, workFactor: 10);
            user.MustChangePassword = false;
            /* audited (§4): the account holder is the actor; no password
               material is ever recorded */
            user.EventsJson = UserLogic.AppendEvents(user.EventsJson,
                [new(UserLogic.Now(), user.Name, null, "password changed", "forced change at sign-in (first login / after reset)")]);
            db.SaveChanges();
            return Proceed(user, jwtKey);
        });

        /* POST /api/auth/select-role — the role-choice step for multi-role
           accounts. Consumes a role-select step token; the chosen role
           must be one the account actually holds. */
        app.MapPost("/api/auth/select-role", (SelectRoleRequest req, AuroraDb db) =>
        {
            if (!AppEnv.IsKnown)
                return Results.Json(new { error = "authentication unavailable — APP_ENV is missing or unknown (fail-closed)" }, JsonOpts.Web, statusCode: 503);
            var username = ValidateStepToken(req.Token, jwtKey, RoleSelectAudience);
            if (username is null)
                return Results.Json(new { error = "Invalid credentials" }, JsonOpts.Web, statusCode: 401);
            var user = db.Users.AsNoTracking().FirstOrDefault(u => u.Username == username);
            if (user is null || !user.Active || user.MustChangePassword)
                return Results.Json(new { error = "Invalid credentials" }, JsonOpts.Web, statusCode: 401);
            var roles = UserLogic.RolesOf(user);
            var chosen = (req.Role ?? "").Trim();
            if (!roles.Contains(chosen))
                return ApiError.BadRequest("role must be one of the roles this account holds");
            return Results.Json(SessionResponse(user, chosen, jwtKey), JsonOpts.Web);
        });
    }

    /* the post-authentication continuation: forced change → role logic */
    static IResult Proceed(UserRow user, SymmetricSecurityKey jwtKey)
    {
        if (user.MustChangePassword)
            return Results.Json(new
            {
                mustChangePassword = true,
                changeToken = StepToken(user.Username, PwChangeAudience, jwtKey),
            }, JsonOpts.Web);

        var roles = UserLogic.RolesOf(user);
        if (roles.Count == 1) // decision 8: a single-role user skips the chooser
            return Results.Json(SessionResponse(user, roles[0], jwtKey), JsonOpts.Web);

        /* >1 role: reveal the roles (we are past the correct password) and
           hand back ONLY a role-select step token — no session yet */
        return Results.Json(new
        {
            roles,
            name = user.Name,
            selectToken = StepToken(user.Username, RoleSelectAudience, jwtKey),
        }, JsonOpts.Web);
    }

    static object SessionResponse(UserRow user, string activeRole, SymmetricSecurityKey jwtKey)
    {
        var now = DateTime.UtcNow;
        var token = new JwtSecurityTokenHandler().WriteToken(new JwtSecurityToken(
            issuer: Jwt.Issuer,
            audience: AppEnv.Name, // the aud environment rider
            claims:
            [
                new Claim(JwtRegisteredClaimNames.Sub, user.Username),
                new Claim(JwtRegisteredClaimNames.Jti, Guid.NewGuid().ToString()),
                new Claim("name", user.Name),
                /* the ACTIVE role — the one profile permissions derive from
                   this session (RBAC model unchanged) */
                new Claim("jobTitle", activeRole),
            ],
            notBefore: now,
            expires: now.AddHours(12), // one shift
            signingCredentials: new SigningCredentials(jwtKey, SecurityAlgorithms.HmacSha256)));
        return new { token, name = user.Name, jobTitle = activeRole, roles = UserLogic.RolesOf(user) };
    }

    /* step tokens: audience "<env>#step" is unmatchable by the composition
       root's session validation (audience == APP_ENV), so these cannot
       authenticate against any API endpoint */
    static string RoleSelectAudience => AppEnv.Name + "#role-select";
    static string PwChangeAudience => AppEnv.Name + "#pw-change";

    static string StepToken(string username, string audience, SymmetricSecurityKey jwtKey)
    {
        var now = DateTime.UtcNow;
        return new JwtSecurityTokenHandler().WriteToken(new JwtSecurityToken(
            issuer: Jwt.Issuer,
            audience: audience,
            claims: [new Claim(JwtRegisteredClaimNames.Sub, username)],
            notBefore: now,
            expires: now.AddMinutes(5),
            signingCredentials: new SigningCredentials(jwtKey, SecurityAlgorithms.HmacSha256)));
    }

    /** the step-token's subject, or null when invalid/expired/wrong step */
    static string? ValidateStepToken(string? token, SymmetricSecurityKey jwtKey, string audience)
    {
        if (string.IsNullOrWhiteSpace(token)) return null;
        try
        {
            /* keep the raw claim names — the default handler maps "sub" to
               a schema URI (Program.cs disables that for the bearer
               pipeline; this manual validation needs it disabled too) */
            var principal = new JwtSecurityTokenHandler { MapInboundClaims = false }.ValidateToken(token, new TokenValidationParameters
            {
                ValidIssuer = Jwt.Issuer,
                ValidAudience = audience,
                IssuerSigningKey = jwtKey,
                ClockSkew = TimeSpan.FromSeconds(30),
            }, out _);
            return principal.FindFirst("sub")?.Value;
        }
        catch
        {
            return null;
        }
    }
}

/* One row per staff account (Stage 10 Phase 2; extended — not duplicated —
   by Layer 3 user administration and the User Management design). Only the
   bcrypt hash is stored — never a plaintext password. PermissionProfile/
   permissions are deliberately NOT columns: they are derived from the
   session's ACTIVE role at read time (locked RBAC rule).
   - Active: deactivation is a STATUS CHANGE, never a delete — an account
     that signed an order must stay resolvable forever (audit rule).
   - EventsJson: the account's immutable, append-only audit history.
   - RolesJson (User Management design §3): the SET of roles this person
     HOLDS (JSON array of JobTitles). JobTitle remains the PRIMARY role
     (always roles[0]) for legacy readers; the set is the truth. Seeded
     accounts are backfilled to a set of one (identical behaviour).
   - MustChangePassword (§4): set on create and admin reset; cleared by
     the forced change-password step. */
class UserRow
{
    [Key]
    public string Username { get; set; } = "";
    public string Name { get; set; } = "";
    public string JobTitle { get; set; } = "";
    public string PasswordHash { get; set; } = "";
    public bool Active { get; set; } = true;
    public string EventsJson { get; set; } = "[]";
    public string RolesJson { get; set; } = "[]";
    public bool MustChangePassword { get; set; }
}

record UserSeedDto(string Username, string Name, string JobTitle);

record LoginRequest(string? Username, string? Password);

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
record SelectRoleRequest(string? Token, string? Role);

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
record ChangePasswordRequest(string? Token, string? NewPassword);

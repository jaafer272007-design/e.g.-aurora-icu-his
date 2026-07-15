using System.Security.Claims;
using System.Text.Json;
using System.Text.Json.Serialization;
using Aurora.Core.Persistence;
using Aurora.Core.Shared;
using Microsoft.EntityFrameworkCore;

namespace Aurora.Core.Identity;

/* ------------- User Administration (Layer 3 → User Management design) -------------
   Creating or editing a user's roles changes WHO CAN SIGN ORDERS — the
   privilege-escalation surface is this API's central concern:

   - AUTHORITY (design §5, flagged move): every endpoint now requires the
     SYSTEM ADMINISTRATOR's atoms — users.view for the read, users.manage
     for every mutation — held ONLY by the SystemAdministrator profile
     (IT/system). The office Administrator no longer manages accounts.
     Everyone else gets the same generic 403.
   - A user record holds a SET of roles (§3); the person acts as ONE
     active role per session (chosen at login). Permissions always derive
     from the active role — the RBAC model is untouched.
   - Every action is AUDITED on the target account's immutable event
     history (append-only): who performed it (the token's name claim),
     ACTING AS WHICH ROLE (decision 5 — the token's jobTitle claim, i.e.
     the authority they exercised), when (UTC date+time), what changed.
   - Guards (§5.2): an administrator cannot deactivate their own account,
     nor remove the System Administrator role from it; the LAST ACTIVE
     System Administrator can be neither deactivated nor stripped of the
     role — the system must never become unmanageable.
   - FLAGGED (§5.2 open item 3): a System Administrator MAY create/grant
     another System Administrator — succession must be possible (the
     last-admin guard would otherwise make the role a permanent single
     point of failure). The grant is treated like a clinical grant: it
     requires an explicit justification and is audited.
   - Granting a CLINICAL role (Doctor/Nurse/SeniorDoctor profile) requires
     an explicit `justification` string, recorded in the audit.
   - Deactivation is a STATUS CHANGE, never a delete: all history stays
     fully attributed forever. A deactivated account gets the same generic
     401 on login (no account-state oracle). Outstanding JWTs live out
     their 12 h expiry — token revocation is a documented prototype
     limitation. FLAGGED (§7 open item 4): a deactivated clinician's
     pending/active orders are left UNTOUCHED — they belong to the
     patient, not the user; any cascade would be a clinical workflow
     decision, not an identity one.
   - Password create/reset SETS a new bcrypt hash and sets
     MustChangePassword — the holder must replace it at next sign-in
     (§4). The audit records THAT it happened, never password material. */
static class UsersApi
{
    public static void Map(WebApplication app)
    {
        /* GET /api/icu/users — every account incl. deactivated ones (a
           status filter would hide exactly the rows an auditor needs). */
        app.MapGet("/api/icu/users", (HttpContext ctx, ClaimsPrincipal user, AuroraDb db) =>
        {
            if (Rbac.Deny(user, "users.view") is IResult denied) return denied;
            foreach (var key in ctx.Request.Query.Keys)
                return ApiError.BadRequest($"unknown query parameter '{key}'");
            return Results.Json(db.Users.AsNoTracking().OrderBy(u => u.Username)
                .AsEnumerable().Select(UserLogic.ToDto), JsonOpts.Web);
        }).RequireAuthorization();

        /* POST /api/icu/users — create an account with ONE OR MORE roles
           and an admin-set initial password (change forced at first
           login). Everything validated BEFORE the insert. */
        app.MapPost("/api/icu/users", (CreateUserRequest req, ClaimsPrincipal user, AuroraDb db) =>
        {
            if (Rbac.Deny(user, "users.manage") is IResult denied) return denied;

            var username = (req.Username ?? "").Trim();
            if (UserLogic.ValidateUsername(username) is string uErr) return ApiError.BadRequest(uErr);
            if (string.IsNullOrWhiteSpace(req.Name)) return ApiError.BadRequest("name is required");
            if (req.Name!.Length > UserLogic.MaxTextLength)
                return ApiError.BadRequest($"name exceeds {UserLogic.MaxTextLength} characters");
            var roles = UserLogic.NormalizeRoles(req.Roles);
            if (UserLogic.ValidateRoles(roles) is string rErr) return ApiError.BadRequest(rErr);
            if (UserLogic.ValidatePassword(req.InitialPassword, "initialPassword") is string pErr)
                return ApiError.BadRequest(pErr);
            if (UserLogic.JustifiedGrantLabel(roles) is string grant
                && string.IsNullOrWhiteSpace(req.Justification))
                return ApiError.BadRequest($"granting {grant} requires a justification");
            if (req.Justification is { Length: > UserLogic.MaxTextLength })
                return ApiError.BadRequest($"justification exceeds {UserLogic.MaxTextLength} characters");
            if (db.Users.AsNoTracking().Any(u => u.Username == username))
                return ApiError.BadRequest($"username '{username}' already exists");

            var (actor, actorRole) = UserLogic.ActorOf(user);
            var detail = $"roles [{string.Join(", ", roles)}]"
                + (string.IsNullOrWhiteSpace(req.Justification) ? "" : $" — justification: {req.Justification!.Trim()}");
            var row = new UserRow
            {
                Username = username,
                Name = req.Name!.Trim(),
                JobTitle = roles[0],
                RolesJson = JsonSerializer.Serialize(roles, JsonOpts.Web),
                PasswordHash = BCrypt.Net.BCrypt.HashPassword(req.InitialPassword, workFactor: 10),
                Active = true,
                MustChangePassword = true, // §4: forced change on first login
                EventsJson = JsonSerializer.Serialize(
                    new List<UserEventDto> { new(UserLogic.Now(), actor, actorRole, "created", detail) }, JsonOpts.Web),
            };
            db.Users.Add(row);
            db.SaveChanges();
            return Results.Json(UserLogic.ToDto(row), JsonOpts.Web);
        }).RequireAuthorization();

        /* PUT /api/icu/users/{username} — edit name and/or the ROLE SET
           (full replacement; §5.2 guards). A body with no recognized
           change is a 400, never a no-op. */
        app.MapPut("/api/icu/users/{username}", (string username, EditUserRequest req, ClaimsPrincipal user, AuroraDb db) =>
        {
            if (Rbac.Deny(user, "users.manage") is IResult denied) return denied;
            if (username == "system")
                return ApiError.BadRequest("'system' is the reserved system principal — it cannot be edited, reactivated, or given a password");
            var row = db.Users.FirstOrDefault(u => u.Username == username);
            if (row is null) return ApiError.NotFound();

            var newName = req.Name?.Trim();
            if (newName is null && req.Roles is null)
                return ApiError.BadRequest("no recognized field to change — provide name and/or roles");
            if (newName is not null && newName.Length == 0) return ApiError.BadRequest("name must not be blank");
            if (newName is { Length: > UserLogic.MaxTextLength })
                return ApiError.BadRequest($"name exceeds {UserLogic.MaxTextLength} characters");
            if (req.Justification is { Length: > UserLogic.MaxTextLength })
                return ApiError.BadRequest($"justification exceeds {UserLogic.MaxTextLength} characters");

            var (actor, actorRole) = UserLogic.ActorOf(user);
            var self = user.FindFirst("sub")?.Value == row.Username;
            var events = new List<UserEventDto>();

            if (req.Roles is not null)
            {
                var newRoles = UserLogic.NormalizeRoles(req.Roles);
                if (UserLogic.ValidateRoles(newRoles) is string rErr) return ApiError.BadRequest(rErr);
                var oldRoles = UserLogic.RolesOf(row);
                if (!newRoles.SequenceEqual(oldRoles))
                {
                    var added = newRoles.Except(oldRoles).ToList();
                    if (UserLogic.JustifiedGrantLabel(added) is string grant
                        && string.IsNullOrWhiteSpace(req.Justification))
                        return ApiError.BadRequest($"granting {grant} requires a justification");
                    var wasSysAdmin = oldRoles.Any(UserLogic.IsSysAdminRole);
                    var staysSysAdmin = newRoles.Any(UserLogic.IsSysAdminRole);
                    /* §5.2: you cannot strip the System Administrator role
                       from YOUR OWN account (lockout / track-covering) */
                    if (self && wasSysAdmin && !staysSysAdmin)
                        return ApiError.BadRequest("you cannot remove the System Administrator role from your own account");
                    /* §5.2: the LAST active System Administrator cannot
                       lose the role — 409, transient system state */
                    if (wasSysAdmin && !staysSysAdmin && row.Active
                        && !UserLogic.OtherActiveSysAdminExists(db, row.Username))
                        return ApiError.StateConflict(
                            $"account '{username}' is the last active System Administrator — the role cannot be removed until another active System Administrator exists");
                    var detail = $"[{string.Join(", ", oldRoles)}] → [{string.Join(", ", newRoles)}]"
                        + (string.IsNullOrWhiteSpace(req.Justification) ? "" : $" — justification: {req.Justification!.Trim()}");
                    events.Add(new(UserLogic.Now(), actor, actorRole, "roles changed", detail));
                    row.RolesJson = JsonSerializer.Serialize(newRoles, JsonOpts.Web);
                    row.JobTitle = newRoles[0];
                }
            }
            if (newName is not null && newName != row.Name)
            {
                events.Add(new(UserLogic.Now(), actor, actorRole, "renamed", $"{row.Name} → {newName}"));
                row.Name = newName;
            }
            if (events.Count == 0)
                return ApiError.BadRequest("no field change — the provided values match the current account");

            row.EventsJson = UserLogic.AppendEvents(row.EventsJson, events);
            db.SaveChanges();
            return Results.Json(UserLogic.ToDto(row), JsonOpts.Web);
        }).RequireAuthorization();

        /* POST /api/icu/users/{username}/deactivate — status change, never
           a delete: the account stays resolvable forever (audit rule). */
        app.MapPost("/api/icu/users/{username}/deactivate", (string username, ClaimsPrincipal user, AuroraDb db) =>
        {
            if (Rbac.Deny(user, "users.manage") is IResult denied) return denied;
            if (username == "system")
                return ApiError.BadRequest("'system' is the reserved system principal — it cannot be edited, reactivated, or given a password");
            var row = db.Users.FirstOrDefault(u => u.Username == username);
            if (row is null) return ApiError.NotFound();
            /* FOUR-CODE RULE: replay = 409; the SELF guard stays 400 (never
               valid for this actor/target in any state); last-sysadmin =
               409 (transient system state). */
            if (!row.Active)
                return ApiError.StateConflict($"account '{username}' is already deactivated — there is nothing to deactivate");
            if (user.FindFirst("sub")?.Value == row.Username)
                return ApiError.BadRequest("you cannot deactivate your own account");
            if (UserLogic.RolesOf(row).Any(UserLogic.IsSysAdminRole)
                && !UserLogic.OtherActiveSysAdminExists(db, row.Username))
                return ApiError.StateConflict(
                    $"account '{username}' is the last active System Administrator — it cannot be deactivated until another active System Administrator exists");
            var (actor, actorRole) = UserLogic.ActorOf(user);
            row.Active = false;
            row.EventsJson = UserLogic.AppendEvents(row.EventsJson,
                [new(UserLogic.Now(), actor, actorRole, "deactivated", null)]);
            db.SaveChanges();
            return Results.Json(UserLogic.ToDto(row), JsonOpts.Web);
        }).RequireAuthorization();

        /* POST /api/icu/users/{username}/reactivate */
        app.MapPost("/api/icu/users/{username}/reactivate", (string username, ClaimsPrincipal user, AuroraDb db) =>
        {
            if (Rbac.Deny(user, "users.manage") is IResult denied) return denied;
            if (username == "system")
                return ApiError.BadRequest("'system' is the reserved system principal — it cannot be edited, reactivated, or given a password");
            var row = db.Users.FirstOrDefault(u => u.Username == username);
            if (row is null) return ApiError.NotFound();
            if (row.Active)
                return ApiError.StateConflict($"account '{username}' is already active — there is nothing to reactivate");
            var (actor, actorRole) = UserLogic.ActorOf(user);
            row.Active = true;
            row.EventsJson = UserLogic.AppendEvents(row.EventsJson,
                [new(UserLogic.Now(), actor, actorRole, "reactivated", null)]);
            db.SaveChanges();
            return Results.Json(UserLogic.ToDto(row), JsonOpts.Web);
        }).RequireAuthorization();

        /* POST /api/icu/users/{username}/reset-password — sets a new hash
           AND forces a change at the next sign-in (§4); never reveals or
           transmits the old one; the audit records THAT a reset happened,
           never any password material. */
        app.MapPost("/api/icu/users/{username}/reset-password",
            (string username, ResetPasswordRequest req, ClaimsPrincipal user, AuroraDb db) =>
        {
            if (Rbac.Deny(user, "users.manage") is IResult denied) return denied;
            if (username == "system")
                return ApiError.BadRequest("'system' is the reserved system principal — it cannot be edited, reactivated, or given a password");
            var row = db.Users.FirstOrDefault(u => u.Username == username);
            if (row is null) return ApiError.NotFound();
            if (UserLogic.ValidatePassword(req.NewPassword, "newPassword") is string pErr)
                return ApiError.BadRequest(pErr);
            var (actor, actorRole) = UserLogic.ActorOf(user);
            row.PasswordHash = BCrypt.Net.BCrypt.HashPassword(req.NewPassword, workFactor: 10);
            row.MustChangePassword = true;
            row.EventsJson = UserLogic.AppendEvents(row.EventsJson,
                [new(UserLogic.Now(), actor, actorRole, "password reset", "temporary credential set — change forced at next sign-in")]);
            db.SaveChanges();
            return Results.Json(UserLogic.ToDto(row), JsonOpts.Web);
        }).RequireAuthorization();
    }
}

static class UserLogic
{
    public const int MaxTextLength = 2000;
    /* stated minimum — rejected as weak below this. Deliberately
       minimum-viable: policy/lockout/expiry/MFA are recorded as gated on
       the independent security review, not implied here. */
    public const int MinPasswordLength = 8;
    public const int MaxPasswordLength = 128;
    public const int MaxRoles = 5;

    /** account changes span months — audit times carry the DATE (UTC),
        unlike the HH:mm bedside convention */
    public static string Now() => DateTime.UtcNow.ToString("yyyy-MM-dd HH:mm");

    /** the actor's name AND the active role they are exercising (decision
        5 — both always from the token, never from a request field) */
    public static (string Actor, string ActorRole) ActorOf(ClaimsPrincipal user) =>
        (user.FindFirst("name")?.Value ?? "Unknown", user.FindFirst("jobTitle")?.Value ?? "Unknown");

    /** the SET of roles a user holds; a legacy row without a backfilled
        set behaves as a set of one (its JobTitle) */
    public static List<string> RolesOf(UserRow u)
    {
        var roles = JsonSerializer.Deserialize<List<string>>(
            string.IsNullOrWhiteSpace(u.RolesJson) ? "[]" : u.RolesJson, JsonOpts.Web)!;
        return roles.Count > 0 ? roles : [u.JobTitle];
    }

    public static UserAccountDto ToDto(UserRow u) => new(
        u.Username, u.Name, u.JobTitle, RolesOf(u), u.Active, u.MustChangePassword,
        JsonSerializer.Deserialize<List<UserEventDto>>(u.EventsJson, JsonOpts.Web)!);

    public static bool IsSysAdminRole(string role) => Rbac.ProfileOf(role) == "SystemAdministrator";

    /** clinical = ordering or administering authority; System
        Administrator = the user-management authority itself. Granting
        either requires an explicit justification. Returns the label to
        cite, or null when none of the roles needs one. */
    public static string? JustifiedGrantLabel(IEnumerable<string> roles)
    {
        foreach (var role in roles)
        {
            var profile = Rbac.ProfileOf(role);
            if (profile is "Doctor" or "Nurse" or "SeniorDoctor")
                return $"the clinical job title '{role}' ({profile} profile)";
            if (profile is "SystemAdministrator")
                return $"the System Administrator authority ('{role}')";
        }
        return null;
    }

    public static bool OtherActiveSysAdminExists(AuroraDb db, string exceptUsername) =>
        db.Users.AsNoTracking().Where(u => u.Active && u.Username != exceptUsername)
            .AsEnumerable().Any(u => RolesOf(u).Any(IsSysAdminRole));

    public static List<string> NormalizeRoles(IEnumerable<string>? roles) =>
        (roles ?? []).Select(r => (r ?? "").Trim()).Where(r => r.Length > 0)
            .Distinct().ToList();

    public static string? ValidateRoles(List<string> roles)
    {
        if (roles.Count == 0) return "at least one role is required";
        if (roles.Count > MaxRoles) return $"a user may hold at most {MaxRoles} roles";
        foreach (var role in roles)
            if (Rbac.ProfileOf(role) is null)
                return $"role '{role}' is not a recognized job title";
        return null;
    }

    public static string? ValidateUsername(string username)
    {
        if (username.Length == 0) return "username is required";
        if (username.Length is < 3 or > 64) return "username must be 3-64 characters";
        if (!username.All(c => c is (>= 'a' and <= 'z') or (>= '0' and <= '9') or '.' or '-'))
            return "username may contain only lowercase letters, digits, '.' and '-'";
        return null;
    }

    public static string? ValidatePassword(string? password, string field) =>
        string.IsNullOrEmpty(password) ? $"{field} is required"
        : password.Length < MinPasswordLength
            ? $"{field} is too weak — minimum {MinPasswordLength} characters"
        : password.Length > MaxPasswordLength
            ? $"{field} exceeds {MaxPasswordLength} characters"
            : null;

    /** append-only — existing entries are never rewritten or removed */
    public static string AppendEvents(string eventsJson, List<UserEventDto> newEvents)
    {
        var events = JsonSerializer.Deserialize<List<UserEventDto>>(eventsJson, JsonOpts.Web)!;
        events.AddRange(newEvents);
        return JsonSerializer.Serialize(events, JsonOpts.Web);
    }
}

/* ActorRole (decision 5): the ACTIVE role the actor exercised — null on
   events written before this design (and on self-service password changes
   that happen before a role is chosen). */
record UserEventDto(string Time, string Actor, string? ActorRole, string Action, string? Detail);

record UserAccountDto(string Username, string Name, string JobTitle, List<string> Roles,
    bool Active, bool MustChangePassword, List<UserEventDto> Events);

/* request DTOs — unknown fields fail binding (codified validation rule) */
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
record CreateUserRequest(string? Username, string? Name, List<string>? Roles, string? InitialPassword, string? Justification);

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
record EditUserRequest(string? Name, List<string>? Roles, string? Justification);

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
record ResetPasswordRequest(string? NewPassword);

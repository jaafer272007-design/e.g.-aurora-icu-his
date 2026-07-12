using System.Security.Claims;
using System.Text.Json;
using System.Text.Json.Serialization;
using Aurora.Core.Persistence;
using Aurora.Core.Shared;
using Microsoft.EntityFrameworkCore;

namespace Aurora.Core.Identity;

/* ------------- User Administration (Layer 3, Aurora Core) -------------
   Creating or editing a user's JobTitle changes WHO CAN SIGN ORDERS — the
   privilege-escalation surface is this API's central concern, not an
   afterthought:

   - Every endpoint requires the Administrator profile's users.manage
     permission; every other profile gets the same generic 403.
   - Every action is AUDITED on the target account's immutable event
     history (append-only, never rewritten): who performed it (ALWAYS the
     token's name claim, never a request field), when (UTC date+time —
     account changes span months, so unlike bedside events the date is
     recorded), and what changed (old JobTitle → new JobTitle).
   - An administrator cannot deactivate or demote THEIR OWN account
     (lockout prevention + you cannot quietly remove your own oversight).
   - The LAST ACTIVE Administrator-profile account can be neither
     deactivated nor demoted — the system must always have an admin.
   - Granting a CLINICAL JobTitle (any title deriving the Doctor or Nurse
     profile — i.e. ordering/administering authority) requires an explicit
     `justification` string, recorded in the audit — the same
     acknowledged-override pattern as medication safety warnings.
     Administrative titles don't require it.
   - Deactivation is a STATUS CHANGE, never a delete: an account that
     signed an order stays resolvable forever or the audit trail breaks.
     A deactivated account gets the same generic 401 on login as bad
     credentials (no account-state oracle). Outstanding JWTs live out
     their 12 h expiry — token revocation is a documented prototype
     limitation.
   - Password reset SETS a new bcrypt hash (work factor 10, fresh salt);
     the old password is never revealed or transmitted, and the audit
     event records THAT a reset happened, never any password material.

   JobTitle stays the single stored role field — PermissionProfile and
   Permissions are derived at read time (Rbac), never stored. Validation
   per the codified rule: malformed → 400 {error}, unknown fields fail
   binding, never a silent 200, never a 500. Usernames are natural keys —
   no generated id counters to resume. The /api/icu/ prefix is accepted
   historical cosmetics. */
static class UsersApi
{
    public static void Map(WebApplication app)
    {
        /* GET /api/icu/users — every account incl. deactivated ones (a
           status filter would hide exactly the rows an auditor needs). */
        app.MapGet("/api/icu/users", (HttpContext ctx, ClaimsPrincipal user, AuroraDb db) =>
        {
            if (Rbac.Deny(user, "users.manage") is IResult denied) return denied;
            foreach (var key in ctx.Request.Query.Keys)
                return ApiError.BadRequest($"unknown query parameter '{key}'");
            return Results.Json(db.Users.AsNoTracking().OrderBy(u => u.Username)
                .AsEnumerable().Select(UserLogic.ToDto), JsonOpts.Web);
        }).RequireAuthorization();

        /* POST /api/icu/users — create an account with an admin-set
           initial password. Everything validated BEFORE the insert. */
        app.MapPost("/api/icu/users", (CreateUserRequest req, ClaimsPrincipal user, AuroraDb db) =>
        {
            if (Rbac.Deny(user, "users.manage") is IResult denied) return denied;

            var username = (req.Username ?? "").Trim();
            if (UserLogic.ValidateUsername(username) is string uErr) return ApiError.BadRequest(uErr);
            if (string.IsNullOrWhiteSpace(req.Name)) return ApiError.BadRequest("name is required");
            if (req.Name!.Length > UserLogic.MaxTextLength)
                return ApiError.BadRequest($"name exceeds {UserLogic.MaxTextLength} characters");
            if (UserLogic.ValidateJobTitle(req.JobTitle) is string tErr) return ApiError.BadRequest(tErr);
            if (UserLogic.ValidatePassword(req.InitialPassword, "initialPassword") is string pErr)
                return ApiError.BadRequest(pErr);
            if (UserLogic.RequiresJustification(req.JobTitle!)
                && string.IsNullOrWhiteSpace(req.Justification))
                return ApiError.BadRequest(
                    $"granting the clinical job title '{req.JobTitle}' ({Rbac.ProfileOf(req.JobTitle!)} profile) requires a justification");
            if (req.Justification is { Length: > UserLogic.MaxTextLength })
                return ApiError.BadRequest($"justification exceeds {UserLogic.MaxTextLength} characters");
            if (db.Users.AsNoTracking().Any(u => u.Username == username))
                return ApiError.BadRequest($"username '{username}' already exists");

            var actor = user.FindFirst("name")?.Value ?? "Unknown";
            var detail = $"job title '{req.JobTitle}'"
                + (string.IsNullOrWhiteSpace(req.Justification) ? "" : $" — justification: {req.Justification!.Trim()}");
            var row = new UserRow
            {
                Username = username,
                Name = req.Name!.Trim(),
                JobTitle = req.JobTitle!,
                PasswordHash = BCrypt.Net.BCrypt.HashPassword(req.InitialPassword, workFactor: 10),
                Active = true,
                EventsJson = JsonSerializer.Serialize(
                    new List<UserEventDto> { new(UserLogic.Now(), actor, "created", detail) }, JsonOpts.Web),
            };
            db.Users.Add(row);
            db.SaveChanges();
            return Results.Json(UserLogic.ToDto(row), JsonOpts.Web);
        }).RequireAuthorization();

        /* PUT /api/icu/users/{username} — edit name and/or job title.
           A body with no recognized change is a 400, never a no-op. */
        app.MapPut("/api/icu/users/{username}", (string username, EditUserRequest req, ClaimsPrincipal user, AuroraDb db) =>
        {
            if (Rbac.Deny(user, "users.manage") is IResult denied) return denied;
            if (username == "system")
                return ApiError.BadRequest("'system' is the reserved system principal — it cannot be edited, reactivated, or given a password");
            var row = db.Users.FirstOrDefault(u => u.Username == username);
            if (row is null) return ApiError.NotFound();

            var newName = req.Name?.Trim();
            var newTitle = req.JobTitle;
            if (newName is null && newTitle is null)
                return ApiError.BadRequest("no recognized field to change — provide name and/or jobTitle");
            if (newName is not null && newName.Length == 0) return ApiError.BadRequest("name must not be blank");
            if (newName is { Length: > UserLogic.MaxTextLength })
                return ApiError.BadRequest($"name exceeds {UserLogic.MaxTextLength} characters");
            if (req.Justification is { Length: > UserLogic.MaxTextLength })
                return ApiError.BadRequest($"justification exceeds {UserLogic.MaxTextLength} characters");

            var actor = user.FindFirst("name")?.Value ?? "Unknown";
            var self = user.FindFirst("sub")?.Value == row.Username;
            var events = new List<UserEventDto>();

            if (newTitle is not null && newTitle != row.JobTitle)
            {
                if (UserLogic.ValidateJobTitle(newTitle) is string tErr) return ApiError.BadRequest(tErr);
                var newProfile = Rbac.ProfileOf(newTitle)!;
                if (UserLogic.RequiresJustification(newTitle) && string.IsNullOrWhiteSpace(req.Justification))
                    return ApiError.BadRequest(
                        $"granting the clinical job title '{newTitle}' ({newProfile} profile) requires a justification");
                /* self-demotion guard: an administrator cannot remove their
                   own administrative authority (lockout / track-covering) */
                if (self && Rbac.ProfileOf(row.JobTitle) == "Administrator" && newProfile != "Administrator")
                    return ApiError.BadRequest("you cannot demote your own account out of the Administrator profile");
                /* last-admin guard, demotion variant */
                if (Rbac.ProfileOf(row.JobTitle) == "Administrator" && newProfile != "Administrator"
                    && row.Active && !UserLogic.OtherActiveAdminExists(db, row.Username))
                    return ApiError.StateConflict(
                        $"account '{username}' is the last active Administrator-profile account — it cannot be demoted until another active administrator exists");
                var detail = $"{row.JobTitle} → {newTitle}"
                    + (string.IsNullOrWhiteSpace(req.Justification) ? "" : $" — justification: {req.Justification!.Trim()}");
                events.Add(new(UserLogic.Now(), actor, "job title changed", detail));
                row.JobTitle = newTitle;
            }
            if (newName is not null && newName != row.Name)
            {
                events.Add(new(UserLogic.Now(), actor, "renamed", $"{row.Name} → {newName}"));
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
            /* FOUR-CODE RULE (state-conflict PR): a replayed deactivation
               is a STATE conflict (409). The SELF guard stays 400 — it is
               actor-relative and never valid for this actor/target pair in
               any state. The LAST-ADMIN guard is 409 — transient system
               state: create or reactivate another admin and the same
               request succeeds. */
            if (!row.Active)
                return ApiError.StateConflict($"account '{username}' is already deactivated — there is nothing to deactivate");
            if (user.FindFirst("sub")?.Value == row.Username)
                return ApiError.BadRequest("you cannot deactivate your own account");
            if (Rbac.ProfileOf(row.JobTitle) == "Administrator" && !UserLogic.OtherActiveAdminExists(db, row.Username))
                return ApiError.StateConflict(
                    $"account '{username}' is the last active Administrator-profile account — it cannot be deactivated until another active administrator exists");
            var actor = user.FindFirst("name")?.Value ?? "Unknown";
            row.Active = false;
            row.EventsJson = UserLogic.AppendEvents(row.EventsJson,
                [new(UserLogic.Now(), actor, "deactivated", null)]);
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
            var actor = user.FindFirst("name")?.Value ?? "Unknown";
            row.Active = true;
            row.EventsJson = UserLogic.AppendEvents(row.EventsJson,
                [new(UserLogic.Now(), actor, "reactivated", null)]);
            db.SaveChanges();
            return Results.Json(UserLogic.ToDto(row), JsonOpts.Web);
        }).RequireAuthorization();

        /* POST /api/icu/users/{username}/reset-password — sets a new hash;
           never reveals or transmits the old one. The audit event records
           that a reset happened — NEVER any password material. */
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
            var actor = user.FindFirst("name")?.Value ?? "Unknown";
            row.PasswordHash = BCrypt.Net.BCrypt.HashPassword(req.NewPassword, workFactor: 10);
            row.EventsJson = UserLogic.AppendEvents(row.EventsJson,
                [new(UserLogic.Now(), actor, "password reset", null)]);
            db.SaveChanges();
            return Results.Json(UserLogic.ToDto(row), JsonOpts.Web);
        }).RequireAuthorization();
    }
}

static class UserLogic
{
    public const int MaxTextLength = 2000;
    /* stated minimum — rejected as weak below this (demo-grade; real
       password policy is a production concern, not prototype scope) */
    public const int MinPasswordLength = 8;
    public const int MaxPasswordLength = 128;

    /** account changes span months — audit times carry the DATE (UTC),
        unlike the HH:mm bedside convention */
    public static string Now() => DateTime.UtcNow.ToString("yyyy-MM-dd HH:mm");

    public static UserAccountDto ToDto(UserRow u) => new(
        u.Username, u.Name, u.JobTitle, u.Active,
        JsonSerializer.Deserialize<List<UserEventDto>>(u.EventsJson, JsonOpts.Web)!);

    /** clinical = ordering or administering authority (Doctor / Nurse /
        SeniorDoctor profile — SeniorDoctor added by Stage 11's F4
        decision for the Consultant title) — granting it requires an
        explicit justification */
    public static bool RequiresJustification(string jobTitle) =>
        Rbac.ProfileOf(jobTitle) is "Doctor" or "Nurse" or "SeniorDoctor";

    public static bool OtherActiveAdminExists(AuroraDb db, string exceptUsername) =>
        db.Users.AsNoTracking().Where(u => u.Active && u.Username != exceptUsername)
            .AsEnumerable().Any(u => Rbac.ProfileOf(u.JobTitle) == "Administrator");

    public static string? ValidateUsername(string username)
    {
        if (username.Length == 0) return "username is required";
        if (username.Length is < 3 or > 64) return "username must be 3-64 characters";
        if (!username.All(c => c is (>= 'a' and <= 'z') or (>= '0' and <= '9') or '.' or '-'))
            return "username may contain only lowercase letters, digits, '.' and '-'";
        return null;
    }

    public static string? ValidateJobTitle(string? title) =>
        string.IsNullOrWhiteSpace(title) ? "jobTitle is required"
        : Rbac.ProfileOf(title) is null
            ? $"jobTitle '{title}' is not a recognized job title"
            : null;

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

record UserEventDto(string Time, string Actor, string Action, string? Detail);

record UserAccountDto(string Username, string Name, string JobTitle, bool Active, List<UserEventDto> Events);

/* request DTOs — unknown fields fail binding (codified validation rule) */
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
record CreateUserRequest(string? Username, string? Name, string? JobTitle, string? InitialPassword, string? Justification);

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
record EditUserRequest(string? Name, string? JobTitle, string? Justification);

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
record ResetPasswordRequest(string? NewPassword);

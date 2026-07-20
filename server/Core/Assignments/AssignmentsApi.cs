using System.Security.Claims;
using Aurora.Core.Adt;
using Aurora.Core.Identity;
using Aurora.Core.Persistence;
using Aurora.Core.Shared;
using Microsoft.EntityFrameworkCore;

namespace Aurora.Core.Assignments;

/* ---------------- Assignment endpoints — the OPT-OUT coverage model ----------------
   (Assignment Simplification design — the validator's clinical correction,
   replacing #114's opt-in machinery. See AssignmentModels.cs for the model
   rationale and the two 🔴 invariants.)

   AUTHORITY: assignments.manage — SeniorDoctor (unchanged; no RBAC
   change). The honest interim stands: in a real ICU the CHARGE NURSE
   carves these exceptions, and the recorded follow-up is a SeniorNurse
   profile holding this same atom. Never either administrator profile
   (deciding who nurses a patient is a clinical care decision).

   VISIBILITY: everyone with patients.view reads coverage — knowing who
   is covering a patient is basic clinical safety, not privileged.

   WORKLIST, NEVER AUTHORITY — NO EXCEPTIONS: nothing here gates any
   clinical action, and since this build NO clinical endpoint consults
   coverage at all (the #114 SBAR-handoff assignment gate is DROPPED by
   the owner's decision — any nurse posts a handoff on any patient,
   fully global like charting and administration). */
static class AssignmentsApi
{
    public static void Map(WebApplication app)
    {
        /* GET /api/icu/assignments — the unit-wide COVERAGE read
           (patients.view): every OPEN encounter with its covering nurses
           (derived: active Nurse-profile accounts minus active removals)
           and its removal rows (active and restored — the inline audit). */
        app.MapGet("/api/icu/assignments", (HttpContext ctx, ClaimsPrincipal user, AuroraDb db) =>
        {
            if (Rbac.Deny(user, "patients.view") is IResult denied) return denied;
            foreach (var key in ctx.Request.Query.Keys)
                if (key is not "patientId")
                    return ApiError.BadRequest($"unknown query parameter '{key}'");
            var patientId = ctx.Request.Query["patientId"].ToString();
            var coverage = AssignmentLogic.Coverage(db);
            if (patientId.Length > 0)
                coverage = coverage.Where(c => c.PatientId == patientId).ToList();
            return Results.Json(coverage, JsonOpts.Web);
        }).RequireAuthorization();

        /* GET /api/icu/assignments/mine — the signed-in clinician's
           worklist, stating the MODEL on the wire (token-derived, #104):
           - nurse profile  → every open patient MINUS my active removals
             (+ the removed ids, so the UI can say why one is absent)
           - doctor profile → ALL open patients (doctors have NO
             assignment concept — every doctor covers every patient)
           - anything else  → kind null, honest empty. */
        app.MapGet("/api/icu/assignments/mine", (HttpContext ctx, ClaimsPrincipal user, AuroraDb db) =>
        {
            if (Rbac.Deny(user, "patients.view") is IResult denied) return denied;
            foreach (var key in ctx.Request.Query.Keys)
                return ApiError.BadRequest($"unknown query parameter '{key}'");
            var userId = user.FindFirst("sub")?.Value ?? "";
            var profile = Rbac.ProfileOf(user.FindFirst("jobTitle")?.Value ?? "");
            var kind = profile switch
            {
                "Nurse" => "nurse",
                "Doctor" or "SeniorDoctor" => "doctor",
                _ => null,
            };
            if (kind is null)
                return Results.Json(new MineDto(null, [], []), JsonOpts.Web);

            var open = db.Encounters.AsNoTracking().Where(e => e.Status == "open")
                .Select(e => new { e.EncounterId, e.PatientId }).ToList();
            if (kind == "doctor")
                return Results.Json(
                    new MineDto("doctor", open.Select(e => e.PatientId).Distinct().ToArray(), []),
                    JsonOpts.Web);

            var removedEncs = db.AssignmentRemovals.AsNoTracking()
                .Where(r => r.UserId == userId && r.RestoredAt == null)
                .Select(r => r.EncounterId).ToHashSet();
            var mine = open.Where(e => !removedEncs.Contains(e.EncounterId))
                .Select(e => e.PatientId).Distinct().ToArray();
            var removed = open.Where(e => removedEncs.Contains(e.EncounterId))
                .Select(e => e.PatientId).Distinct().ToArray();
            return Results.Json(new MineDto("nurse", mine, removed), JsonOpts.Web);
        }).RequireAuthorization();

        /* GET /api/icu/assignments/staff — the coverage-manager picker:
           the ACTIVE Nurse-profile accounts coverage derives from
           (assignments.manage — it exists for the management surface). */
        app.MapGet("/api/icu/assignments/staff", (HttpContext ctx, ClaimsPrincipal user, AuroraDb db) =>
        {
            if (Rbac.Deny(user, "assignments.manage") is IResult denied) return denied;
            foreach (var key in ctx.Request.Query.Keys)
                return ApiError.BadRequest($"unknown query parameter '{key}'");
            var staff = AssignmentLogic.ActiveNurses(db)
                .Select(u => new CoverageStaffDto(u.Username, u.Name, u.JobTitle));
            return Results.Json(staff, JsonOpts.Web);
        }).RequireAuthorization();

        /* GET /api/icu/assignments/history — the SUPERSEDED #114 opt-in
           rows, readable forever (patients.view; the migration honesty
           half: prior assignments are history, never discarded). */
        app.MapGet("/api/icu/assignments/history", (HttpContext ctx, ClaimsPrincipal user, AuroraDb db) =>
        {
            if (Rbac.Deny(user, "patients.view") is IResult denied) return denied;
            foreach (var key in ctx.Request.Query.Keys)
                if (key is not "patientId")
                    return ApiError.BadRequest($"unknown query parameter '{key}'");
            var patientId = ctx.Request.Query["patientId"].ToString();
            var rows = db.Assignments.AsNoTracking().OrderBy(a => a.Seq).ToList();
            if (patientId.Length > 0)
            {
                var encIds = db.Encounters.AsNoTracking()
                    .Where(e => e.PatientId == patientId).Select(e => e.EncounterId).ToHashSet();
                rows = rows.Where(a => encIds.Contains(a.EncounterId)).ToList();
            }
            return Results.Json(AssignmentLogic.ToLegacyDtos(db, rows), JsonOpts.Web);
        }).RequireAuthorization();

        /* POST /api/icu/assignments/remove — carve the exception
           (assignments.manage). Body: { patientId, userId, reason? }.
           The encounter is SERVER-RESOLVED from the open encounter (the
           orders chokepoint). FOUR-CODE:
           - unknown patientId / userId, an account that can never nurse → 400
           - deactivated account, no open encounter, already removed → 409
           - 🔴 THE LAST COVERING NURSE → 409 (the hard guarantee: a
             patient must never have zero nurses — prevented, not warned). */
        app.MapPost("/api/icu/assignments/remove", (RemoveNurseRequest req, ClaimsPrincipal user, AuroraDb db) =>
        {
            if (Rbac.Deny(user, "assignments.manage") is IResult denied) return denied;
            if (string.IsNullOrWhiteSpace(req.PatientId)) return ApiError.BadRequest("patientId is required");
            if (string.IsNullOrWhiteSpace(req.UserId)) return ApiError.BadRequest("userId is required");
            if (req.Reason?.Length > AdtLogic.MaxTextLength)
                return ApiError.BadRequest($"reason exceeds {AdtLogic.MaxTextLength} characters");
            if (!db.AdtPatients.AsNoTracking().Any(p => p.PatientId == req.PatientId))
                return ApiError.BadRequest($"patientId '{req.PatientId}' does not match any patient");
            var account = db.Users.AsNoTracking().FirstOrDefault(u => u.Username == req.UserId);
            if (account is null)
                return ApiError.BadRequest($"userId '{req.UserId}' does not match any user account — coverage references real accounts, never free text");
            if (!AssignmentLogic.IsNurseCapable(account))
                return ApiError.BadRequest(
                    $"user '{account.Username}' ({account.JobTitle}) holds no Nurse-profile role — only nurse coverage has removals (doctors have no assignment concept)");
            if (!account.Active)
                return ApiError.StateConflict($"user account '{account.Username}' is deactivated — a deactivated account is not on any worklist; there is nothing to remove");
            if (EncounterGuard.RequireOpenForPatient(db, req.PatientId!, "carving a coverage exception", out var open) is IResult conflict)
                return conflict;
            var existing = db.AssignmentRemovals.FirstOrDefault(r =>
                r.EncounterId == open!.EncounterId && r.UserId == req.UserId && r.RestoredAt == null);
            if (existing is not null)
                return ApiError.StateConflict(
                    $"'{account.Name}' is already removed from this patient ({existing.RemovalId}, by {existing.RemovedBy} at {existing.RemovedAt}) — there is nothing to remove");

            /* 🔴 NEVER ZERO NURSES: who would still cover this encounter? */
            var removedNow = db.AssignmentRemovals.AsNoTracking()
                .Where(r => r.EncounterId == open!.EncounterId && r.RestoredAt == null)
                .Select(r => r.UserId).ToHashSet();
            var remaining = AssignmentLogic.ActiveNurses(db)
                .Count(u => u.Username != req.UserId && !removedNow.Contains(u.Username));
            if (remaining == 0)
                return ApiError.StateConflict(
                    $"'{account.Name}' is the LAST nurse covering this patient — a patient must never have zero nurse coverage, so this removal is refused (restore another nurse first, or add nurse accounts)");

            var row = new AssignmentRemoval
            {
                RemovalId = AssignmentLogic.NextRemovalId(),
                Seq = AssignmentLogic.NextRemovalSeq(db),
                EncounterId = open!.EncounterId,
                UserId = account.Username,
                RemovedAt = AssignmentLogic.Now(),
                RemovedBy = user.FindFirst("name")?.Value ?? "Unknown",
                RemovedByRole = user.FindFirst("jobTitle")?.Value ?? "Unknown",
                Reason = string.IsNullOrWhiteSpace(req.Reason) ? null : req.Reason!.Trim(),
            };
            db.AssignmentRemovals.Add(row);
            db.SaveChanges();
            return Results.Json(AssignmentLogic.ToRemovalDtos(db, [row]).Single(), JsonOpts.Web);
        }).RequireAuthorization();

        /* POST /api/icu/assignments/restore — undo the exception
           (assignments.manage). Body: { patientId, userId }. FOUR-CODE:
           unknown references → 400; no open encounter / not currently
           removed → 409. Restored-never-deleted. */
        app.MapPost("/api/icu/assignments/restore", (RestoreNurseRequest req, ClaimsPrincipal user, AuroraDb db) =>
        {
            if (Rbac.Deny(user, "assignments.manage") is IResult denied) return denied;
            if (string.IsNullOrWhiteSpace(req.PatientId)) return ApiError.BadRequest("patientId is required");
            if (string.IsNullOrWhiteSpace(req.UserId)) return ApiError.BadRequest("userId is required");
            if (!db.AdtPatients.AsNoTracking().Any(p => p.PatientId == req.PatientId))
                return ApiError.BadRequest($"patientId '{req.PatientId}' does not match any patient");
            if (!db.Users.AsNoTracking().Any(u => u.Username == req.UserId))
                return ApiError.BadRequest($"userId '{req.UserId}' does not match any user account");
            if (EncounterGuard.RequireOpenForPatient(db, req.PatientId!, "restoring coverage", out var open) is IResult conflict)
                return conflict;
            var row = db.AssignmentRemovals.FirstOrDefault(r =>
                r.EncounterId == open!.EncounterId && r.UserId == req.UserId && r.RestoredAt == null);
            if (row is null)
                return ApiError.StateConflict(
                    $"'{req.UserId}' is not removed from this patient — they are already covering (the default); there is nothing to restore");
            row.RestoredAt = AssignmentLogic.Now();
            row.RestoredBy = user.FindFirst("name")?.Value ?? "Unknown";
            row.RestoredByRole = user.FindFirst("jobTitle")?.Value ?? "Unknown";
            db.SaveChanges();
            return Results.Json(AssignmentLogic.ToRemovalDtos(db, [row]).Single(), JsonOpts.Web);
        }).RequireAuthorization();
    }
}

static class AssignmentLogic
{
    public static string Now() => DateTime.UtcNow.ToString("yyyy-MM-dd HH:mm");

    static int _removalSeq;
    public static string NextRemovalId() => $"RMV-{Interlocked.Increment(ref _removalSeq)}";

    /** counters resume from the highest persisted id (the codified
        persistence discipline — never a fixed constant). */
    public static void InitializeCounters(AuroraDb db)
    {
        static int SuffixOf(string id) =>
            int.TryParse(id[(id.IndexOf('-') + 1)..], out var n) ? n : 0;
        _removalSeq = db.AssignmentRemovals.AsNoTracking().Select(r => r.RemovalId).AsEnumerable()
            .Select(SuffixOf).DefaultIfEmpty(1000).Max();
    }

    public static int NextRemovalSeq(AuroraDb db) =>
        (db.AssignmentRemovals.AsNoTracking().Max(r => (int?)r.Seq) ?? 0) + 1;

    /** an account coverage derives from: ACTIVE and holding at least one
        role whose profile is Nurse (a dual-role person nurses too).
        Roles resolve through UserLogic.RolesOf, THE canonical resolver. */
    public static bool IsNurseCapable(UserRow account) =>
        UserLogic.RolesOf(account).Any(t => Rbac.ProfileOf(t) == "Nurse");

    public static List<UserRow> ActiveNurses(AuroraDb db) =>
        db.Users.AsNoTracking().Where(u => u.Active).OrderBy(u => u.Username)
            .AsEnumerable().Where(IsNurseCapable).ToList();

    /** THE BOOT SUPERSEDE (migration honesty, idempotent): any #114 row
        still active is ended with the supersede reason — the opt-out
        default covers everyone, so no opt-in row may stay live. Runs at
        every boot; after the first, none are active. */
    public static void SupersedeLegacyAssignments(AuroraDb db)
    {
        var open = db.Assignments.Where(a => a.EndedAt == null).ToList();
        if (open.Count == 0) return;
        var time = Now();
        foreach (var row in open)
        {
            row.EndedAt = time;
            row.EndedBy = "System";
            row.EndedByRole = "System";
            row.EndReason = "superseded by the opt-out coverage model (assignment simplification)";
        }
        db.SaveChanges();
        Console.WriteLine($"[AURORA] assignment simplification: {open.Count} active #114 assignment(s) ended with the supersede reason (audit preserved)");
    }

    /** the unit-wide derived coverage: per open encounter, active nurses
        minus active removals, plus the removal rows (both halves). */
    public static List<CoverageDto> Coverage(AuroraDb db)
    {
        var open = db.Encounters.AsNoTracking().Where(e => e.Status == "open")
            .OrderBy(e => e.EncounterId).ToList();
        if (open.Count == 0) return [];
        var patientIds = open.Select(e => e.PatientId).ToHashSet();
        var names = db.AdtPatients.AsNoTracking().Where(p => patientIds.Contains(p.PatientId))
            .AsEnumerable().ToDictionary(p => p.PatientId, p => p.DisplayName);
        var nurses = ActiveNurses(db);
        var encIds = open.Select(e => e.EncounterId).ToHashSet();
        var removals = db.AssignmentRemovals.AsNoTracking()
            .Where(r => encIds.Contains(r.EncounterId)).OrderBy(r => r.Seq).ToList();
        var removalDtos = ToRemovalDtos(db, removals).ToList();
        return open.Select(e =>
        {
            var removedHere = removals
                .Where(r => r.EncounterId == e.EncounterId && r.RestoredAt == null)
                .Select(r => r.UserId).ToHashSet();
            return new CoverageDto(
                e.PatientId, names.GetValueOrDefault(e.PatientId, ""), e.BedId, e.EncounterId,
                nurses.Where(n => !removedHere.Contains(n.Username))
                    .Select(n => new CoveringNurseDto(n.Username, n.Name, n.JobTitle)).ToList(),
                removalDtos.Where(r => r.EncounterId == e.EncounterId).ToList());
        }).ToList();
    }

    public static IEnumerable<RemovalDto> ToRemovalDtos(AuroraDb db, IReadOnlyList<AssignmentRemoval> rows)
    {
        if (rows.Count == 0) return [];
        var encIds = rows.Select(r => r.EncounterId).ToHashSet();
        var encs = db.Encounters.AsNoTracking()
            .Where(e => encIds.Contains(e.EncounterId)).ToDictionary(e => e.EncounterId);
        var patientIds = encs.Values.Select(e => e.PatientId).ToHashSet();
        var names = db.AdtPatients.AsNoTracking().Where(p => patientIds.Contains(p.PatientId))
            .AsEnumerable().ToDictionary(p => p.PatientId, p => p.DisplayName);
        var userIds = rows.Select(r => r.UserId).ToHashSet();
        var users = db.Users.AsNoTracking().Where(u => userIds.Contains(u.Username))
            .ToDictionary(u => u.Username);
        return rows.Select(r =>
        {
            var enc = encs.GetValueOrDefault(r.EncounterId);
            var account = users.GetValueOrDefault(r.UserId);
            return new RemovalDto(
                r.RemovalId, r.EncounterId,
                enc?.PatientId ?? "", enc is null ? "" : names.GetValueOrDefault(enc.PatientId, ""),
                enc?.BedId ?? "",
                r.UserId, account?.Name ?? r.UserId, account?.JobTitle ?? "",
                r.RemovedAt, r.RemovedBy, r.RemovedByRole, r.Reason,
                r.RestoredAt, r.RestoredBy, r.RestoredByRole);
        }).ToList();
    }

    /** the legacy #114 projection (history read — unchanged shape) */
    public static IEnumerable<AssignmentDto> ToLegacyDtos(AuroraDb db, IReadOnlyList<PatientAssignment> rows)
    {
        if (rows.Count == 0) return [];
        var encIds = rows.Select(r => r.EncounterId).ToHashSet();
        var encs = db.Encounters.AsNoTracking()
            .Where(e => encIds.Contains(e.EncounterId)).ToDictionary(e => e.EncounterId);
        var patientIds = encs.Values.Select(e => e.PatientId).ToHashSet();
        var names = db.AdtPatients.AsNoTracking().Where(p => patientIds.Contains(p.PatientId))
            .AsEnumerable().ToDictionary(p => p.PatientId, p => p.DisplayName);
        var userIds = rows.Select(r => r.UserId).ToHashSet();
        var users = db.Users.AsNoTracking().Where(u => userIds.Contains(u.Username))
            .ToDictionary(u => u.Username);
        return rows.Select(r =>
        {
            var enc = encs.GetValueOrDefault(r.EncounterId);
            var account = users.GetValueOrDefault(r.UserId);
            return new AssignmentDto(
                r.AssignmentId, r.EncounterId,
                enc?.PatientId ?? "", enc is null ? "" : names.GetValueOrDefault(enc.PatientId, ""),
                enc?.BedId ?? "",
                r.UserId, account?.Name ?? r.UserId, account?.JobTitle ?? "",
                r.Kind, r.Role, r.Shift,
                r.AssignedAt, r.AssignedBy, r.AssignedByRole,
                r.EndedAt, r.EndedBy, r.EndedByRole, r.EndReason);
        }).ToList();
    }
}

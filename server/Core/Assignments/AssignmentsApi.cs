using System.Security.Claims;
using Aurora.Core.Adt;
using Aurora.Core.Identity;
using Aurora.Core.Persistence;
using Aurora.Core.Shared;
using Microsoft.EntityFrameworkCore;

namespace Aurora.Core.Assignments;

/* ---------------- Patient Assignment endpoints (Aurora Core) ----------------
   AUTHORITY (locked decision 4): assignments.manage — SeniorDoctor. The
   validator: "Senior Doctor have all authorities"; no office/System
   Administrator (deciding who nurses a patient is a CLINICAL care
   decision, and both administrator profiles are barred from clinical
   data), and no new SeniorNurse profile FOR NOW ("don't create anything
   new") — the honest interim recorded in 02: in a real ICU the CHARGE
   NURSE allocates nursing, and the follow-up is simply a SeniorNurse
   profile row holding this same atom (the atom is the model — no schema
   change, no migration of assignments).

   VISIBILITY: everyone with patients.view can SEE assignments — knowing
   who is responsible for a patient is basic clinical safety, not
   privileged information. Only MANAGING them is gated.

   WORKLIST, NEVER AUTHORITY (locked decision 6): nothing here gates any
   clinical action, and no clinical endpoint consults this table.
   meds.administer stays global — a nurse responding to an arrest is
   never 403'd; the MAR/implement narrowing stays a client-side WORKFLOW
   derivation (MarApi's recorded rule), its source now real. */
static class AssignmentsApi
{
    public static void Map(WebApplication app)
    {
        /* GET /api/icu/assignments?patientId&encounterId&status=active|ended
           — the unit-wide read (patients.view). Ended assignments stay
           readable forever (ended-never-deleted); default serves ALL so
           history renders without a second call. */
        app.MapGet("/api/icu/assignments", (HttpContext ctx, ClaimsPrincipal user, AuroraDb db) =>
        {
            if (Rbac.Deny(user, "patients.view") is IResult denied) return denied;
            foreach (var key in ctx.Request.Query.Keys)
                if (key is not ("patientId" or "encounterId" or "status"))
                    return ApiError.BadRequest($"unknown query parameter '{key}'");
            var status = ctx.Request.Query["status"].ToString();
            if (status.Length > 0 && status is not ("active" or "ended"))
                return ApiError.BadRequest("status must be one of: active, ended");
            var patientId = ctx.Request.Query["patientId"].ToString();
            var encounterId = ctx.Request.Query["encounterId"].ToString();

            var rows = db.Assignments.AsNoTracking().OrderBy(a => a.Seq).AsEnumerable();
            if (encounterId.Length > 0) rows = rows.Where(a => a.EncounterId == encounterId);
            if (status == "active") rows = rows.Where(a => a.Active);
            if (status == "ended") rows = rows.Where(a => !a.Active);
            var list = rows.ToList();
            if (patientId.Length > 0)
            {
                var encIds = db.Encounters.AsNoTracking()
                    .Where(e => e.PatientId == patientId).Select(e => e.EncounterId).ToHashSet();
                list = list.Where(a => encIds.Contains(a.EncounterId)).ToList();
            }
            return Results.Json(AssignmentLogic.ToDtos(db, list), JsonOpts.Web);
        }).RequireAuthorization();

        /* GET /api/icu/assignments/mine — the signed-in clinician's ACTIVE
           worklist, derived entirely from the TOKEN (#104): userId = the
           sub claim, kind = the ACTIVE role's profile (Nurse → 'nurse';
           Doctor/SeniorDoctor → 'doctor'). Assignments bind to the USER
           and never change on a role switch — what changes is which KIND
           this read serves, so a dual-role person acting as Consultant
           sees their doctor panel, not their nurse assignments. A profile
           with no worklist kind gets an honest empty list. */
        app.MapGet("/api/icu/assignments/mine", (HttpContext ctx, ClaimsPrincipal user, AuroraDb db) =>
        {
            if (Rbac.Deny(user, "patients.view") is IResult denied) return denied;
            foreach (var key in ctx.Request.Query.Keys)
                return ApiError.BadRequest($"unknown query parameter '{key}'");
            /* MapInboundClaims is false (Program.cs) — the subject stays "sub" */
            var userId = user.FindFirst("sub")?.Value ?? "";
            var kind = AssignmentLogic.KindOfProfile(
                Rbac.ProfileOf(user.FindFirst("jobTitle")?.Value ?? ""));
            if (kind is null) return Results.Json(Array.Empty<AssignmentDto>(), JsonOpts.Web);
            var rows = db.Assignments.AsNoTracking()
                .Where(a => a.UserId == userId && a.Kind == kind && a.EndedAt == null)
                .OrderBy(a => a.Seq).ToList();
            return Results.Json(AssignmentLogic.ToDtos(db, rows), JsonOpts.Web);
        }).RequireAuthorization();

        /* GET /api/icu/assignments/staff — the assign picker: ACTIVE
           accounts holding at least one role whose profile carries a
           worklist kind. Gated on assignments.manage (it exists for the
           management surface; the account list proper stays users.view /
           System Administrator). The reserved system principal is
           inactive AND profile-less — excluded twice over. */
        app.MapGet("/api/icu/assignments/staff", (HttpContext ctx, ClaimsPrincipal user, AuroraDb db) =>
        {
            if (Rbac.Deny(user, "assignments.manage") is IResult denied) return denied;
            foreach (var key in ctx.Request.Query.Keys)
                return ApiError.BadRequest($"unknown query parameter '{key}'");
            var staff = db.Users.AsNoTracking().Where(u => u.Active).OrderBy(u => u.Username)
                .AsEnumerable()
                .Select(u => new AssignableStaffDto(u.Username, u.Name, u.JobTitle,
                    AssignmentLogic.KindsOf(u)))
                .Where(s => s.Kinds.Length > 0);
            return Results.Json(staff, JsonOpts.Web);
        }).RequireAuthorization();

        /* POST /api/icu/assignments — create (assignments.manage).
           Body: { patientId, userId, kind, role, shift }. The encounter is
           SERVER-RESOLVED from the patient's open encounter (the same
           chokepoint orders use): assigning responsibility on a closed
           episode is initiating care → 409. FOUR-CODE:
           - unknown patientId / userId, bad vocabulary, kind the account
             can NEVER hold (a pharmacist as nurse) → 400
           - deactivated account, no open encounter, or the SAME user+kind
             already active on this encounter (a replay) → 409
           - a SECOND nurse is NEVER a conflict (locked decision 1) —
             primary/secondary duplication included: two primaries is
             normal for ten minutes at handover and rendered plainly,
             never blocked. */
        app.MapPost("/api/icu/assignments", (CreateAssignmentRequest req, ClaimsPrincipal user, AuroraDb db) =>
        {
            if (Rbac.Deny(user, "assignments.manage") is IResult denied) return denied;
            foreach (var (name, value) in new[] {
                ("patientId", req.PatientId), ("userId", req.UserId),
                ("kind", req.Kind), ("role", req.Role), ("shift", req.Shift) })
                if (string.IsNullOrWhiteSpace(value))
                    return ApiError.BadRequest($"{name} is required");
            if (req.Kind is not ("nurse" or "doctor"))
                return ApiError.BadRequest("kind must be one of: nurse, doctor");
            if (req.Role is not ("primary" or "secondary"))
                return ApiError.BadRequest("role must be one of: primary, secondary");
            if (req.Shift is not ("day" or "night"))
                return ApiError.BadRequest("shift must be one of: day, night");
            if (!db.AdtPatients.AsNoTracking().Any(p => p.PatientId == req.PatientId))
                return ApiError.BadRequest($"patientId '{req.PatientId}' does not match any patient");
            var account = db.Users.AsNoTracking().FirstOrDefault(u => u.Username == req.UserId);
            if (account is null)
                return ApiError.BadRequest($"userId '{req.UserId}' does not match any user account — assignments reference real accounts, never free text");
            /* SHAPE, not state: an account with no role deriving the
               kind's profile can NEVER hold this assignment → 400 */
            if (!AssignmentLogic.KindsOf(account).Contains(req.Kind))
                return ApiError.BadRequest(
                    $"user '{account.Username}' ({account.JobTitle}) holds no role that can be assigned as {req.Kind}");
            /* STATE: the account exists but is deactivated → 409 (reactivation
               makes the same request succeed) */
            if (!account.Active)
                return ApiError.StateConflict($"user account '{account.Username}' is deactivated — reactivate it before assigning");
            if (EncounterGuard.RequireOpenForPatient(db, req.PatientId!, "assigning responsibility", out var open) is IResult conflict)
                return conflict;
            var existing = db.Assignments.AsNoTracking().AsEnumerable().FirstOrDefault(a =>
                a.EncounterId == open!.EncounterId && a.UserId == req.UserId
                && a.Kind == req.Kind && a.Active);
            if (existing is not null)
                return ApiError.StateConflict(
                    $"'{account.Name}' is already actively assigned as {existing.Role} {existing.Kind} on encounter "
                    + $"'{open!.EncounterId}' ({existing.AssignmentId}) — end that assignment first (handover), or assign a different clinician");

            var row = new PatientAssignment
            {
                AssignmentId = AssignmentLogic.NextId(),
                Seq = AssignmentLogic.NextSeq(db),
                EncounterId = open!.EncounterId,
                UserId = account.Username,
                Kind = req.Kind!, Role = req.Role!, Shift = req.Shift!,
                AssignedAt = AssignmentLogic.Now(),
                AssignedBy = user.FindFirst("name")?.Value ?? "Unknown",
                AssignedByRole = user.FindFirst("jobTitle")?.Value ?? "Unknown",
            };
            db.Assignments.Add(row);
            db.SaveChanges();
            return Results.Json(AssignmentLogic.ToDtos(db, [row]).Single(), JsonOpts.Web);
        }).RequireAuthorization();

        /* POST /api/icu/assignments/{assignmentId}/end — end (handover /
           correction; assignments.manage). Body: { reason? } — optional:
           ending at handover is routine, not exceptional. Ended, never
           deleted. FOUR-CODE: absent id → 404; already ended → 409 naming
           who ended it and when (the replay answer). */
        app.MapPost("/api/icu/assignments/{assignmentId}/end",
            (string assignmentId, EndAssignmentRequest? req, ClaimsPrincipal user, AuroraDb db) =>
        {
            if (Rbac.Deny(user, "assignments.manage") is IResult denied) return denied;
            if (req?.Reason?.Length > AdtLogic.MaxTextLength)
                return ApiError.BadRequest($"reason exceeds {AdtLogic.MaxTextLength} characters");
            var row = db.Assignments.FirstOrDefault(a => a.AssignmentId == assignmentId);
            if (row is null) return ApiError.NotFound();
            if (!row.Active)
                return ApiError.StateConflict(
                    $"assignment '{assignmentId}' already ended by {row.EndedBy} at {row.EndedAt} — there is nothing to end");
            row.EndedAt = AssignmentLogic.Now();
            row.EndedBy = user.FindFirst("name")?.Value ?? "Unknown";
            row.EndedByRole = user.FindFirst("jobTitle")?.Value ?? "Unknown";
            row.EndReason = string.IsNullOrWhiteSpace(req?.Reason) ? null : req!.Reason!.Trim();
            db.SaveChanges();
            return Results.Json(AssignmentLogic.ToDtos(db, [row]).Single(), JsonOpts.Web);
        }).RequireAuthorization();
    }
}

static class AssignmentLogic
{
    public static string Now() => DateTime.UtcNow.ToString("yyyy-MM-dd HH:mm");

    static int _seq;
    public static string NextId() => $"ASG-{Interlocked.Increment(ref _seq)}";

    /** id counter resumes from the highest persisted id (the codified
        persistence discipline — never a fixed constant). Seeds occupy
        ASG-1001…; the floor keeps generated ids in the family. */
    public static void InitializeCounters(AuroraDb db)
    {
        static int SuffixOf(string id) =>
            int.TryParse(id[(id.IndexOf('-') + 1)..], out var n) ? n : 0;
        _seq = db.Assignments.AsNoTracking().Select(a => a.AssignmentId).AsEnumerable()
            .Select(SuffixOf).DefaultIfEmpty(1000).Max();
    }

    public static int NextSeq(AuroraDb db) =>
        (db.Assignments.AsNoTracking().Max(a => (int?)a.Seq) ?? 0) + 1;

    /** which worklist KIND a permission profile reads as (the #104 rule's
        server half): Nurse → nurse; Doctor/SeniorDoctor → doctor; every
        other profile has no worklist. */
    public static string? KindOfProfile(string? profile) => profile switch
    {
        "Nurse" => "nurse",
        "Doctor" or "SeniorDoctor" => "doctor",
        _ => null,
    };

    /** every kind an ACCOUNT may be assigned as — the union over its
        roles (#104 multi-role: a dual-role person is assignable as both). */
    public static string[] KindsOf(UserRow account)
    {
        var titles = System.Text.Json.JsonSerializer
            .Deserialize<List<string>>(account.RolesJson, JsonOpts.Web) ?? [];
        if (titles.Count == 0) titles = [account.JobTitle];
        return titles.Select(t => KindOfProfile(Rbac.ProfileOf(t)))
            .Where(k => k is not null).Select(k => k!).Distinct().OrderBy(k => k).ToArray();
    }

    /** the read-side projection: patient/bed derived from the ENCOUNTER at
        read (patient-based responsibility — a transfer shows the new bed
        without the assignment changing), user display resolved from the
        referenced account (reference stored, display derived). */
    public static IEnumerable<AssignmentDto> ToDtos(AuroraDb db, IReadOnlyList<PatientAssignment> rows)
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

    /** THE DISCHARGE CASCADE (mirrors OrderLogic.DischargeCascade — the
        same one-rule lifecycle): closing the encounter ends its active
        assignments in the SAME transaction, audited with the discharging
        clinician as actor + active role and the named lifecycle reason.
        Responsibility ends with the episode; the rows remain forever. */
    public static int DischargeCascade(AuroraDb db, string encounterId, string actor, string actorRole)
    {
        var n = 0;
        var time = Now();
        foreach (var row in db.Assignments.Where(a => a.EncounterId == encounterId && a.EndedAt == null))
        {
            row.EndedAt = time;
            row.EndedBy = actor;
            row.EndedByRole = actorRole;
            row.EndReason = "ended at encounter close";
            n++;
        }
        return n;
    }
}

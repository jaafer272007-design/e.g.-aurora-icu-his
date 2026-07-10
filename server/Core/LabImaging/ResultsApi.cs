using System.Security.Claims;
using System.Text.Json;
using Aurora.Core.Adt;
using Aurora.Core.Identity;
using Aurora.Core.Orders;
using Aurora.Core.Persistence;
using Aurora.Core.Shared;
using Microsoft.EntityFrameworkCore;

namespace Aurora.Core.LabImaging;

/* ---------------- Laboratory & Imaging results (Stage 10 Phase 3) ----------------
   The canonical results service — same wire contract the mock adapter
   documents. All endpoints require a valid JWT; the acknowledge actions
   ADDITIONALLY require the results.acknowledge permission, derived
   server-side from the token's jobTitle claim via the same three-layer
   RBAC lookup the frontend uses (User → JobTitle → Profile → Permissions,
   computed at read time, never stored). A nurse token is rejected with a
   403 here regardless of what the UI shows — the first real server-side
   RBAC enforcement. The acknowledging actor is taken from the TOKEN's
   name claim, never from the request body (server-verified identity).

   RESULTS AUDIT PR — creation + un-acknowledgment. THE ENCOUNTER RULE IS
   ASYMMETRIC HERE, deliberately:
   - CREATING a result is initiating care → requires the patient's OPEN
     encounter (EncounterGuard, 409 on a closed episode) and is scoped to
     it (encounterId server-derived, never client-supplied).
   - ACKNOWLEDGING and UN-ACKNOWLEDGING are completing the record of care
     already given → they MUST succeed on a closed encounter. A blood
     culture drawn on day 3 that results on day 7, after discharge, must
     be acknowledgeable. EncounterGuard is NEVER called on these paths.
   Creation authority is the PRODUCING SERVICE's: results.create belongs
   to the Ancillary profile (lab/radiology technicians) — a doctor or
   nurse token gets 403 on create, mirroring how implement/administer flip
   polarity. Un-acknowledge mirrors acknowledge (results.acknowledge,
   doctor-only) and is NEVER a deletion: the original acknowledgment
   survives in the append-only event history; the reversal is its own
   audited event with a REQUIRED reason (the never-destroy principle from
   the Stage 11 override rule and Layer 3 deactivation). */
static class ResultsApi
{
    public static void Map(WebApplication app)
    {
        /* GET /api/icu/results/labs?patientId — all lab draws for a patient, oldest first. */
        app.MapGet("/api/icu/results/labs", (string patientId, AuroraDb db) =>
            Results.Json(db.LabDraws.AsNoTracking()
                .Where(d => d.PatientId == patientId)
                .OrderBy(d => d.LabId)
                .AsEnumerable()
                .Select(d => d.ToDto()), JsonOpts.Web))
            .RequireAuthorization();

        /* GET /api/icu/results/imaging?patientId — imaging studies incl. reports. */
        app.MapGet("/api/icu/results/imaging", (string patientId, AuroraDb db) =>
            Results.Json(db.ImagingStudies.AsNoTracking()
                .Where(s => s.PatientId == patientId)
                .OrderBy(s => s.StudyId)
                .AsEnumerable()
                .Select(s => s.ToDto()), JsonOpts.Web))
            .RequireAuthorization();

        /* GET /api/icu/results/inbox — unit-wide unacknowledged results, DERIVED at
           read time from the stored draws/studies (derived state is never stored). */
        app.MapGet("/api/icu/results/inbox", (AuroraDb db) =>
        {
            var labs = db.LabDraws.AsNoTracking().Where(d => !d.Acknowledged).AsEnumerable().Select(d =>
            {
                var items = JsonSerializer.Deserialize<List<LabItemDto>>(d.ItemsJson, JsonOpts.Web)!;
                var h = items.FirstOrDefault(i => i.Flag == "critical")
                    ?? items.FirstOrDefault(i => i.Flag == "abnormal") ?? items[0];
                var v = h.Value == Math.Floor(h.Value) ? ((long)h.Value).ToString() : h.Value.ToString("0.0");
                return new InboxItemDto("lab", d.LabId, d.PatientId, d.BedId, d.PatientName,
                    $"{h.Analyte} {v} {h.Unit} — {d.BedId} {d.PatientName}".Replace("  ", " "),
                    d.Note ?? $"{d.Panel} panel resulted", d.ResultedAt, d.Flag);
            });
            var imaging = db.ImagingStudies.AsNoTracking().Where(s => !s.Acknowledged).AsEnumerable().Select(s =>
                new InboxItemDto("imaging", s.StudyId, s.PatientId, s.BedId, s.PatientName,
                    $"{s.Description} {(s.Status == "preliminary" ? "prelim" : s.Status)} — {s.BedId} {s.PatientName}",
                    s.Note ?? s.Impression ?? "", s.ReportedAt ?? s.OrderedAt, s.Flag));
            return Results.Json(labs.Concat(imaging)
                .OrderByDescending(x => x.Time, StringComparer.Ordinal), JsonOpts.Web);
        }).RequireAuthorization();

        /* POST /api/icu/results/labs — CREATE a lab result (results audit PR).
           Ancillary RBAC (results.create — the producing service enters
           results; doctor/nurse tokens are 403'd). The result is scoped to
           the patient's OPEN encounter (409 if closed — initiating care)
           and arrives UNACKNOWLEDGED, entering the inbox. encounterId,
           bed/name snapshots, draw-level flag, timestamps, and the actor
           are all server-derived — none is accepted from the client. */
        app.MapPost("/api/icu/results/labs", (CreateLabRequest req, ClaimsPrincipal user, AuroraDb db) =>
        {
            if (Rbac.Deny(user, "results.create") is IResult denied) return denied;
            if (ResultsLogic.ValidateLabCreate(req, db) is string problem)
                return ApiError.BadRequest(problem);
            if (EncounterGuard.RequireOpenForPatient(db, req.PatientId!, "creating a lab result", out var enc) is IResult conflict)
                return conflict;
            var pt = db.AdtPatients.AsNoTracking().First(p => p.PatientId == req.PatientId);
            var actor = user.FindFirst("name")?.Value ?? "Unknown";
            var now = DateTime.UtcNow;
            var time = now.ToString("HH:mm");
            var items = req.Items!.Select(i => new LabItemFull(
                i.Analyte!, i.Value!.Value, i.Unit ?? "", i.RefRange!, i.RefLow!.Value, i.RefHigh!.Value, i.Flag!)).ToList();
            var row = new LabDrawRow
            {
                LabId = ResultsLogic.NextLabId(), PatientId = req.PatientId!,
                EncounterId = enc!.EncounterId, BedId = enc.BedId, PatientName = pt.Name,
                Panel = req.Panel!.Trim(), Label = req.Label!.Trim(),
                CollectedAt = time, ResultedAt = time,
                ItemsJson = JsonSerializer.Serialize(items, JsonOpts.Web),
                Flag = ResultsLogic.DeriveLabFlag(req.Items!), Note = req.Note?.Trim(),
                Acknowledged = false,
                EventsJson = JsonSerializer.Serialize(
                    new List<ResultEventDto> { new(now.ToString("yyyy-MM-dd HH:mm"), actor, "resulted", null) }, JsonOpts.Web),
            };
            db.LabDraws.Add(row);
            db.SaveChanges();
            return Results.Json(row.ToDto(), JsonOpts.Web);
        }).RequireAuthorization();

        /* POST /api/icu/results/imaging — CREATE an imaging result (same rules;
           the study is recorded at the RESULTED stage: report + impression
           present, status final — the ordered/performed pipeline stages
           arrive with the imaging ORDER workflow, not manual result entry). */
        app.MapPost("/api/icu/results/imaging", (CreateImagingRequest req, ClaimsPrincipal user, AuroraDb db) =>
        {
            if (Rbac.Deny(user, "results.create") is IResult denied) return denied;
            if (ResultsLogic.ValidateImagingCreate(req, db) is string problem)
                return ApiError.BadRequest(problem);
            if (EncounterGuard.RequireOpenForPatient(db, req.PatientId!, "creating an imaging result", out var enc) is IResult conflict)
                return conflict;
            var pt = db.AdtPatients.AsNoTracking().First(p => p.PatientId == req.PatientId);
            var actor = user.FindFirst("name")?.Value ?? "Unknown";
            var now = DateTime.UtcNow;
            var time = now.ToString("HH:mm");
            var row = new ImagingStudyRow
            {
                StudyId = ResultsLogic.NextStudyId(), PatientId = req.PatientId!,
                EncounterId = enc!.EncounterId, BedId = enc.BedId, PatientName = pt.Name,
                Modality = req.Modality!.Trim(), Description = req.Description!.Trim(),
                OrderedAt = time, PerformedAt = time, ReportedAt = time, Status = "final",
                Report = req.Report!.Trim(), Impression = req.Impression!.Trim(),
                Flag = req.Flag!, Note = req.Note?.Trim(),
                Acknowledged = false,
                EventsJson = JsonSerializer.Serialize(
                    new List<ResultEventDto> { new(now.ToString("yyyy-MM-dd HH:mm"), actor, "resulted", null) }, JsonOpts.Web),
            };
            db.ImagingStudies.Add(row);
            db.SaveChanges();
            return Results.Json(row.ToDto(), JsonOpts.Web);
        }).RequireAuthorization();

        /* POST /api/icu/results/labs/{labId}/acknowledge — doctor RBAC
           (results.acknowledge). NO EncounterGuard — acknowledging is
           completing the record and must succeed on a closed encounter.
           REPLAY IS A STATE CONFLICT (409), not absence: a result that is
           already acknowledged EXISTS — 404 is reserved for ids that
           resolve to nothing (the 403/404/409 convention codified by the
           encounter-scoping fix). Event times are DATED UTC (the users-
           audit convention — result audit trails span discharges and
           readmissions); the acknowledgedAt SUMMARY stays HH:mm (the
           bedside display contract, unchanged on the wire). */
        app.MapPost("/api/icu/results/labs/{labId}/acknowledge", (string labId, ClaimsPrincipal user, AuroraDb db) =>
        {
            if (Rbac.Deny(user, "results.acknowledge") is IResult denied) return denied;
            var d = db.LabDraws.FirstOrDefault(x => x.LabId == labId);
            if (d is null) return Results.Json(new { error = "Not found" }, JsonOpts.Web, statusCode: 404);
            if (d.Acknowledged)
                return ResultsLogic.StateConflict(
                    $"result '{labId}' is already acknowledged (by {d.AcknowledgedBy} at {d.AcknowledgedAt}) — it is not awaiting acknowledgment");
            var now = DateTime.UtcNow;
            d.Acknowledged = true;
            d.AcknowledgedBy = user.FindFirst("name")?.Value ?? "Unknown";
            d.AcknowledgedAt = now.ToString("HH:mm");
            d.EventsJson = ResultsLogic.AppendEvent(d.EventsJson,
                new(now.ToString("yyyy-MM-dd HH:mm"), d.AcknowledgedBy, "acknowledged", null));
            db.SaveChanges();
            return Results.Json(d.ToDto(), JsonOpts.Web);
        }).RequireAuthorization();

        /* POST /api/icu/results/imaging/{studyId}/acknowledge — doctor RBAC. */
        app.MapPost("/api/icu/results/imaging/{studyId}/acknowledge", (string studyId, ClaimsPrincipal user, AuroraDb db) =>
        {
            if (Rbac.Deny(user, "results.acknowledge") is IResult denied) return denied;
            var s = db.ImagingStudies.FirstOrDefault(x => x.StudyId == studyId);
            if (s is null) return Results.Json(new { error = "Not found" }, JsonOpts.Web, statusCode: 404);
            if (s.Acknowledged)
                return ResultsLogic.StateConflict(
                    $"result '{studyId}' is already acknowledged (by {s.AcknowledgedBy} at {s.AcknowledgedAt}) — it is not awaiting acknowledgment");
            var now = DateTime.UtcNow;
            s.Acknowledged = true;
            s.AcknowledgedBy = user.FindFirst("name")?.Value ?? "Unknown";
            s.AcknowledgedAt = now.ToString("HH:mm");
            s.EventsJson = ResultsLogic.AppendEvent(s.EventsJson,
                new(now.ToString("yyyy-MM-dd HH:mm"), s.AcknowledgedBy, "acknowledged", null));
            db.SaveChanges();
            return Results.Json(s.ToDto(), JsonOpts.Web);
        }).RequireAuthorization();

        /* POST /api/icu/results/labs/{labId}/unacknowledge — reverse an
           acknowledgment (own or another's). Doctor RBAC mirrors
           acknowledge; a REQUIRED reason is validated like discontinue.
           NEVER a deletion: the original acknowledgment stays in the event
           history; the reversal appends its own audited event; the
           current-state summary clears and the result RETURNS TO THE
           INBOX (derived from Acknowledged=false). NO EncounterGuard —
           completing the record stays allowed on a closed encounter. */
        app.MapPost("/api/icu/results/labs/{labId}/unacknowledge",
            (string labId, UnacknowledgeRequest req, ClaimsPrincipal user, AuroraDb db) =>
        {
            if (Rbac.Deny(user, "results.acknowledge") is IResult denied) return denied;
            if (string.IsNullOrWhiteSpace(req.Reason))
                return ApiError.BadRequest("reason is required to reverse an acknowledgment");
            if (req.Reason.Length > OrderLogic.MaxTextLength)
                return ApiError.BadRequest($"reason exceeds {OrderLogic.MaxTextLength} characters");
            var d = db.LabDraws.FirstOrDefault(x => x.LabId == labId);
            if (d is null) return Results.Json(new { error = "Not found" }, JsonOpts.Web, statusCode: 404);
            if (!d.Acknowledged)
                return ResultsLogic.StateConflict(
                    $"result '{labId}' is not acknowledged — there is no acknowledgment to reverse");
            var actor = user.FindFirst("name")?.Value ?? "Unknown";
            d.EventsJson = ResultsLogic.AppendEvent(d.EventsJson,
                new(DateTime.UtcNow.ToString("yyyy-MM-dd HH:mm"), actor, "unacknowledged",
                    $"acknowledgment by {d.AcknowledgedBy} at {d.AcknowledgedAt} reversed — {req.Reason.Trim()}"));
            d.Acknowledged = false;
            d.AcknowledgedBy = null;
            d.AcknowledgedAt = null;
            db.SaveChanges();
            return Results.Json(d.ToDto(), JsonOpts.Web);
        }).RequireAuthorization();

        /* POST /api/icu/results/imaging/{studyId}/unacknowledge — same rules. */
        app.MapPost("/api/icu/results/imaging/{studyId}/unacknowledge",
            (string studyId, UnacknowledgeRequest req, ClaimsPrincipal user, AuroraDb db) =>
        {
            if (Rbac.Deny(user, "results.acknowledge") is IResult denied) return denied;
            if (string.IsNullOrWhiteSpace(req.Reason))
                return ApiError.BadRequest("reason is required to reverse an acknowledgment");
            if (req.Reason.Length > OrderLogic.MaxTextLength)
                return ApiError.BadRequest($"reason exceeds {OrderLogic.MaxTextLength} characters");
            var s = db.ImagingStudies.FirstOrDefault(x => x.StudyId == studyId);
            if (s is null) return Results.Json(new { error = "Not found" }, JsonOpts.Web, statusCode: 404);
            if (!s.Acknowledged)
                return ResultsLogic.StateConflict(
                    $"result '{studyId}' is not acknowledged — there is no acknowledgment to reverse");
            var actor = user.FindFirst("name")?.Value ?? "Unknown";
            s.EventsJson = ResultsLogic.AppendEvent(s.EventsJson,
                new(DateTime.UtcNow.ToString("yyyy-MM-dd HH:mm"), actor, "unacknowledged",
                    $"acknowledgment by {s.AcknowledgedBy} at {s.AcknowledgedAt} reversed — {req.Reason.Trim()}"));
            s.Acknowledged = false;
            s.AcknowledgedBy = null;
            s.AcknowledgedAt = null;
            db.SaveChanges();
            return Results.Json(s.ToDto(), JsonOpts.Web);
        }).RequireAuthorization();
    }
}

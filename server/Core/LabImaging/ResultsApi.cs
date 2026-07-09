using System.Security.Claims;
using System.Text.Json;
using Aurora.Core.Identity;
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
   name claim, never from the request body (server-verified identity). */
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

        /* POST /api/icu/results/labs/{labId}/acknowledge — doctor RBAC (results.acknowledge). */
        app.MapPost("/api/icu/results/labs/{labId}/acknowledge", (string labId, ClaimsPrincipal user, AuroraDb db) =>
        {
            if (Rbac.Deny(user, "results.acknowledge") is IResult denied) return denied;
            var d = db.LabDraws.FirstOrDefault(x => x.LabId == labId && !x.Acknowledged);
            if (d is null) return Results.Json(new { error = "Not found" }, JsonOpts.Web, statusCode: 404);
            d.Acknowledged = true;
            d.AcknowledgedBy = user.FindFirst("name")?.Value ?? "Unknown";
            d.AcknowledgedAt = DateTime.UtcNow.ToString("HH:mm");
            db.SaveChanges();
            return Results.Json(d.ToDto(), JsonOpts.Web);
        }).RequireAuthorization();

        /* POST /api/icu/results/imaging/{studyId}/acknowledge — doctor RBAC. */
        app.MapPost("/api/icu/results/imaging/{studyId}/acknowledge", (string studyId, ClaimsPrincipal user, AuroraDb db) =>
        {
            if (Rbac.Deny(user, "results.acknowledge") is IResult denied) return denied;
            var s = db.ImagingStudies.FirstOrDefault(x => x.StudyId == studyId && !x.Acknowledged);
            if (s is null) return Results.Json(new { error = "Not found" }, JsonOpts.Web, statusCode: 404);
            s.Acknowledged = true;
            s.AcknowledgedBy = user.FindFirst("name")?.Value ?? "Unknown";
            s.AcknowledgedAt = DateTime.UtcNow.ToString("HH:mm");
            db.SaveChanges();
            return Results.Json(s.ToDto(), JsonOpts.Web);
        }).RequireAuthorization();
    }
}

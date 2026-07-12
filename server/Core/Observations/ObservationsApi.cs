using System.Security.Claims;
using Aurora.Core.Adt;
using Aurora.Core.Identity;
using Aurora.Core.Orders;
using Aurora.Core.Persistence;
using Aurora.Core.Shared;
using Microsoft.EntityFrameworkCore;

namespace Aurora.Core.Observations;

/* ---------------- Observations API (Stage 11 — first half: Manual) ----------------
   The Observation service of the locked one-way flow:
       (Device Adapter | manual entry) → Observation Service → Clinical
       Store → derived views.
   Today the MANUAL path is the only writer; the device adapter later
   becomes a SECOND caller of the same service. Structural guarantees:
   - provenance is server-set: the manual endpoint stamps
     source='manual', deviceId=null, verifiedBy=null; a payload
     attempting to claim any of them fails binding (Disallow → 400)
   - recording authority is observations.record (Doctor + Nurse — "a
     nurse or doctor must be able to chart what they measured", the
     clinical validator's requirement); every profile with patients.view
     may read
   - CHARTING a new value is initiating care → EncounterGuard, 409 on a
     closed episode (the results-creation precedent); CORRECTING an
     existing value (override) is completing the record → allowed on a
     closed encounter (the acknowledge precedent)
   - a correction NEVER rewrites the original: override sets the
     isOverridden/overrideValue/overrideReason triplet, value survives */
static class ObservationsApi
{
    public static void Map(WebApplication app)
    {
        /* GET /api/icu/observations/types — the closed type vocabulary
           (reference data; ONE source of truth for clients). */
        app.MapGet("/api/icu/observations/types", () =>
            Results.Json(ObservationLogic.Types.Select(t => new ObservationTypeDto(
                t.Type, t.Label, t.Unit, t.Kind, t.Group,
                t.Kind == "numeric" ? t.Min : null,
                t.Kind == "numeric" ? t.Max : null,
                t.Choices)), JsonOpts.Web))
            .RequireAuthorization();

        /* GET /api/icu/observations?patientId&type&encounterId — the
           chart, oldest first (capturedAt then id). Both roles read. */
        app.MapGet("/api/icu/observations", (HttpContext ctx, ClaimsPrincipal user, AuroraDb db) =>
        {
            if (Rbac.Deny(user, "patients.view") is IResult denied) return denied;
            foreach (var key in ctx.Request.Query.Keys)
                if (key is not ("patientId" or "type" or "encounterId"))
                    return ApiError.BadRequest($"unknown query parameter '{key}'");
            var patientId = ctx.Request.Query["patientId"].ToString();
            if (patientId.Length == 0)
                return ApiError.BadRequest("patientId is required");
            var type = ctx.Request.Query["type"].ToString();
            var encounterId = ctx.Request.Query["encounterId"].ToString();
            var q = db.Observations.AsNoTracking().Where(o => o.PatientId == patientId);
            if (type.Length > 0) q = q.Where(o => o.Type == type);
            if (encounterId.Length > 0) q = q.Where(o => o.EncounterId == encounterId);
            return Results.Json(q.OrderBy(o => o.CapturedAt).ThenBy(o => o.ObservationId)
                .AsEnumerable().Select(o => o.ToDto()), JsonOpts.Web);
        }).RequireAuthorization();

        /* POST /api/icu/observations — chart a manual observation SET.
           observations.record RBAC (Doctor + Nurse). Every entry is
           validated BEFORE anything is written; the set persists
           atomically (one bedside reading is one record action). */
        app.MapPost("/api/icu/observations", (RecordObservationsRequest req, ClaimsPrincipal user, AuroraDb db) =>
        {
            if (Rbac.Deny(user, "observations.record") is IResult denied) return denied;
            if (string.IsNullOrWhiteSpace(req.PatientId))
                return ApiError.BadRequest("patientId is required");
            if (!db.AdtPatients.AsNoTracking().Any(p => p.PatientId == req.PatientId))
                return ApiError.BadRequest($"patientId '{req.PatientId}' does not match any patient");
            if (ObservationLogic.ValidateCapturedAt(req.CapturedAt) is string bad)
                return ApiError.BadRequest(bad);
            if (req.Entries is null || req.Entries.Count == 0)
                return ApiError.BadRequest("at least one observation entry is required (entries[])");
            var seen = new HashSet<string>();
            foreach (var e in req.Entries)
            {
                var def = ObservationLogic.Resolve(e.Type?.Trim());
                if (def is null)
                    return ApiError.BadRequest(
                        $"type must be one of: {string.Join(", ", ObservationLogic.Types.Select(t => t.Type))}");
                if (!seen.Add(def.Type))
                    return ApiError.BadRequest($"duplicate type '{def.Type}' in one set — chart repeat measurements as separate sets with their own capturedAt");
                if (ObservationLogic.ValidateValue(def, e.Value) is string problem)
                    return ApiError.BadRequest(problem);
            }
            if (EncounterGuard.RequireOpenForPatient(db, req.PatientId!, "charting an observation", out var enc) is IResult conflict)
                return conflict;
            var recordedBy = user.FindFirst("name")?.Value ?? "Unknown";
            var rows = req.Entries.Select(e =>
            {
                var def = ObservationLogic.Resolve(e.Type!.Trim())!;
                return new ObservationRow
                {
                    ObservationId = ObservationLogic.NextId(),
                    PatientId = req.PatientId!, EncounterId = enc!.EncounterId,
                    Type = def.Type, Value = e.Value!.Trim(), Unit = def.Unit,
                    Source = "manual", DeviceId = null,
                    CapturedAt = req.CapturedAt!.Trim(), RecordedBy = recordedBy,
                    VerifiedBy = null, IsOverridden = false,
                };
            }).ToList();
            db.Observations.AddRange(rows);
            db.SaveChanges();
            return Results.Json(rows.Select(r => r.ToDto()), JsonOpts.Web);
        }).RequireAuthorization();

        /* POST /api/icu/observations/{id}/override — correct a
           mis-charted value with a REQUIRED reason. The original value is
           NEVER rewritten (the locked never-destroy rule). Completing
           the record → no EncounterGuard (allowed after discharge, the
           acknowledge precedent). Replaying an override is a STATE
           conflict: the model's single override slot already carries a
           correction, and overwriting it would destroy one. */
        app.MapPost("/api/icu/observations/{observationId}/override",
            (string observationId, OverrideObservationRequest req, ClaimsPrincipal user, AuroraDb db) =>
        {
            if (Rbac.Deny(user, "observations.record") is IResult denied) return denied;
            if (string.IsNullOrWhiteSpace(req.Reason))
                return ApiError.BadRequest("reason is required to override an observation");
            if (req.Reason.Length > OrderLogic.MaxTextLength)
                return ApiError.BadRequest($"reason exceeds {OrderLogic.MaxTextLength} characters");
            var o = db.Observations.FirstOrDefault(x => x.ObservationId == observationId);
            if (o is null) return ApiError.NotFound();
            if (o.IsOverridden)
                return ApiError.StateConflict(
                    $"observation '{observationId}' is already overridden ({o.OverrideValue} — {o.OverrideReason}); the model preserves one original and one correction");
            var def = ObservationLogic.Resolve(o.Type)!;
            if (ObservationLogic.ValidateValue(def, req.Value) is string problem)
                return ApiError.BadRequest(problem);
            o.IsOverridden = true;
            o.OverrideValue = req.Value!.Trim();
            o.OverrideReason = req.Reason.Trim();
            db.SaveChanges();
            return Results.Json(o.ToDto(), JsonOpts.Web);
        }).RequireAuthorization();
    }
}

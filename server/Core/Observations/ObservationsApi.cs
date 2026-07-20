using System.Security.Claims;
using Aurora.Core.Adt;
using Aurora.Core.Identity;
using Aurora.Core.Orders;
using Aurora.Core.Persistence;
using Aurora.Core.Shared;
using Microsoft.EntityFrameworkCore;
using System.Text.Json;

namespace Aurora.Core.Observations;

/* ---------------- Observations API — §12 step 1 surface ----------------
   The catalogue read + group enablement only. The Observation Service's
   write paths (manual charting, the two-tier corrections) are §12 step 2;
   the generic Observation TABLE ships now as the foundation.

   RBAC (design §4, decisions F1–F4):
   - the catalogue read is open to every authenticated profile (charting
     UIs filter on enabled; config UIs see everything)
   - group enable/disable is `observations.configure` — the
     Consultant-tier authority (the SeniorDoctor profile). HARD
     CONSTRAINT: never the office Administrator profile. */
static class ObservationsApi
{
    public static void Map(WebApplication app)
    {
        /* GET /api/icu/observations/catalog — groups in clinical order,
           each with its types; DISABLED groups included (config
           visibility) with their enabled flag honest. */
        app.MapGet("/api/icu/observations/catalog", (ClaimsPrincipal user, AuroraDb db) =>
        {
            var types = db.ObservationTypes.AsNoTracking().OrderBy(t => t.Seq).AsEnumerable()
                .Select(t => t.ToDto()).GroupBy(t => t.GroupCode).ToDictionary(g => g.Key, g => g.ToList());
            var groups = db.ObservationGroups.AsNoTracking().OrderBy(g => g.Seq).AsEnumerable()
                .Select(g => new CatalogGroupDto(g.GroupCode, g.DisplayName, g.Seq, g.Enabled,
                    types.GetValueOrDefault(g.GroupCode, [])));
            return Results.Json(groups, JsonOpts.Web);
        }).RequireAuthorization();

        /* POST /api/icu/observations/groups/{groupCode}/enable | /disable —
           the F3 configuration act: what does THIS deployment chart.
           observations.configure (Consultant-tier). FOUR-CODE: unknown
           group → 404; already in the requested state → 409 (replay is a
           state conflict, not a silent no-op); the toggle is stamped and
           its history append-only. */
        app.MapPost("/api/icu/observations/groups/{groupCode}/enable",
            (string groupCode, ClaimsPrincipal user, AuroraDb db) => Toggle(groupCode, true, user, db))
            .RequireAuthorization();
        app.MapPost("/api/icu/observations/groups/{groupCode}/disable",
            (string groupCode, ClaimsPrincipal user, AuroraDb db) => Toggle(groupCode, false, user, db))
            .RequireAuthorization();

        /* ---------------- §12 step 2 — the write paths ---------------- */

        /* GET /api/icu/observations?patientId&typeCode&encounterId — the
           chart, oldest first (clinicalTime then id). Every clinical
           viewer reads. */
        app.MapGet("/api/icu/observations", (HttpContext ctx, ClaimsPrincipal user, AuroraDb db) =>
        {
            if (Rbac.Deny(user, "patients.view") is IResult denied) return denied;
            foreach (var key in ctx.Request.Query.Keys)
                if (key is not ("patientId" or "typeCode" or "encounterId"))
                    return ApiError.BadRequest($"unknown query parameter '{key}'");
            var patientId = ctx.Request.Query["patientId"].ToString();
            if (patientId.Length == 0) return ApiError.BadRequest("patientId is required");
            var typeCode = ctx.Request.Query["typeCode"].ToString();
            var encounterId = ctx.Request.Query["encounterId"].ToString();
            var q = db.Observations.AsNoTracking().Where(o => o.PatientId == patientId);
            if (typeCode.Length > 0) q = q.Where(o => o.TypeCode == typeCode);
            if (encounterId.Length > 0) q = q.Where(o => o.EncounterId == encounterId);
            return Results.Json(q.OrderBy(o => o.ClinicalTime).ThenBy(o => o.ObservationId)
                .AsEnumerable().Select(o => o.ToDto()), JsonOpts.Web);
        }).RequireAuthorization();

        /* POST /api/icu/observations — chart a MANUAL round/ad-hoc set.
           observations.record (any doctor or nurse — §4 F1). clinicalTime
           and enteredAt are SERVER-stamped (§7: live charting, no
           back-dating). Every entry is validated against the CATALOGUE
           before anything is written; the set persists atomically.
           A type whose GROUP is disabled is a 409 (deployment state —
           enable the group and the same request succeeds); a DERIVED
           type is a 400 (shape — derived values are computed, never
           charted, ever). Charting is initiating care → EncounterGuard
           (409 on a closed episode). */
        app.MapPost("/api/icu/observations", (ChartObservationsRequest req, ClaimsPrincipal user, AuroraDb db) =>
        {
            if (Rbac.Deny(user, "observations.record") is IResult denied) return denied;
            if (string.IsNullOrWhiteSpace(req.PatientId))
                return ApiError.BadRequest("patientId is required");
            if (!db.AdtPatients.AsNoTracking().Any(p => p.PatientId == req.PatientId))
                return ApiError.BadRequest($"patientId '{req.PatientId}' does not match any patient");
            if (req.Entries is null || req.Entries.Count == 0)
                return ApiError.BadRequest("at least one observation entry is required (entries[])");
            var types = db.ObservationTypes.AsNoTracking().ToDictionary(t => t.TypeCode);
            var groups = db.ObservationGroups.AsNoTracking().ToDictionary(g => g.GroupCode);
            var seen = new HashSet<string>();
            var normalized = new List<(ObservationTypeRow Type, string Value)>();
            foreach (var e in req.Entries)
            {
                var code = e.TypeCode?.Trim() ?? "";
                if (!types.TryGetValue(code, out var t))
                    return ApiError.BadRequest($"typeCode '{code}' is not in the Observation Type Catalogue");
                if (t.IsDerived)
                    return ApiError.BadRequest($"'{t.TypeCode}' is a DERIVED value — it is computed from its inputs at read time, never charted");
                if (!t.Active)
                    return ApiError.StateConflict(
                        $"observation '{t.DisplayName}' is retired from this hospital's catalogue — historical records keep rendering it, but it is not newly chartable (a Consultant-tier user can reactivate it)");
                if (!seen.Add(t.TypeCode))
                    return ApiError.BadRequest($"duplicate typeCode '{t.TypeCode}' in one round — repeat measurements are separate rounds");
                if (!groups[t.GroupCode].Enabled)
                    return ApiError.StateConflict(
                        $"observation group '{t.GroupCode}' is disabled in this deployment's configuration — '{t.TypeCode}' is not charted here (a Consultant-tier user can enable the group)");
                var v = ObservationService.Normalize(t, e.Value, out var problem);
                if (problem is not null) return ApiError.BadRequest(problem);
                normalized.Add((t, v!));
            }
            if (EncounterGuard.RequireOpenForPatient(db, req.PatientId!, "charting an observation", out var enc) is IResult conflict)
                return conflict;
            var actor = user.FindFirst("name")?.Value ?? "Unknown";
            var now = DateTime.UtcNow;
            var rows = normalized.Select(x => new ObservationRow
            {
                ObservationId = ObservationCatalog.NextId(),
                PatientId = req.PatientId!, EncounterId = enc!.EncounterId,
                TypeCode = x.Type.TypeCode, Value = x.Value, Unit = x.Type.Unit,
                ClinicalTime = now.ToString("yyyy-MM-dd HH:mm"),
                Source = "manual", DeviceId = null,
                RecordedBy = actor,
                EnteredAt = now.ToString("yyyy-MM-dd HH:mm:ss"),
                VerifiedBy = null, AmendmentsJson = "[]",
            }).ToList();
            db.Observations.AddRange(rows);
            db.SaveChanges();
            return Results.Json(rows.Select(r => r.ToDto()), JsonOpts.Web);
        }).RequireAuthorization();

        /* POST /api/icu/observations/{id}/correct — the two-tier §8
           amendment. TIER 1 (self): the recorder, within the flat
           5-minute window from ENTRY — needs observations.record, reason
           OPTIONAL (recorded when given; the Q1 decision). TIER 2
           (everything else — another's entry, or the window closed) —
           needs observations.correct (Consultant-tier), reason REQUIRED.
           BOTH tiers amend-not-erase: the stored value is NEVER
           rewritten; the amendment appends {previousValue, newValue,
           amendedBy, amendedAt, reason, amenderRole}. Corrections are
           completing the record → allowed on a CLOSED encounter (§6),
           no EncounterGuard. RBAC ordering keeps 403 oracle-free: the
           weakest gate (observations.record — held by every possible
           corrector) answers BEFORE the lookup; the tier gate answers
           after, on a record the caller may read anyway. */
        app.MapPost("/api/icu/observations/{observationId}/correct",
            (string observationId, CorrectObservationRequest req, ClaimsPrincipal user, AuroraDb db) =>
        {
            if (Rbac.Deny(user, "observations.record") is IResult denied) return denied;
            var o = db.Observations.FirstOrDefault(x => x.ObservationId == observationId);
            if (o is null) return ApiError.NotFound();
            var actor = user.FindFirst("name")?.Value ?? "Unknown";
            var now = DateTime.UtcNow;
            var selfTier = ObservationService.IsSelfTier(o, actor, now);
            if (!selfTier)
            {
                if (Rbac.Deny(user, "observations.correct") is IResult deniedTier) return deniedTier;
                if (string.IsNullOrWhiteSpace(req.Reason))
                    return ApiError.BadRequest("reason is required for a Consultant-tier correction (outside the 5-minute self-correction window or on another clinician's entry)");
            }
            if (req.Reason is not null && req.Reason.Length > OrderLogic.MaxTextLength)
                return ApiError.BadRequest($"reason exceeds {OrderLogic.MaxTextLength} characters");
            var t = db.ObservationTypes.AsNoTracking().First(x => x.TypeCode == o.TypeCode);
            var newValue = ObservationService.Normalize(t, req.Value, out var problem);
            if (problem is not null) return ApiError.BadRequest(problem);
            var amendments = JsonSerializer.Deserialize<List<AmendmentDto>>(o.AmendmentsJson, JsonOpts.Web)!;
            var previous = amendments.Count > 0 ? amendments[^1].NewValue : o.Value;
            if (newValue == previous)
                return ApiError.StateConflict(
                    $"observation '{observationId}' already reads {previous}{(t.Unit == "" ? "" : $" {t.Unit}")} — there is nothing to correct");
            var role = Rbac.ProfileOf(user.FindFirst("jobTitle")?.Value ?? "") ?? "Unknown";
            amendments.Add(new(previous, newValue!, actor,
                now.ToString("yyyy-MM-dd HH:mm"), req.Reason?.Trim() ?? "", role));
            o.AmendmentsJson = JsonSerializer.Serialize(amendments, JsonOpts.Web);
            db.SaveChanges();
            return Results.Json(o.ToDto(), JsonOpts.Web);
        }).RequireAuthorization();
    }

    static IResult Toggle(string groupCode, bool enable, ClaimsPrincipal user, AuroraDb db)
    {
        if (Rbac.Deny(user, "observations.configure") is IResult denied) return denied;
        var g = db.ObservationGroups.FirstOrDefault(x => x.GroupCode == groupCode);
        if (g is null) return ApiError.NotFound();
        if (g.Enabled == enable)
            return ApiError.StateConflict(
                $"observation group '{groupCode}' is already {(enable ? "enabled" : "disabled")}" +
                (g.ChangedBy is null ? "" : $" (last changed by {g.ChangedBy} at {g.ChangedAt})"));
        var actor = user.FindFirst("name")?.Value ?? "Unknown";
        var now = DateTime.UtcNow.ToString("yyyy-MM-dd HH:mm");
        g.Enabled = enable;
        g.ChangedBy = actor;
        g.ChangedAt = now;
        var events = JsonSerializer.Deserialize<List<GroupEventDto>>(g.EventsJson, JsonOpts.Web)!;
        events.Add(new(now, actor, enable ? "enabled" : "disabled"));
        g.EventsJson = JsonSerializer.Serialize(events, JsonOpts.Web);
        db.SaveChanges();
        return Results.Json(g.ToDto(), JsonOpts.Web);
    }
}

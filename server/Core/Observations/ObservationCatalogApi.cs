using System.Security.Claims;
using System.Text.Json;
using Aurora.Core.Identity;
using Aurora.Core.MasterData;
using Aurora.Core.Persistence;
using Aurora.Core.Shared;
using Microsoft.EntityFrameworkCore;

namespace Aurora.Core.Observations;

/* ------- Observations Catalogue MANAGEMENT (the F3 v2 — the tenant) -------
   Hospitals ADD new observations (free-text name, the #145 correction;
   hidden system-generated obs_ identity) and SET flagging ranges — on the
   proven catalogue pattern (validated writes, append-only audit,
   deactivate-never-delete). The catalogue READ stays the existing
   /observations/catalog (extended additively).

   🔴 THE SAFETY SPLIT (design §2, validator-approved):
   - add a brand-new observation + set its ranges       → allowed
   - edit flagging ranges of a NON-SCORING existing one → allowed
   - touch ANY part of a NEWS2/SOFA score input          → 409 LOCKED
     (ObservationCatalog.ScoreInputTypes — the exhaustively-verified
     list; the whole definition AND the lifecycle are locked, because a
     renamed/re-united/retired input silently invalidates the score).
   DERIVED types are computed, never charted — nothing to range or
   retire, so they answer 409 too (state, not permission).

   RBAC: observations.configure (Consultant-tier / SeniorDoctor — the
   existing group-enablement authority; §6 of the design confirmed the
   atom). NEVER the office Administrator (the F2/F3 hard constraint —
   asserted in the suites). */
static class ObservationCatalogApi
{
    public static void Map(WebApplication app)
    {
        /* POST /api/icu/observation-catalog — add a CUSTOM observation
           (v1: numeric-with-range, the design's recommended first shape;
           other shapes recorded as deferred). Duplicate ACTIVE name →
           409 naming the holder (the #142/#145 integrity guard). */
        app.MapPost("/api/icu/observation-catalog", (CreateObservationTypeRequest req, ClaimsPrincipal user, AuroraDb db) =>
        {
            if (Rbac.Deny(user, "observations.configure") is IResult denied) return denied;
            var name = (req.Name ?? "").Trim();
            if (name.Length == 0) return ApiError.BadRequest("name is required — free text, exactly as it should read at the bedside");
            if (name.Length > FormularyLogic.MaxTextLength)
                return ApiError.BadRequest($"name exceeds {FormularyLogic.MaxTextLength} characters");
            var unit = (req.Unit ?? "").Trim();
            if (unit.Length > FormularyLogic.MaxTextLength)
                return ApiError.BadRequest($"unit exceeds {FormularyLogic.MaxTextLength} characters");
            var group = (req.Group ?? "").Trim();
            var g = db.ObservationGroups.AsNoTracking().FirstOrDefault(x => x.GroupCode == group);
            if (g is null)
                return ApiError.BadRequest($"group '{group}' is not an observation group — one of: "
                    + string.Join(", ", db.ObservationGroups.AsNoTracking().OrderBy(x => x.Seq).Select(x => x.GroupCode)));
            if (req.Min is not double min || req.Max is not double max)
                return ApiError.BadRequest("min and max are required — the PLAUSIBILITY bounds charting will accept (typo-catching, not clinical judgement)");
            if (!double.IsFinite(min) || !double.IsFinite(max) || min >= max)
                return ApiError.BadRequest("min/max must be finite numbers with min < max");
            if (ValidateRanges(req.RefLow, req.RefHigh, req.CritLow, req.CritHigh) is string rErr)
                return ApiError.BadRequest(rErr);
            var lowered = name.ToLowerInvariant();
            if (db.ObservationTypes.AsNoTracking().AsEnumerable()
                    .FirstOrDefault(t => t.Active && t.DisplayName.Trim().ToLowerInvariant() == lowered)
                is ObservationTypeRow dup)
                return ApiError.StateConflict(
                    $"an active observation named '{dup.DisplayName}' already exists in the catalogue — two identical charting entries would be indistinguishable; edit or retire the existing one");

            var actor = user.FindFirst("name")?.Value ?? "Unknown";
            var row = new ObservationTypeRow
            {
                TypeCode = FormularyLogic.NewKey("obs", id => db.ObservationTypes.AsNoTracking().Any(t => t.TypeCode == id)),
                GroupCode = g.GroupCode, DisplayName = name, Unit = unit,
                ValueType = "numeric", Min = min, Max = max,
                RefLow = req.RefLow, RefHigh = req.RefHigh, CritLow = req.CritLow, CritHigh = req.CritHigh,
                IsDerived = false, Optional = false, Active = true, ScoreInput = false, Custom = true,
                Seq = (db.ObservationTypes.Max(t => (int?)t.Seq) ?? 0) + 1,
                EventsJson = JsonSerializer.Serialize(
                    new List<FormularyEventDto> { new(FormularyLogic.Now(), actor, "added to catalogue", RangeNote(req.RefLow, req.RefHigh, req.CritLow, req.CritHigh)) }, JsonOpts.Web),
            };
            db.ObservationTypes.Add(row);
            db.SaveChanges();
            return Results.Json(row.ToDto(), JsonOpts.Web);
        }).RequireAuthorization();

        /* PUT /api/icu/observation-catalog/{typeCode} — edit.
           Custom entries: name/unit/plausibility/ranges (audited diffs).
           Seeded NON-scoring entries: FLAGGING RANGES ONLY (their §1
           definition is the taxonomy). Score inputs + derived: 409. */
        app.MapPut("/api/icu/observation-catalog/{typeCode}", (string typeCode, EditObservationTypeRequest req, ClaimsPrincipal user, AuroraDb db) =>
        {
            if (Rbac.Deny(user, "observations.configure") is IResult denied) return denied;
            var row = db.ObservationTypes.FirstOrDefault(t => t.TypeCode == typeCode);
            if (row is null) return ApiError.NotFound();
            if (Locked(row) is IResult locked) return locked;
            if (!req.HasAnyField) return ApiError.BadRequest("no recognized field to change");
            if (!row.Custom && req.HasNonRangeField)
                return ApiError.BadRequest(
                    $"only the flagging ranges (refLow/refHigh/critLow/critHigh) are editable on '{row.DisplayName}' — its definition is part of the seeded clinical taxonomy");
            if (row.ValueType != "numeric" && (req.RefLow ?? req.RefHigh ?? req.CritLow ?? req.CritHigh) is not null)
                return ApiError.BadRequest($"'{row.DisplayName}' is not a numeric observation — ranges apply to numeric types only");

            var name = req.Name?.Trim();
            if (name is { Length: 0 }) return ApiError.BadRequest("name must be non-empty when provided");
            if (name is { } n1 && n1.Length > FormularyLogic.MaxTextLength)
                return ApiError.BadRequest($"name exceeds {FormularyLogic.MaxTextLength} characters");
            if (req.Unit is { } u && u.Trim().Length > FormularyLogic.MaxTextLength)
                return ApiError.BadRequest($"unit exceeds {FormularyLogic.MaxTextLength} characters");
            var min = req.Min ?? row.Min; var max = req.Max ?? row.Max;
            if ((req.Min is not null || req.Max is not null)
                && (min is not double mn || max is not double mx || !double.IsFinite(mn) || !double.IsFinite(mx) || mn >= mx))
                return ApiError.BadRequest("min/max must be finite numbers with min < max");
            var refLow = req.RefLow ?? row.RefLow; var refHigh = req.RefHigh ?? row.RefHigh;
            var critLow = req.CritLow ?? row.CritLow; var critHigh = req.CritHigh ?? row.CritHigh;
            if (ValidateRanges(refLow, refHigh, critLow, critHigh) is string rErr)
                return ApiError.BadRequest(rErr);
            if (name is { } n2 && !n2.Equals(row.DisplayName, StringComparison.Ordinal))
            {
                var lowered = n2.ToLowerInvariant();
                if (db.ObservationTypes.AsNoTracking().AsEnumerable()
                        .FirstOrDefault(t => t.TypeCode != typeCode && t.Active && t.DisplayName.Trim().ToLowerInvariant() == lowered)
                    is ObservationTypeRow dup)
                    return ApiError.StateConflict(
                        $"an active observation named '{dup.DisplayName}' already exists in the catalogue — two identical charting entries would be indistinguishable");
            }

            var actor = user.FindFirst("name")?.Value ?? "Unknown";
            var events = new List<FormularyEventDto>();
            void DiffNum(string field, double? oldV, double? newV)
            {
                if (newV is null || Nullable.Equals(oldV, newV)) return;
                events.Add(new(FormularyLogic.Now(), actor, "changed", $"{field}: {oldV?.ToString() ?? "—"} → {newV}"));
            }
            if (name is { } nn && nn != row.DisplayName)
            {
                events.Add(new(FormularyLogic.Now(), actor, "changed", $"name: {row.DisplayName} → {nn}"));
                row.DisplayName = nn;
            }
            if (req.Unit is { } uu && uu.Trim() != row.Unit)
            {
                events.Add(new(FormularyLogic.Now(), actor, "changed", $"unit: {(row.Unit == "" ? "—" : row.Unit)} → {(uu.Trim() == "" ? "—" : uu.Trim())}"));
                row.Unit = uu.Trim();
            }
            DiffNum("min", row.Min, req.Min); if (req.Min is not null) row.Min = req.Min;
            DiffNum("max", row.Max, req.Max); if (req.Max is not null) row.Max = req.Max;
            DiffNum("refLow", row.RefLow, req.RefLow); if (req.RefLow is not null) row.RefLow = req.RefLow;
            DiffNum("refHigh", row.RefHigh, req.RefHigh); if (req.RefHigh is not null) row.RefHigh = req.RefHigh;
            DiffNum("critLow", row.CritLow, req.CritLow); if (req.CritLow is not null) row.CritLow = req.CritLow;
            DiffNum("critHigh", row.CritHigh, req.CritHigh); if (req.CritHigh is not null) row.CritHigh = req.CritHigh;
            if (events.Count == 0)
                return ApiError.BadRequest("no field change — the provided values match the current entry");
            row.EventsJson = FormularyLogic.AppendEvents(row.EventsJson, events);
            db.SaveChanges();
            return Results.Json(row.ToDto(), JsonOpts.Web);
        }).RequireAuthorization();

        /* POST /{typeCode}/deactivate — RETIRE: historical records keep
           rendering the type; it is no longer newly chartable. */
        app.MapPost("/api/icu/observation-catalog/{typeCode}/deactivate", (string typeCode, ClaimsPrincipal user, AuroraDb db) =>
        {
            if (Rbac.Deny(user, "observations.configure") is IResult denied) return denied;
            var row = db.ObservationTypes.FirstOrDefault(t => t.TypeCode == typeCode);
            if (row is null) return ApiError.NotFound();
            if (Locked(row) is IResult locked) return locked;
            if (!row.Active)
                return ApiError.StateConflict($"observation '{row.DisplayName}' is already retired — there is nothing to deactivate");
            var actor = user.FindFirst("name")?.Value ?? "Unknown";
            row.Active = false;
            row.EventsJson = FormularyLogic.AppendEvents(row.EventsJson,
                [new(FormularyLogic.Now(), actor, "retired", "historical records keep rendering it; not newly chartable")]);
            db.SaveChanges();
            return Results.Json(row.ToDto(), JsonOpts.Web);
        }).RequireAuthorization();

        /* POST /{typeCode}/reactivate */
        app.MapPost("/api/icu/observation-catalog/{typeCode}/reactivate", (string typeCode, ClaimsPrincipal user, AuroraDb db) =>
        {
            if (Rbac.Deny(user, "observations.configure") is IResult denied) return denied;
            var row = db.ObservationTypes.FirstOrDefault(t => t.TypeCode == typeCode);
            if (row is null) return ApiError.NotFound();
            if (Locked(row) is IResult locked) return locked;
            if (row.Active)
                return ApiError.StateConflict($"observation '{row.DisplayName}' is already active — there is nothing to reactivate");
            /* reactivation may not resurrect a duplicate charting entry */
            var lowered = row.DisplayName.Trim().ToLowerInvariant();
            if (db.ObservationTypes.AsNoTracking().AsEnumerable()
                    .FirstOrDefault(t => t.TypeCode != typeCode && t.Active && t.DisplayName.Trim().ToLowerInvariant() == lowered)
                is ObservationTypeRow dup)
                return ApiError.StateConflict(
                    $"an active observation named '{dup.DisplayName}' already exists — reactivating '{row.DisplayName}' would put two identical entries on the charting form");
            var actor = user.FindFirst("name")?.Value ?? "Unknown";
            row.Active = true;
            row.EventsJson = FormularyLogic.AppendEvents(row.EventsJson,
                [new(FormularyLogic.Now(), actor, "reactivated", null)]);
            db.SaveChanges();
            return Results.Json(row.ToDto(), JsonOpts.Web);
        }).RequireAuthorization();
    }

    /* 🔴 the lock verdicts — 409 (resource state/policy), never silent */
    static IResult? Locked(ObservationTypeRow row)
    {
        if (row.ScoreInput)
            return ApiError.StateConflict(
                $"'{row.DisplayName}' is LOCKED — it is a validated NEWS2/SOFA score input; editing or retiring it would silently turn a validated score into an unvalidated one. Score-input definitions are fixed (the danger list).");
        if (row.IsDerived)
            return ApiError.StateConflict(
                $"'{row.DisplayName}' is a DERIVED value — computed from its inputs at read time, never charted; there is nothing to edit or retire");
        return null;
    }

    /* the lab-analyte range rules reused: refLow <= refHigh; critical
       sits OUTSIDE the normal range on its own side */
    static string? ValidateRanges(double? refLow, double? refHigh, double? critLow, double? critHigh)
    {
        foreach (var (v, f) in new[] { (refLow, "refLow"), (refHigh, "refHigh"), (critLow, "critLow"), (critHigh, "critHigh") })
            if (v is double d && !double.IsFinite(d)) return $"{f} must be a finite number";
        if (refLow is double rl && refHigh is double rh && rl > rh)
            return "refLow must be <= refHigh (the normal range)";
        if (critLow is double cl && refLow is double rl2 && cl > rl2)
            return "critLow must be <= refLow (critical-low sits below the normal range)";
        if (critHigh is double ch && refHigh is double rh2 && ch < rh2)
            return "critHigh must be >= refHigh (critical-high sits above the normal range)";
        return null;
    }

    static string? RangeNote(double? refLow, double? refHigh, double? critLow, double? critHigh)
    {
        if ((refLow ?? refHigh ?? critLow ?? critHigh) is null) return "no flagging ranges set";
        var normal = refLow is null && refHigh is null ? null : $"normal {refLow?.ToString() ?? "—"}–{refHigh?.ToString() ?? "—"}";
        var crit = critLow is null && critHigh is null ? null : $"critical {critLow?.ToString() ?? "—"}/{critHigh?.ToString() ?? "—"}";
        return string.Join(" · ", new[] { normal, crit }.Where(s => s is not null));
    }
}

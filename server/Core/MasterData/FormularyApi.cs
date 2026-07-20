using System.Security.Claims;
using System.Text.Json;
using Aurora.Core.Identity;
using Aurora.Core.Persistence;
using Aurora.Core.Shared;
using Microsoft.EntityFrameworkCore;

namespace Aurora.Core.MasterData;

/* ------------- Formulary API (Layer 4 — Master Data, Aurora Core) -------------
   MAINTAINING THE FORMULARY IS PHARMACY'S AUTHORITY — the new
   formulary.manage permission sits on the Pharmacist profile (the same
   polarity flip as results.create on Ancillary): doctors, nurses and
   administrators get the generic 403 on every mutation; every
   authenticated profile may READ (prescribers search it, nurses check it).

   Every mutation is AUDITED on the drug's append-only event history
   (actor ALWAYS from the token's name claim, dated UTC times — the
   Layer 3 convention). Removing a drug is deactivation, never deletion.
   Four-code rule: 403 permission · 404 absent id · 409 state conflict
   (replayed de/reactivation, duplicate drugId on create — the conflict
   is with an EXISTING resource, the occupied-bed precedent) · 400
   malformed (unknown fields fail binding). The /api/icu/ prefix is
   accepted historical cosmetics. */
static class FormularyApi
{
    public static void Map(WebApplication app)
    {
        /* GET /api/icu/formulary — all drugs incl. inactive (management
           needs them; the ordering UI excludes inactive client-side, and
           the server enforces it at order create). Seq order = the mock
           store's authoring order. */
        app.MapGet("/api/icu/formulary", (HttpContext ctx, AuroraDb db) =>
        {
            foreach (var key in ctx.Request.Query.Keys)
                return ApiError.BadRequest($"unknown query parameter '{key}'");
            return Results.Json(db.FormularyDrugs.AsNoTracking().OrderBy(d => d.Seq)
                .AsEnumerable().Select(d => d.ToDto()), JsonOpts.Web);
        }).RequireAuthorization();

        /* GET /api/icu/formulary/frequencies — the named vocabulary, seed
           order (order validation = these ∪ q<1-48>h) */
        app.MapGet("/api/icu/formulary/frequencies", (HttpContext ctx, AuroraDb db) =>
        {
            foreach (var key in ctx.Request.Query.Keys)
                return ApiError.BadRequest($"unknown query parameter '{key}'");
            return Results.Json(FormularyLogic.NamedFrequencies(db), JsonOpts.Web);
        }).RequireAuthorization();

        /* GET /api/icu/formulary/interactions — pairwise rules, read-only
           this PR (the client-side safety checks consume them; moving the
           checks server-side is recorded scope) */
        app.MapGet("/api/icu/formulary/interactions", (HttpContext ctx, AuroraDb db) =>
        {
            foreach (var key in ctx.Request.Query.Keys)
                return ApiError.BadRequest($"unknown query parameter '{key}'");
            return Results.Json(db.InteractionRules.AsNoTracking().OrderBy(r => r.Id)
                .AsEnumerable().Select(r => r.ToDto()), JsonOpts.Web);
        }).RequireAuthorization();

        /* POST /api/icu/formulary — add a drug (Pharmacy). Everything is
           validated BEFORE the insert; a duplicate drugId is a 409 (the
           resource exists — the conflict names it). */
        app.MapPost("/api/icu/formulary", (CreateDrugRequest req, ClaimsPrincipal user, AuroraDb db) =>
        {
            if (Rbac.Deny(user, "formulary.manage") is IResult denied) return denied;

            /* free-text correction: the pharmacist types only the NAME —
               an omitted drugId is generated (hidden internal key);
               an explicit one (suites, the staging sync) stays accepted */
            var drugId = (req.DrugId ?? "").Trim();
            if (drugId.Length == 0)
                drugId = FormularyLogic.NewKey("drug", id => db.FormularyDrugs.AsNoTracking().Any(d => d.DrugId == id));
            else if (FormularyLogic.ValidateExplicitId("drugId", drugId) is string idErr)
                return ApiError.BadRequest(idErr);
            if (FormularyLogic.CheckText("name", req.Name, required: true) is string nErr) return ApiError.BadRequest(nErr);
            if (FormularyLogic.CheckText("drugClass", req.DrugClass, required: true) is string cErr) return ApiError.BadRequest(cErr);
            if (FormularyLogic.CheckText("form", req.Form, required: true) is string fErr) return ApiError.BadRequest(fErr);
            if (FormularyLogic.CheckText("defaultDose", req.DefaultDose, required: true) is string dErr) return ApiError.BadRequest(dErr);
            if (req.PrnCapable is null) return ApiError.BadRequest("prnCapable is required");
            /* required lists must be present AND non-empty; the allergy tag
               lists must be present but may be empty (no known allergy tags) */
            foreach (var (field, list, nonEmpty) in new (string, List<string>?, bool)[] {
                ("strengths", req.Strengths, true), ("doses", req.Doses, true),
                ("routes", req.Routes, true), ("frequencies", req.Frequencies, true),
                ("brandNames", req.BrandNames, false),
                ("allergyBlock", req.AllergyBlock, false), ("allergyWarn", req.AllergyWarn, false) })
            {
                if (list is null) return ApiError.BadRequest($"{field} is required (send [] when empty)");
                if (FormularyLogic.CheckList(field, list, nonEmpty) is string lErr) return ApiError.BadRequest(lErr);
            }
            if (FormularyLogic.CheckFrequencies(db, "frequencies", req.Frequencies) is string qErr)
                return ApiError.BadRequest(qErr);
            if (FormularyLogic.CheckDoseLimits(req.DoseLimits) is string dlErr) return ApiError.BadRequest(dlErr);
            if (db.FormularyDrugs.AsNoTracking().FirstOrDefault(d => d.DrugId == drugId) is FormularyDrugRow existing)
                return ApiError.StateConflict(
                    $"drug id '{drugId}' already exists in the formulary ({existing.Name}, {(existing.Active ? "active" : "inactive")}) — drug ids are permanent");
            /* with the id hidden, the NAME is the only identity a human
               sees — a duplicate ACTIVE name is refused (the imaging
               catalogue precedent); the id-dup check stays FIRST so
               identical re-posts keep their established 409 */
            var loweredName = req.Name!.Trim().ToLowerInvariant();
            if (db.FormularyDrugs.AsNoTracking().AsEnumerable()
                    .FirstOrDefault(d => d.Active && d.Name.Trim().ToLowerInvariant() == loweredName)
                is FormularyDrugRow dupName)
                return ApiError.StateConflict(
                    $"an active drug named '{dupName.Name}' already exists in the formulary — two identical entries would be indistinguishable when ordering; edit or retire the existing one");

            var actor = user.FindFirst("name")?.Value ?? "Unknown";
            var dto = new FormularyDrugDto(
                drugId, req.Name!.Trim(), req.BrandNames!, req.DrugClass!.Trim(), req.Form!.Trim(),
                req.Strengths!, req.Doses!, req.DefaultDose!.Trim(), NormalizeLimits(req.DoseLimits),
                req.Routes!, req.Frequencies!, req.PrnCapable.Value,
                req.AllergyBlock!, req.AllergyWarn!, Active: true,
                History: [new(FormularyLogic.Now(), actor, "added to formulary", null)]);
            var seq = (db.FormularyDrugs.Max(d => (int?)d.Seq) ?? 0) + 1;
            var row = FormularyDrugRow.FromDto(dto, seq);
            db.FormularyDrugs.Add(row);
            db.SaveChanges();
            return Results.Json(row.ToDto(), JsonOpts.Web);
        }).RequireAuthorization();

        /* PUT /api/icu/formulary/{drugId} — edit reference fields; drugId
           is the immutable natural key. A body with no recognized change
           is a 400, never a no-op. Every change is an audited diff. */
        app.MapPut("/api/icu/formulary/{drugId}", (string drugId, EditDrugRequest req, ClaimsPrincipal user, AuroraDb db) =>
        {
            if (Rbac.Deny(user, "formulary.manage") is IResult denied) return denied;
            var row = db.FormularyDrugs.FirstOrDefault(d => d.DrugId == drugId);
            if (row is null) return ApiError.NotFound();
            if (!req.HasAnyField)
                return ApiError.BadRequest("no recognized field to change");

            foreach (var (field, value) in new[] {
                ("name", req.Name), ("drugClass", req.DrugClass),
                ("form", req.Form), ("defaultDose", req.DefaultDose) })
            {
                if (value is not null && FormularyLogic.CheckText(field, value, required: true) is string tErr)
                    return ApiError.BadRequest(tErr);
            }
            foreach (var (field, list, nonEmpty) in new (string, List<string>?, bool)[] {
                ("strengths", req.Strengths, true), ("doses", req.Doses, true),
                ("routes", req.Routes, true), ("frequencies", req.Frequencies, true),
                ("brandNames", req.BrandNames, false),
                ("allergyBlock", req.AllergyBlock, false), ("allergyWarn", req.AllergyWarn, false) })
            {
                if (FormularyLogic.CheckList(field, list, nonEmpty) is string lErr) return ApiError.BadRequest(lErr);
            }
            if (FormularyLogic.CheckFrequencies(db, "frequencies", req.Frequencies) is string qErr)
                return ApiError.BadRequest(qErr);
            if (FormularyLogic.CheckDoseLimits(req.DoseLimits) is string dlErr) return ApiError.BadRequest(dlErr);
            if (req.Name is not null)
            {
                var loweredName = req.Name.Trim().ToLowerInvariant();
                if (db.FormularyDrugs.AsNoTracking().AsEnumerable()
                        .FirstOrDefault(d => d.DrugId != drugId && d.Active && d.Name.Trim().ToLowerInvariant() == loweredName)
                    is FormularyDrugRow dupName)
                    return ApiError.StateConflict(
                        $"an active drug named '{dupName.Name}' already exists in the formulary — two identical entries would be indistinguishable when ordering");
            }

            var actor = user.FindFirst("name")?.Value ?? "Unknown";
            var events = new List<FormularyEventDto>();
            void DiffText(string field, string? oldV, string? newV)
            {
                if (newV is null || newV.Trim() == oldV) return;
                events.Add(new(FormularyLogic.Now(), actor, "changed", $"{field}: {oldV} → {newV.Trim()}"));
            }
            void DiffList(string field, string json, List<string>? newList, Action<string> apply)
            {
                if (newList is null) return;
                var oldList = JsonSerializer.Deserialize<List<string>>(json, JsonOpts.Web)!;
                if (oldList.SequenceEqual(newList)) return;
                events.Add(new(FormularyLogic.Now(), actor, "changed",
                    $"{field}: {Fmt(oldList)} → {Fmt(newList)}"));
                apply(JsonSerializer.Serialize(newList, JsonOpts.Web));
            }

            DiffText("name", row.Name, req.Name);
            if (req.Name is not null) row.Name = req.Name.Trim();
            DiffText("drugClass", row.DrugClass, req.DrugClass);
            if (req.DrugClass is not null) row.DrugClass = req.DrugClass.Trim();
            DiffText("form", row.Form, req.Form);
            if (req.Form is not null) row.Form = req.Form.Trim();
            DiffText("defaultDose", row.DefaultDose, req.DefaultDose);
            if (req.DefaultDose is not null) row.DefaultDose = req.DefaultDose.Trim();
            DiffList("brandNames", row.BrandNamesJson, req.BrandNames, j => row.BrandNamesJson = j);
            DiffList("strengths", row.StrengthsJson, req.Strengths, j => row.StrengthsJson = j);
            DiffList("doses", row.DosesJson, req.Doses, j => row.DosesJson = j);
            DiffList("routes", row.RoutesJson, req.Routes, j => row.RoutesJson = j);
            DiffList("frequencies", row.FrequenciesJson, req.Frequencies, j => row.FrequenciesJson = j);
            DiffList("allergyBlock", row.AllergyBlockJson, req.AllergyBlock, j => row.AllergyBlockJson = j);
            DiffList("allergyWarn", row.AllergyWarnJson, req.AllergyWarn, j => row.AllergyWarnJson = j);
            if (req.PrnCapable is not null && req.PrnCapable != row.PrnCapable)
            {
                events.Add(new(FormularyLogic.Now(), actor, "changed",
                    $"prnCapable: {(row.PrnCapable ? "true" : "false")} → {(req.PrnCapable.Value ? "true" : "false")}"));
                row.PrnCapable = req.PrnCapable.Value;
            }
            if (req.DoseLimits is not null)
            {
                /* an all-null doseLimits object CLEARS the limits (partial
                   updates cannot otherwise express removal) */
                var newLimits = NormalizeLimits(req.DoseLimits);
                var newJson = newLimits is null ? null : JsonSerializer.Serialize(newLimits, JsonOpts.Web);
                if (newJson != row.DoseLimitsJson)
                {
                    events.Add(new(FormularyLogic.Now(), actor, "changed",
                        $"doseLimits: {row.DoseLimitsJson ?? "none"} → {newJson ?? "none"}"));
                    row.DoseLimitsJson = newJson;
                }
            }
            if (events.Count == 0)
                return ApiError.BadRequest("no field change — the provided values match the current drug");

            row.EventsJson = FormularyLogic.AppendEvents(row.EventsJson, events);
            db.SaveChanges();
            return Results.Json(row.ToDto(), JsonOpts.Web);
        }).RequireAuthorization();

        /* POST /api/icu/formulary/{drugId}/deactivate — status change,
           never a delete. Existing orders referencing the drug keep
           rendering; NEW orders for it are 409'd at create/modify. */
        app.MapPost("/api/icu/formulary/{drugId}/deactivate", (string drugId, ClaimsPrincipal user, AuroraDb db) =>
        {
            if (Rbac.Deny(user, "formulary.manage") is IResult denied) return denied;
            var row = db.FormularyDrugs.FirstOrDefault(d => d.DrugId == drugId);
            if (row is null) return ApiError.NotFound();
            if (!row.Active)
                return ApiError.StateConflict($"drug '{drugId}' is already inactive — there is nothing to deactivate");
            var actor = user.FindFirst("name")?.Value ?? "Unknown";
            row.Active = false;
            row.EventsJson = FormularyLogic.AppendEvents(row.EventsJson,
                [new(FormularyLogic.Now(), actor, "deactivated", null)]);
            db.SaveChanges();
            return Results.Json(row.ToDto(), JsonOpts.Web);
        }).RequireAuthorization();

        /* POST /api/icu/formulary/{drugId}/reactivate */
        app.MapPost("/api/icu/formulary/{drugId}/reactivate", (string drugId, ClaimsPrincipal user, AuroraDb db) =>
        {
            if (Rbac.Deny(user, "formulary.manage") is IResult denied) return denied;
            var row = db.FormularyDrugs.FirstOrDefault(d => d.DrugId == drugId);
            if (row is null) return ApiError.NotFound();
            if (row.Active)
                return ApiError.StateConflict($"drug '{drugId}' is already active — there is nothing to reactivate");
            /* reactivation may not resurrect a duplicate ordering entry */
            var loweredName = row.Name.Trim().ToLowerInvariant();
            if (db.FormularyDrugs.AsNoTracking().AsEnumerable()
                    .FirstOrDefault(d => d.DrugId != drugId && d.Active && d.Name.Trim().ToLowerInvariant() == loweredName)
                is FormularyDrugRow dupName)
                return ApiError.StateConflict(
                    $"an active drug named '{dupName.Name}' already exists in the formulary — reactivating '{row.Name}' would put two identical entries on the ordering menu");
            var actor = user.FindFirst("name")?.Value ?? "Unknown";
            row.Active = true;
            row.EventsJson = FormularyLogic.AppendEvents(row.EventsJson,
                [new(FormularyLogic.Now(), actor, "reactivated", null)]);
            db.SaveChanges();
            return Results.Json(row.ToDto(), JsonOpts.Web);
        }).RequireAuthorization();
    }

    static string Fmt(List<string> list) => list.Count == 0 ? "none" : string.Join(" · ", list);

    /** an all-null limits object normalizes to null (no limits) */
    static DoseLimitsDto? NormalizeLimits(DoseLimitsDto? limits) =>
        limits is null || (limits.Min is null && limits.Max is null
            && limits.MaxDaily is null && limits.PerKg is null) ? null : limits;
}

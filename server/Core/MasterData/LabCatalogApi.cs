using System.Security.Claims;
using System.Text.Json;
using Aurora.Core.Identity;
using Aurora.Core.Persistence;
using Aurora.Core.Shared;
using Microsoft.EntityFrameworkCore;

namespace Aurora.Core.MasterData;

/* ------------- Lab Catalogue API (Layer 4 phase 2 — Master Data) -------------
   MAINTAINING THE LAB CATALOGUE IS THE LABORATORY'S AUTHORITY — the new
   labcatalog.manage permission sits on the ANCILLARY profile (lab/
   radiology technicians), the same producing-service principle as
   results.create, but as its OWN permission: entering a transactional
   result and redefining reference ranges are different authorities, and
   permissions are the atoms of the RBAC model — they must not be
   conflated just because today's provisional profiles put both on
   Ancillary. Doctors, nurses, administrators → generic 403 on every
   mutation; every authenticated profile reads.

   Same conventions as the formulary: audited mutations (actor from the
   token, dated UTC), deactivation never deletion, four-code rule
   (duplicate testId 409, replayed de/reactivation 409, absent 404,
   malformed 400 with unknown fields failing binding). */
static class LabCatalogApi
{
    public static void Map(WebApplication app)
    {
        /* GET /api/icu/lab-catalog — all tests incl. inactive (management
           and historical rendering need them; ordering UIs filter). */
        app.MapGet("/api/icu/lab-catalog", (HttpContext ctx, AuroraDb db) =>
        {
            foreach (var key in ctx.Request.Query.Keys)
                return ApiError.BadRequest($"unknown query parameter '{key}'");
            return Results.Json(db.LabTests.AsNoTracking().OrderBy(t => t.Seq)
                .AsEnumerable().Select(t => t.ToDto()), JsonOpts.Web);
        }).RequireAuthorization();

        /* POST /api/icu/lab-catalog — add a test (Laboratory). The
           free-text correction (Imaging Catalogue Correction §3): the UI
           sends only a NAME — the testId (the panel key results render
           under) DEFAULTS to it, so the user types one friendly value
           with no format rules at all. An explicitly provided testId
           stays accepted (wire compatibility; suites and API callers). */
        app.MapPost("/api/icu/lab-catalog", (CreateLabTestRequest req, ClaimsPrincipal user, AuroraDb db) =>
        {
            if (Rbac.Deny(user, "labcatalog.manage") is IResult denied) return denied;

            var testId = (req.TestId ?? req.Name ?? "").Trim();
            if (LabCatalogLogic.ValidateTestId(testId) is string idErr) return ApiError.BadRequest(idErr);
            foreach (var (field, value) in new[] {
                ("name", req.Name), ("category", req.Category), ("specimen", req.Specimen) })
            {
                if (FormularyLogic.CheckText(field, value, required: true) is string tErr)
                    return ApiError.BadRequest(tErr);
            }
            if (LabCatalogLogic.ValidateAnalytes(req.Analytes) is string aErr) return ApiError.BadRequest(aErr);
            if (db.LabTests.AsNoTracking().FirstOrDefault(t => t.TestId == testId) is LabTestRow existing)
                return ApiError.StateConflict(
                    $"test id '{testId}' already exists in the catalogue ({existing.Name}, {(existing.Active ? "active" : "inactive")}) — test ids are permanent");

            var actor = user.FindFirst("name")?.Value ?? "Unknown";
            var dto = new LabTestDto(
                testId, req.Name!.Trim(), req.Category!.Trim(), req.Specimen!.Trim(),
                LabCatalogLogic.ToAnalytes(req.Analytes!), Active: true,
                History: [new(FormularyLogic.Now(), actor, "added to catalogue", null)]);
            var seq = (db.LabTests.Max(t => (int?)t.Seq) ?? 0) + 1;
            var row = LabTestRow.FromDto(dto, seq);
            db.LabTests.Add(row);
            db.SaveChanges();
            return Results.Json(row.ToDto(), JsonOpts.Web);
        }).RequireAuthorization();

        /* PUT /api/icu/lab-catalog/{testId} — edit reference fields; the
           testId is the immutable natural key. Audited field diffs. */
        app.MapPut("/api/icu/lab-catalog/{testId}", (string testId, EditLabTestRequest req, ClaimsPrincipal user, AuroraDb db) =>
        {
            if (Rbac.Deny(user, "labcatalog.manage") is IResult denied) return denied;
            var row = db.LabTests.FirstOrDefault(t => t.TestId == testId);
            if (row is null) return ApiError.NotFound();
            if (!req.HasAnyField) return ApiError.BadRequest("no recognized field to change");

            foreach (var (field, value) in new[] {
                ("name", req.Name), ("category", req.Category), ("specimen", req.Specimen) })
            {
                if (value is not null && FormularyLogic.CheckText(field, value, required: true) is string tErr)
                    return ApiError.BadRequest(tErr);
            }
            if (req.Analytes is not null && LabCatalogLogic.ValidateAnalytes(req.Analytes) is string aErr)
                return ApiError.BadRequest(aErr);

            var actor = user.FindFirst("name")?.Value ?? "Unknown";
            var events = new List<FormularyEventDto>();
            void Diff(string field, string oldV, string? newV, Action apply)
            {
                if (newV is null || newV.Trim() == oldV) return;
                events.Add(new(FormularyLogic.Now(), actor, "changed", $"{field}: {oldV} → {newV.Trim()}"));
                apply();
            }
            Diff("name", row.Name, req.Name, () => row.Name = req.Name!.Trim());
            Diff("category", row.Category, req.Category, () => row.Category = req.Category!.Trim());
            Diff("specimen", row.Specimen, req.Specimen, () => row.Specimen = req.Specimen!.Trim());
            if (req.Analytes is not null)
            {
                var newDefs = LabCatalogLogic.ToAnalytes(req.Analytes);
                var newJson = JsonSerializer.Serialize(newDefs, JsonOpts.Web);
                if (newJson != row.AnalytesJson)
                {
                    /* amend-not-erase (Option B §4): the audit event carries the
                       FULL prior definitions — a range/threshold change is
                       never silently overwritten; the old numbers stay on the
                       test's permanent history */
                    var oldDefs = JsonSerializer.Deserialize<List<AnalyteDefDto>>(row.AnalytesJson, JsonOpts.Web)!;
                    events.Add(new(FormularyLogic.Now(), actor, "changed",
                        $"analytes: {string.Join(" · ", oldDefs.Select(LabCatalogLogic.Describe))} → {string.Join(" · ", newDefs.Select(LabCatalogLogic.Describe))}"));
                    row.AnalytesJson = newJson;
                }
            }
            if (events.Count == 0)
                return ApiError.BadRequest("no field change — the provided values match the current test");

            row.EventsJson = FormularyLogic.AppendEvents(row.EventsJson, events);
            db.SaveChanges();
            return Results.Json(row.ToDto(), JsonOpts.Web);
        }).RequireAuthorization();

        /* POST /api/icu/lab-catalog/{testId}/deactivate — status change,
           never a delete. New ORDERS for the test 409; existing results
           keep rendering and RESULTING stays allowed (completing care). */
        app.MapPost("/api/icu/lab-catalog/{testId}/deactivate", (string testId, ClaimsPrincipal user, AuroraDb db) =>
        {
            if (Rbac.Deny(user, "labcatalog.manage") is IResult denied) return denied;
            var row = db.LabTests.FirstOrDefault(t => t.TestId == testId);
            if (row is null) return ApiError.NotFound();
            if (!row.Active)
                return ApiError.StateConflict($"test '{testId}' is already inactive — there is nothing to deactivate");
            var actor = user.FindFirst("name")?.Value ?? "Unknown";
            row.Active = false;
            row.EventsJson = FormularyLogic.AppendEvents(row.EventsJson,
                [new(FormularyLogic.Now(), actor, "deactivated", null)]);
            db.SaveChanges();
            return Results.Json(row.ToDto(), JsonOpts.Web);
        }).RequireAuthorization();

        /* POST /api/icu/lab-catalog/{testId}/reactivate */
        app.MapPost("/api/icu/lab-catalog/{testId}/reactivate", (string testId, ClaimsPrincipal user, AuroraDb db) =>
        {
            if (Rbac.Deny(user, "labcatalog.manage") is IResult denied) return denied;
            var row = db.LabTests.FirstOrDefault(t => t.TestId == testId);
            if (row is null) return ApiError.NotFound();
            if (row.Active)
                return ApiError.StateConflict($"test '{testId}' is already active — there is nothing to reactivate");
            var actor = user.FindFirst("name")?.Value ?? "Unknown";
            row.Active = true;
            row.EventsJson = FormularyLogic.AppendEvents(row.EventsJson,
                [new(FormularyLogic.Now(), actor, "reactivated", null)]);
            db.SaveChanges();
            return Results.Json(row.ToDto(), JsonOpts.Web);
        }).RequireAuthorization();

        /* DELETE /api/icu/lab-catalog/{testId} — Option B removal: a TRUE
           delete is allowed ONLY for a never-used test (no result and no
           order has ever referenced it — the recorded invariant: a test that
           has EVER been ordered or resulted must stay resolvable forever).
           A referenced test answers 409 directing the caller to DEACTIVATE
           (retire) instead — off the menu, unusable for new documentation,
           but every historical result keeps resolving its definition. The
           retire path is audited on the row's permanent history; a true
           delete removes the row itself, so its audit is the response +
           server log only (an honest limitation — a durable delete-audit
           would need a catalogue audit table, recorded as such). */
        app.MapDelete("/api/icu/lab-catalog/{testId}", (string testId, ClaimsPrincipal user, AuroraDb db) =>
        {
            if (Rbac.Deny(user, "labcatalog.manage") is IResult denied) return denied;
            var row = db.LabTests.FirstOrDefault(t => t.TestId == testId);
            if (row is null) return ApiError.NotFound();
            var results = db.LabDraws.AsNoTracking().Count(d => d.Panel == testId);
            var orders = db.Orders.AsNoTracking().Count(o => o.TestId == testId);
            if (results > 0 || orders > 0)
                return ApiError.StateConflict(
                    $"test '{testId}' is referenced by {results} result(s) and {orders} order(s) — a used test is never deleted; " +
                    "deactivate (retire) it instead: it leaves the menu and takes no new results, while its historical results stay readable forever");
            var actor = user.FindFirst("name")?.Value ?? "Unknown";
            var dto = row.ToDto();
            db.LabTests.Remove(row);
            db.SaveChanges();
            Console.WriteLine($"[AURORA] lab-catalog test '{testId}' ({dto.Name}) DELETED by {actor} at {FormularyLogic.Now()} — never used (0 results, 0 orders)");
            return Results.Json(dto, JsonOpts.Web);
        }).RequireAuthorization();
    }
}

static class LabCatalogLogic
{
    /** the catalogue row a testId resolves to, or null — order create uses
        this for the inactive-test 409; result creation for panel
        resolution (active OR inactive — resulting is never blocked by a
        reference-status change) */
    public static LabTestRow? Resolve(AuroraDb db, string testId) =>
        db.LabTests.AsNoTracking().FirstOrDefault(t => t.TestId == testId);

    /** all catalogue test ids in seed order — the panel vocabulary for
        result creation (moved here from ResultsLogic's hardcoded array,
        the NamedFrequencies precedent) */
    public static List<string> TestIds(AuroraDb db) =>
        db.LabTests.AsNoTracking().OrderBy(t => t.Seq).Select(t => t.TestId).ToList();

    /* the free-text correction: the old 2-64 letters/digits/hyphen rule
       rejected legitimate clinical names ("Blood Gas" — a space) and
       forced the user to fight a code. The panel key is USER-FACING (it
       renders as the result's panel label), so it stays exactly what the
       user typed — the only remaining bound is the platform-wide
       oversized-input guard, which is abuse protection, not a format. */
    public static string? ValidateTestId(string testId)
    {
        if (testId.Length == 0) return "name is required";
        if (testId.Length > FormularyLogic.MaxTextLength)
            return $"name exceeds {FormularyLogic.MaxTextLength} characters";
        return null;
    }

    public static string? ValidateAnalytes(List<AnalyteDefRequest>? analytes)
    {
        if (analytes is null) return "analytes is required (at least one component analyte)";
        if (analytes.Count == 0) return "analytes must contain at least one item";
        if (analytes.Count > FormularyLogic.MaxListItems)
            return $"analytes exceeds {FormularyLogic.MaxListItems} items";
        for (var i = 0; i < analytes.Count; i++)
        {
            var a = analytes[i];
            var at = $"analytes[{i}]";
            if (a is null) return $"{at} is null";
            if (FormularyLogic.CheckText($"{at}.analyte", a.Analyte, required: true) is string nErr) return nErr;
            /* unit may be EMPTY (pH, INR) but must be present and bounded */
            if (a.Unit is null) return $"{at}.unit is required (send \"\" for unitless analytes)";
            if (a.Unit.Length > FormularyLogic.MaxTextLength) return $"{at}.unit exceeds {FormularyLogic.MaxTextLength} characters";
            if (FormularyLogic.CheckText($"{at}.refRange", a.RefRange, required: true) is string rErr) return rErr;
            if (a.RefLow is null || !double.IsFinite(a.RefLow.Value)
                || a.RefHigh is null || !double.IsFinite(a.RefHigh.Value)
                || a.RefLow.Value > a.RefHigh.Value)
                return $"{at}.refLow/refHigh must be finite numbers with refLow <= refHigh";
            /* Option B critical thresholds: OPTIONAL per side; when present
               they must sit OUTSIDE (or at) the normal range — a critical
               bound inside the normal range would grade normal values
               critical, a definition error worth a precise 400 */
            if (a.CritLow is double cl && (!double.IsFinite(cl) || cl > a.RefLow.Value))
                return $"{at}.critLow must be a finite number <= refLow (critical-low sits below the normal range)";
            if (a.CritHigh is double ch && (!double.IsFinite(ch) || ch < a.RefHigh.Value))
                return $"{at}.critHigh must be a finite number >= refHigh (critical-high sits above the normal range)";
        }
        return null;
    }

    public static List<AnalyteDefDto> ToAnalytes(List<AnalyteDefRequest> analytes) =>
        analytes.Select(a => new AnalyteDefDto(
            a.Analyte!.Trim(), a.Unit!, a.RefRange!.Trim(), a.RefLow!.Value, a.RefHigh!.Value,
            a.CritLow, a.CritHigh)).ToList();

    /** one-line summary of an analyte definition for the audit trail —
        preserves the FULL prior definition (range + critical thresholds) in
        the change event, so an edit is amend-not-erase (Option B §4) */
    public static string Describe(AnalyteDefDto a) =>
        $"{a.Analyte}{(a.Unit == "" ? "" : $" {a.Unit}")} {a.RefLow}–{a.RefHigh}"
        + (a.CritLow is null && a.CritHigh is null ? "" : $" (crit {(a.CritLow?.ToString() ?? "—")}/{(a.CritHigh?.ToString() ?? "—")})");
}

using System.Security.Claims;
using Aurora.Core.Identity;
using Aurora.Core.Persistence;
using Aurora.Core.Shared;
using Microsoft.EntityFrameworkCore;

namespace Aurora.Core.MasterData;

/* ------------- Code Status vocabulary API (Master Data, Aurora Core) -------------
   MANAGING THE CODE-STATUS VOCABULARY IS CLINICAL GOVERNANCE — the new
   codestatus.manage permission sits on the SENIOR DOCTOR profile
   (consistent with observations.configure, and the same F2/F3 hard
   constraint: it NEVER sits on the office Administrator profile —
   clinical configuration is clinically governed). Every authenticated
   profile may READ (every bedside surface renders from it).

   Every mutation is AUDITED on the entry's append-only event history
   (actor from the token, dated UTC — the Layer 3 convention). Removal is
   deactivation, never deletion: an entry ever assigned to an encounter
   must stay resolvable forever. Four-code rule: 403 permission · 404
   absent code · 409 state conflict (duplicate code on create, replayed
   de/reactivation) · 400 malformed. ASSIGNING a code status to a patient
   is NOT here — that is the encounter-scoped clinical write
   (POST /api/icu/adt/encounters/{id}/code-status, codestatus.set). */
static class CodeStatusApi
{
    public static void Map(WebApplication app)
    {
        /* GET /api/icu/code-statuses — all entries incl. inactive
           (management needs them, and a RETIRED entry must keep resolving
           on records that carry it; assignment excludes inactive and the
           server enforces it). Seq = authoring order. */
        app.MapGet("/api/icu/code-statuses", (HttpContext ctx, AuroraDb db) =>
        {
            foreach (var key in ctx.Request.Query.Keys)
                return ApiError.BadRequest($"unknown query parameter '{key}'");
            return Results.Json(db.CodeStatuses.AsNoTracking().OrderBy(c => c.Seq)
                .AsEnumerable().Select(c => c.ToDto()), JsonOpts.Web);
        }).RequireAuthorization();

        /* POST /api/icu/code-statuses — add an entry (Senior Doctor).
           Codes are permanent natural keys: lowercase snake identifiers,
           duplicate → 409 naming the existing entry. */
        app.MapPost("/api/icu/code-statuses", (CreateCodeStatusRequest req, ClaimsPrincipal user, AuroraDb db) =>
        {
            if (Rbac.Deny(user, "codestatus.manage") is IResult denied) return denied;
            var code = (req.Code ?? "").Trim();
            if (code.Length == 0) return ApiError.BadRequest("code is required");
            if (!System.Text.RegularExpressions.Regex.IsMatch(code, "^[a-z0-9_]{2,40}$"))
                return ApiError.BadRequest("code must be 2-40 lowercase letters, digits or underscores (a permanent identifier, e.g. 'dnr_dni')");
            var label = (req.Label ?? "").Trim();
            if (label.Length == 0) return ApiError.BadRequest("label is required");
            if (label.Length > 60) return ApiError.BadRequest("label exceeds 60 characters");
            if (db.CodeStatuses.FirstOrDefault(c => c.Code == code) is CodeStatusRow existing)
                return ApiError.StateConflict(
                    $"code status '{code}' already exists ({existing.Label}, {(existing.Active ? "active" : "inactive")}) — codes are permanent");

            var actor = user.FindFirst("name")?.Value ?? "Unknown";
            var row = new CodeStatusRow
            {
                Code = code, Label = label,
                Seq = (db.CodeStatuses.Max(c => (int?)c.Seq) ?? 0) + 1,
                Active = true,
                EventsJson = System.Text.Json.JsonSerializer.Serialize(
                    new List<FormularyEventDto> { new(FormularyLogic.Now(), actor, "added to vocabulary", null) }, JsonOpts.Web),
            };
            db.CodeStatuses.Add(row);
            db.SaveChanges();
            return Results.Json(row.ToDto(), JsonOpts.Web);
        }).RequireAuthorization();

        /* PUT /api/icu/code-statuses/{code} — edit the label; the code is
           the immutable natural key. No-change → 400, audited diff. */
        app.MapPut("/api/icu/code-statuses/{code}", (string code, EditCodeStatusRequest req, ClaimsPrincipal user, AuroraDb db) =>
        {
            if (Rbac.Deny(user, "codestatus.manage") is IResult denied) return denied;
            var row = db.CodeStatuses.FirstOrDefault(c => c.Code == code);
            if (row is null) return ApiError.NotFound();
            var label = (req.Label ?? "").Trim();
            if (label.Length == 0) return ApiError.BadRequest("label is required");
            if (label.Length > 60) return ApiError.BadRequest("label exceeds 60 characters");
            if (label == row.Label)
                return ApiError.BadRequest("no field change — the provided label matches the current entry");
            var actor = user.FindFirst("name")?.Value ?? "Unknown";
            row.EventsJson = FormularyLogic.AppendEvents(row.EventsJson,
                [new(FormularyLogic.Now(), actor, "changed", $"label: {row.Label} → {label}")]);
            row.Label = label;
            db.SaveChanges();
            return Results.Json(row.ToDto(), JsonOpts.Web);
        }).RequireAuthorization();

        /* POST /api/icu/code-statuses/{code}/deactivate — RETIRE: a status
           change, never a delete. Records carrying the entry keep
           rendering it; NEW assignment of it is 409'd. */
        app.MapPost("/api/icu/code-statuses/{code}/deactivate", (string code, ClaimsPrincipal user, AuroraDb db) =>
        {
            if (Rbac.Deny(user, "codestatus.manage") is IResult denied) return denied;
            var row = db.CodeStatuses.FirstOrDefault(c => c.Code == code);
            if (row is null) return ApiError.NotFound();
            if (!row.Active)
                return ApiError.StateConflict($"code status '{code}' is already inactive — there is nothing to deactivate");
            var actor = user.FindFirst("name")?.Value ?? "Unknown";
            row.Active = false;
            row.EventsJson = FormularyLogic.AppendEvents(row.EventsJson,
                [new(FormularyLogic.Now(), actor, "retired", null)]);
            db.SaveChanges();
            return Results.Json(row.ToDto(), JsonOpts.Web);
        }).RequireAuthorization();

        /* POST /api/icu/code-statuses/{code}/reactivate */
        app.MapPost("/api/icu/code-statuses/{code}/reactivate", (string code, ClaimsPrincipal user, AuroraDb db) =>
        {
            if (Rbac.Deny(user, "codestatus.manage") is IResult denied) return denied;
            var row = db.CodeStatuses.FirstOrDefault(c => c.Code == code);
            if (row is null) return ApiError.NotFound();
            if (row.Active)
                return ApiError.StateConflict($"code status '{code}' is already active — there is nothing to reactivate");
            var actor = user.FindFirst("name")?.Value ?? "Unknown";
            row.Active = true;
            row.EventsJson = FormularyLogic.AppendEvents(row.EventsJson,
                [new(FormularyLogic.Now(), actor, "reactivated", null)]);
            db.SaveChanges();
            return Results.Json(row.ToDto(), JsonOpts.Web);
        }).RequireAuthorization();
    }
}

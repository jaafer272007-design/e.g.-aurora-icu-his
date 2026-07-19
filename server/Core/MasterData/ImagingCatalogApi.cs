using System.Security.Claims;
using Aurora.Core.Identity;
using Aurora.Core.LabImaging;
using Aurora.Core.Persistence;
using Aurora.Core.Shared;
using Microsoft.EntityFrameworkCore;

namespace Aurora.Core.MasterData;

/* ------------- Imaging Catalogue API (Master Data, Aurora Core) -------------
   MAINTAINING THE IMAGING CATALOGUE IS CLINICAL — the lab-catalogue
   gating, never the office Administrator. FLAGGED DECISION (design §2,
   recommendation followed): a DISTINCT imagingcatalog.manage atom rather
   than reusing labcatalog.manage — radiology and the laboratory are
   different producing services and a hospital may govern them separately
   — held by the SAME roles for now (Ancillary + SeniorDoctor; splitting
   later is a Rbac row edit, no schema change). Every authenticated
   profile may READ (ordering and result-entry render from it).

   Mirrors LabCatalogApi verbatim: audited mutations on the entry's
   append-only history, deactivate-never-delete (a retired study keeps
   rendering on records that carry it; NEW orders for it are 409'd), TRUE
   delete only for a never-ordered study (else 409 directing retire).
   Four-code rule: 403 permission · 404 absent · 409 state conflict ·
   400 malformed. */
static class ImagingCatalogApi
{
    public static void Map(WebApplication app)
    {
        /* GET /api/icu/imaging-catalog — all studies incl. inactive
           (management needs them; a retired study must keep resolving on
           orders that carry it; ordering excludes inactive and the
           server enforces it). Seq = authoring order. */
        app.MapGet("/api/icu/imaging-catalog", (HttpContext ctx, AuroraDb db) =>
        {
            foreach (var key in ctx.Request.Query.Keys)
                return ApiError.BadRequest($"unknown query parameter '{key}'");
            return Results.Json(db.ImagingCatalog.AsNoTracking().OrderBy(s => s.Seq)
                .AsEnumerable().Select(s => s.ToDto()), JsonOpts.Web);
        }).RequireAuthorization();

        /* POST /api/icu/imaging-catalog — add a study. Study ids are
           permanent natural keys (lowercase snake); modality must come
           from the ONE reconciled vocabulary (ResultsLogic). */
        app.MapPost("/api/icu/imaging-catalog", (CreateImagingStudyRequest req, ClaimsPrincipal user, AuroraDb db) =>
        {
            if (Rbac.Deny(user, "imagingcatalog.manage") is IResult denied) return denied;
            var studyId = (req.StudyId ?? "").Trim();
            if (studyId.Length == 0) return ApiError.BadRequest("studyId is required");
            if (!System.Text.RegularExpressions.Regex.IsMatch(studyId, "^[a-z0-9_]{2,40}$"))
                return ApiError.BadRequest("studyId must be 2-40 lowercase letters, digits or underscores (a permanent identifier, e.g. 'ct_head')");
            var name = (req.Name ?? "").Trim();
            if (name.Length == 0) return ApiError.BadRequest("name is required");
            if (name.Length > 80) return ApiError.BadRequest("name exceeds 80 characters");
            var modality = (req.Modality ?? "").Trim();
            if (!ResultsLogic.ImagingModalities.Contains(modality))
                return ApiError.BadRequest($"modality must be one of: {string.Join(", ", ResultsLogic.ImagingModalities)}");
            var region = (req.Region ?? "").Trim();
            if (region.Length > 40) return ApiError.BadRequest("region exceeds 40 characters");
            if (db.ImagingCatalog.FirstOrDefault(s => s.StudyId == studyId) is ImagingStudyDefRow existing)
                return ApiError.StateConflict(
                    $"study id '{studyId}' already exists in the catalogue ({existing.Name}, {(existing.Active ? "active" : "inactive")}) — study ids are permanent");

            var actor = user.FindFirst("name")?.Value ?? "Unknown";
            var row = new ImagingStudyDefRow
            {
                StudyId = studyId, Name = name, Modality = modality, Region = region,
                Contrast = req.Contrast ?? false, Portable = req.Portable ?? false,
                Seq = (db.ImagingCatalog.Max(s => (int?)s.Seq) ?? 0) + 1,
                Active = true,
                EventsJson = System.Text.Json.JsonSerializer.Serialize(
                    new List<FormularyEventDto> { new(FormularyLogic.Now(), actor, "added to catalogue", null) }, JsonOpts.Web),
            };
            db.ImagingCatalog.Add(row);
            db.SaveChanges();
            return Results.Json(row.ToDto(), JsonOpts.Web);
        }).RequireAuthorization();

        /* PUT /api/icu/imaging-catalog/{studyId} — edit reference fields;
           the study id is the immutable natural key. No-change → 400;
           every change lands an audited diff. */
        app.MapPut("/api/icu/imaging-catalog/{studyId}", (string studyId, EditImagingStudyRequest req, ClaimsPrincipal user, AuroraDb db) =>
        {
            if (Rbac.Deny(user, "imagingcatalog.manage") is IResult denied) return denied;
            var row = db.ImagingCatalog.FirstOrDefault(s => s.StudyId == studyId);
            if (row is null) return ApiError.NotFound();
            if (!req.HasAnyField) return ApiError.BadRequest("no editable field provided");

            var name = req.Name is null ? row.Name : req.Name.Trim();
            if (name.Length == 0) return ApiError.BadRequest("name is required");
            if (name.Length > 80) return ApiError.BadRequest("name exceeds 80 characters");
            var modality = req.Modality is null ? row.Modality : req.Modality.Trim();
            if (!ResultsLogic.ImagingModalities.Contains(modality))
                return ApiError.BadRequest($"modality must be one of: {string.Join(", ", ResultsLogic.ImagingModalities)}");
            var region = req.Region is null ? row.Region : req.Region.Trim();
            if (region.Length > 40) return ApiError.BadRequest("region exceeds 40 characters");
            var contrast = req.Contrast ?? row.Contrast;
            var portable = req.Portable ?? row.Portable;

            var changes = new List<string>();
            string Show(string v) => v.Length == 0 ? "(none)" : v;
            if (row.Name != name) changes.Add($"name: {row.Name} → {name}");
            if (row.Modality != modality) changes.Add($"modality: {row.Modality} → {modality}");
            if (row.Region != region) changes.Add($"region: {Show(row.Region)} → {Show(region)}");
            if (row.Contrast != contrast) changes.Add($"contrast: {row.Contrast} → {contrast}");
            if (row.Portable != portable) changes.Add($"portable: {row.Portable} → {portable}");
            if (changes.Count == 0)
                return ApiError.BadRequest("no field change — the provided values match the current entry");

            var actor = user.FindFirst("name")?.Value ?? "Unknown";
            row.EventsJson = FormularyLogic.AppendEvents(row.EventsJson,
                [new(FormularyLogic.Now(), actor, "changed", string.Join(", ", changes))]);
            row.Name = name; row.Modality = modality; row.Region = region;
            row.Contrast = contrast; row.Portable = portable;
            db.SaveChanges();
            return Results.Json(row.ToDto(), JsonOpts.Web);
        }).RequireAuthorization();

        /* POST /api/icu/imaging-catalog/{studyId}/deactivate — RETIRE:
           off the ordering menu (new orders 409), historical orders keep
           rendering the snapshot they carry. */
        app.MapPost("/api/icu/imaging-catalog/{studyId}/deactivate", (string studyId, ClaimsPrincipal user, AuroraDb db) =>
        {
            if (Rbac.Deny(user, "imagingcatalog.manage") is IResult denied) return denied;
            var row = db.ImagingCatalog.FirstOrDefault(s => s.StudyId == studyId);
            if (row is null) return ApiError.NotFound();
            if (!row.Active)
                return ApiError.StateConflict($"study '{studyId}' is already inactive — there is nothing to deactivate");
            var actor = user.FindFirst("name")?.Value ?? "Unknown";
            row.Active = false;
            row.EventsJson = FormularyLogic.AppendEvents(row.EventsJson,
                [new(FormularyLogic.Now(), actor, "retired", null)]);
            db.SaveChanges();
            return Results.Json(row.ToDto(), JsonOpts.Web);
        }).RequireAuthorization();

        /* POST /api/icu/imaging-catalog/{studyId}/reactivate */
        app.MapPost("/api/icu/imaging-catalog/{studyId}/reactivate", (string studyId, ClaimsPrincipal user, AuroraDb db) =>
        {
            if (Rbac.Deny(user, "imagingcatalog.manage") is IResult denied) return denied;
            var row = db.ImagingCatalog.FirstOrDefault(s => s.StudyId == studyId);
            if (row is null) return ApiError.NotFound();
            if (row.Active)
                return ApiError.StateConflict($"study '{studyId}' is already active — there is nothing to reactivate");
            var actor = user.FindFirst("name")?.Value ?? "Unknown";
            row.Active = true;
            row.EventsJson = FormularyLogic.AppendEvents(row.EventsJson,
                [new(FormularyLogic.Now(), actor, "reactivated", null)]);
            db.SaveChanges();
            return Results.Json(row.ToDto(), JsonOpts.Web);
        }).RequireAuthorization();

        /* DELETE /api/icu/imaging-catalog/{studyId} — the lab-catalogue
           rule: a TRUE delete only for a never-used study (no order has
           ever referenced it; imaging REPORTS reference orders, not study
           ids, so zero referencing orders implies zero linked reports — an
           unlinked report never referenced the catalogue at all). A
           referenced study answers 409 directing RETIRE. As with the lab
           catalogue, a true delete's audit is the response + server log
           (the row and its history are gone — recorded limitation). */
        app.MapDelete("/api/icu/imaging-catalog/{studyId}", (string studyId, ClaimsPrincipal user, AuroraDb db) =>
        {
            if (Rbac.Deny(user, "imagingcatalog.manage") is IResult denied) return denied;
            var row = db.ImagingCatalog.FirstOrDefault(s => s.StudyId == studyId);
            if (row is null) return ApiError.NotFound();
            var orders = db.Orders.AsNoTracking().Count(o => o.StudyId == studyId);
            if (orders > 0)
                return ApiError.StateConflict(
                    $"study '{studyId}' is referenced by {orders} order(s) — a used study is never deleted; " +
                    "deactivate (retire) it instead: it leaves the ordering menu while historical orders keep rendering");
            var actor = user.FindFirst("name")?.Value ?? "Unknown";
            var dto = row.ToDto();
            db.ImagingCatalog.Remove(row);
            db.SaveChanges();
            Console.WriteLine($"[AURORA] imaging-catalog study '{studyId}' ({dto.Name}) DELETED by {actor} at {FormularyLogic.Now()} — never used (0 orders)");
            return Results.Json(dto, JsonOpts.Web);
        }).RequireAuthorization();
    }
}

static class ImagingCatalogLogic
{
    /** the catalogue row a studyId resolves to, or null — order create
        uses this for the unknown-400 / inactive-409 checks */
    public static ImagingStudyDefRow? Resolve(AuroraDb db, string studyId) =>
        db.ImagingCatalog.AsNoTracking().FirstOrDefault(s => s.StudyId == studyId);
}

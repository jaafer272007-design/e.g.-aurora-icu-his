using System.Security.Claims;
using System.Text.Json;
using Aurora.Core.Identity;
using Aurora.Core.Orders;
using Aurora.Core.Persistence;
using Aurora.Core.Shared;
using Microsoft.EntityFrameworkCore;

namespace Aurora.Core.MasterData;

/* ------------- Order Sets API (Layer 4 phase 2 — Master Data) -------------
   MAINTAINING ORDER SETS is protocol authorship — assigned to the
   PHARMACIST profile (ordersets.manage) as its own permission: order sets
   are predominantly medication bundles governed alongside the formulary
   (a therapeutics-committee function Pharmacy stewards in this
   provisional model), but the permission stays a distinct atom so a
   future profile split costs a table edit, not a redesign. Doctors,
   nurses, administrators → generic 403 on set mutations; every
   authenticated profile reads.

   APPLYING a set is CLINICAL authority, not management authority: the
   apply endpoint requires the order-creation permissions and runs the
   composed drafts through OrdersApi.Create — the exact create path — so
   the encounter guard (discharged patient → 409), draft validation, and
   the inactive-drug/test 409s apply identically. A set is a convenience
   layer, never a bypass. NOTE: the client-side allergy screening the
   Orders screen performs when it expands a set is NOT yet replicated
   here — that is the recorded server-side safety-enforcement work item;
   until it ships, this endpoint applies every item.

   AUTHORING integrity: set items validate their SHAPE at create/edit
   (category/priority whitelists via the orders draft rules, complete
   medication fields, valid frequency, testId only on Lab items) and
   their REFERENCES must resolve — an unknown drugId/testId in a set
   definition is a 400 (reference data must be internally consistent, the
   per-drug-frequency precedent). A reference that resolves but is
   INACTIVE is allowed at authoring (it may be reactivated) and answers
   409 at APPLY time — resource state, per the four-code rule. */
static class OrderSetsApi
{
    public static void Map(WebApplication app)
    {
        /* GET /api/icu/order-sets — all sets incl. inactive (the ordering
           UI filters; management needs them) */
        app.MapGet("/api/icu/order-sets", (HttpContext ctx, AuroraDb db) =>
        {
            foreach (var key in ctx.Request.Query.Keys)
                return ApiError.BadRequest($"unknown query parameter '{key}'");
            return Results.Json(db.OrderSets.AsNoTracking().OrderBy(x => x.Seq)
                .AsEnumerable().Select(x => x.ToDto()), JsonOpts.Web);
        }).RequireAuthorization();

        /* POST /api/icu/order-sets — create a set (ordersets.manage) */
        app.MapPost("/api/icu/order-sets", (CreateOrderSetRequest req, ClaimsPrincipal user, AuroraDb db) =>
        {
            if (Rbac.Deny(user, "ordersets.manage") is IResult denied) return denied;

            var setId = (req.SetId ?? "").Trim();
            if (FormularyLogic.ValidateDrugId(setId) is string idErr)
                return ApiError.BadRequest(idErr.Replace("drugId", "setId"));
            if (FormularyLogic.CheckText("name", req.Name, required: true) is string nErr) return ApiError.BadRequest(nErr);
            if (FormularyLogic.CheckText("description", req.Description, required: true) is string dErr) return ApiError.BadRequest(dErr);
            if (ValidateItems(req.Items, db) is string iErr) return ApiError.BadRequest(iErr);
            if (db.OrderSets.AsNoTracking().FirstOrDefault(x => x.SetId == setId) is OrderSetRow existing)
                return ApiError.StateConflict(
                    $"set id '{setId}' already exists ({existing.Name}, {(existing.Active ? "active" : "inactive")}) — set ids are permanent");

            var actor = user.FindFirst("name")?.Value ?? "Unknown";
            var dto = new OrderSetDto(
                setId, req.Name!.Trim(), req.Description!.Trim(), ToItems(req.Items!),
                Active: true,
                History: [new(FormularyLogic.Now(), actor, "created", null)]);
            var seq = (db.OrderSets.Max(x => (int?)x.Seq) ?? 0) + 1;
            var row = OrderSetRow.FromDto(dto, seq);
            db.OrderSets.Add(row);
            db.SaveChanges();
            return Results.Json(row.ToDto(), JsonOpts.Web);
        }).RequireAuthorization();

        /* PUT /api/icu/order-sets/{setId} — edit name/description/items */
        app.MapPut("/api/icu/order-sets/{setId}", (string setId, EditOrderSetRequest req, ClaimsPrincipal user, AuroraDb db) =>
        {
            if (Rbac.Deny(user, "ordersets.manage") is IResult denied) return denied;
            var row = db.OrderSets.FirstOrDefault(x => x.SetId == setId);
            if (row is null) return ApiError.NotFound();
            if (!req.HasAnyField) return ApiError.BadRequest("no recognized field to change");
            foreach (var (field, value) in new[] { ("name", req.Name), ("description", req.Description) })
            {
                if (value is not null && FormularyLogic.CheckText(field, value, required: true) is string tErr)
                    return ApiError.BadRequest(tErr);
            }
            if (req.Items is not null && ValidateItems(req.Items, db) is string iErr)
                return ApiError.BadRequest(iErr);

            var actor = user.FindFirst("name")?.Value ?? "Unknown";
            var events = new List<FormularyEventDto>();
            if (req.Name is not null && req.Name.Trim() != row.Name)
            {
                events.Add(new(FormularyLogic.Now(), actor, "changed", $"name: {row.Name} → {req.Name.Trim()}"));
                row.Name = req.Name.Trim();
            }
            if (req.Description is not null && req.Description.Trim() != row.Description)
            {
                events.Add(new(FormularyLogic.Now(), actor, "changed", $"description: {row.Description} → {req.Description.Trim()}"));
                row.Description = req.Description.Trim();
            }
            if (req.Items is not null)
            {
                var newJson = JsonSerializer.Serialize(ToItems(req.Items), JsonOpts.Web);
                if (newJson != row.ItemsJson)
                {
                    var oldCount = JsonSerializer.Deserialize<List<OrderSetItemDto>>(row.ItemsJson, JsonOpts.Web)!.Count;
                    events.Add(new(FormularyLogic.Now(), actor, "changed", $"items: {oldCount} → {req.Items.Count} item(s) redefined"));
                    row.ItemsJson = newJson;
                }
            }
            if (events.Count == 0)
                return ApiError.BadRequest("no field change — the provided values match the current set");
            row.EventsJson = FormularyLogic.AppendEvents(row.EventsJson, events);
            db.SaveChanges();
            return Results.Json(row.ToDto(), JsonOpts.Web);
        }).RequireAuthorization();

        /* POST /api/icu/order-sets/{setId}/deactivate|reactivate */
        app.MapPost("/api/icu/order-sets/{setId}/deactivate", (string setId, ClaimsPrincipal user, AuroraDb db) =>
        {
            if (Rbac.Deny(user, "ordersets.manage") is IResult denied) return denied;
            var row = db.OrderSets.FirstOrDefault(x => x.SetId == setId);
            if (row is null) return ApiError.NotFound();
            if (!row.Active)
                return ApiError.StateConflict($"set '{setId}' is already inactive — there is nothing to deactivate");
            var actor = user.FindFirst("name")?.Value ?? "Unknown";
            row.Active = false;
            row.EventsJson = FormularyLogic.AppendEvents(row.EventsJson,
                [new(FormularyLogic.Now(), actor, "deactivated", null)]);
            db.SaveChanges();
            return Results.Json(row.ToDto(), JsonOpts.Web);
        }).RequireAuthorization();

        app.MapPost("/api/icu/order-sets/{setId}/reactivate", (string setId, ClaimsPrincipal user, AuroraDb db) =>
        {
            if (Rbac.Deny(user, "ordersets.manage") is IResult denied) return denied;
            var row = db.OrderSets.FirstOrDefault(x => x.SetId == setId);
            if (row is null) return ApiError.NotFound();
            if (row.Active)
                return ApiError.StateConflict($"set '{setId}' is already active — there is nothing to reactivate");
            var actor = user.FindFirst("name")?.Value ?? "Unknown";
            row.Active = true;
            row.EventsJson = FormularyLogic.AppendEvents(row.EventsJson,
                [new(FormularyLogic.Now(), actor, "reactivated", null)]);
            db.SaveChanges();
            return Results.Json(row.ToDto(), JsonOpts.Web);
        }).RequireAuthorization();

        /* POST /api/icu/order-sets/{setId}/apply — CLINICIAN authority.
           Composes the set's items into order drafts and runs them
           through OrdersApi.Create: same RBAC (orders.create/orders.sign
           checked THERE), same validation, same encounter guard (a
           discharged patient answers the same 409 a single order would),
           same inactive-drug/test 409s. Set-level state first: an
           INACTIVE set cannot be applied (409). */
        app.MapPost("/api/icu/order-sets/{setId}/apply", (string setId, ApplyOrderSetRequest req, ClaimsPrincipal user, AuroraDb db) =>
        {
            var row = db.OrderSets.AsNoTracking().FirstOrDefault(x => x.SetId == setId);
            if (row is null) return ApiError.NotFound();
            if (FormularyLogic.CheckText("patientId", req.PatientId, required: true) is string pErr)
                return ApiError.BadRequest(pErr);
            if (!row.Active)
                return ApiError.StateConflict($"set '{setId}' is inactive — it cannot be applied");
            var items = JsonSerializer.Deserialize<List<OrderSetItemDto>>(row.ItemsJson, JsonOpts.Web)!;
            var drafts = items.Select(it => new NewOrderDraftDto(
                req.PatientId, it.Category, it.Summary, it.Medication,
                it.Priority, it.RequiresImplementation, it.TestId)).ToList();
            return OrdersApi.Create(new CreateOrdersRequest(drafts, req.Sign,
                req.Note ?? $"applied order set: {row.Name}", req.OverrideJustification), user, db);
        }).RequireAuthorization();
    }

    /** set items validate the same SHAPE rules as order drafts (via
        OrderLogic.ValidateDraft against a synthetic draft) minus the
        patient — plus reference RESOLUTION: unknown drugId/testId in a
        set DEFINITION is a 400 (authoring inconsistency), while inactive
        references are deferred to apply time (409, resource state). */
    static string? ValidateItems(List<OrderSetItemRequest>? items, AuroraDb db)
    {
        if (items is null || items.Count == 0) return "items must contain at least one order template";
        if (items.Count > FormularyLogic.MaxListItems) return $"items exceeds {FormularyLogic.MaxListItems} items";
        for (var i = 0; i < items.Count; i++)
        {
            var it = items[i];
            var at = $"items[{i}]";
            if (it is null) return $"{at} is null";
            /* reuse the draft's own shape rules — category/priority
               whitelists, medication completeness, frequency vocabulary,
               testId-only-on-Lab — with a patient known to exist so only
               ITEM problems can surface */
            var probe = new NewOrderDraftDto(
                db.AdtPatients.AsNoTracking().Select(p => p.PatientId).FirstOrDefault() ?? "",
                it.Category, it.Summary, it.Medication, it.Priority,
                it.RequiresImplementation, it.TestId);
            /* ValidateDraft now enforces formulary/catalogue AUTHORITY
               itself (safety enforcement) — unknown drugId/testId in a
               definition surfaces through the shared 400 text */
            if (OrderLogic.ValidateDraft(probe, i, db) is string shape)
                return shape.Replace($"drafts[{i}]", at);
        }
        return null;
    }

    static List<OrderSetItemDto> ToItems(List<OrderSetItemRequest> items) =>
        items.Select(it => new OrderSetItemDto(
            it.Category!, it.Summary, it.Medication, it.TestId, it.Priority!, it.RequiresImplementation)).ToList();
}

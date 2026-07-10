using System.Security.Claims;
using System.Text.Json;
using Aurora.Core.Adt;
using Aurora.Core.Identity;
using Aurora.Core.Persistence;
using Aurora.Core.Shared;
using Microsoft.EntityFrameworkCore;

namespace Aurora.Core.Orders;

/* ---------------- Orders & Medication (Stage 10 Phase 3, Orders PR) ----------------
   The canonical orders service — full order lifecycle behind JWT auth with
   the same server-side RBAC pattern as results: create/sign/modify/
   discontinue require the doctor-level permissions, implement requires the
   nurse's orders.implement — each derived from the token's jobTitle claim
   at read time. A nurse token gets a generic 403 on every prescriber
   mutation even when the UI is bypassed. The acting/signing actor is ALWAYS
   the token's name claim, never a request field. */
static class OrdersApi
{
    public static void Map(WebApplication app)
    {
        /* GET /api/icu/orders?patientId&status&implement — filtered order list
           (per-patient full list incl. audit history, pending signature queue,
           nursing implementation queue — the same derived views the mock serves). */
        app.MapGet("/api/icu/orders", (string? patientId, string? status, bool? implement, AuroraDb db) =>
        {
            var q = db.Orders.AsNoTracking().AsQueryable();
            if (patientId is not null) q = q.Where(o => o.PatientId == patientId);
            if (status is not null) q = q.Where(o => o.Status == status);
            if (implement == true) q = q.Where(o => o.Status == "active" && o.RequiresImplementation == true);
            /* ENCOUNTER SCOPE, defense in depth: the WORKING QUEUES (the
               pending/active status views and the implementation queue)
               derive only from orders whose encounter is OPEN — discharge
               already discontinues them (the invariant), so on healthy
               data this filter changes nothing; it exists so a stray
               closed-encounter active order can never reach a clinician's
               queue. The plain per-patient chart stays LONGITUDINAL
               (person-level history; readmission presentation is a
               recorded open question). */
            if (status is "pending" or "active" || implement == true)
            {
                var open = db.Encounters.Where(e => e.Status == "open").Select(e => e.EncounterId);
                q = q.Where(o => open.Contains(o.EncounterId));
            }
            return Results.Json(q.OrderBy(o => o.Seq).AsEnumerable().Select(o => o.ToDto()), JsonOpts.Web);
        }).RequireAuthorization();

        /* POST /api/icu/orders — create order(s); sign=true activates immediately.
           Body: { drafts: NewOrderDraft[], sign, note? }. Patient name/bed are
           resolved server-side from the roster (denormalized display snapshot).
           A payload that doesn't match the contract is REJECTED with 400 — never
           a 200 that silently creates nothing (a client believing an order was
           placed when it wasn't is a patient-safety failure). Unrecognized JSON
           fields are rejected at binding time (see the request DTOs' Disallow
           attributes), and every draft is validated BEFORE any is inserted so a
           bad batch creates zero orders, never a partial one. */
        app.MapPost("/api/icu/orders", (CreateOrdersRequest req, ClaimsPrincipal user, AuroraDb db) =>
        {
            if (Rbac.Deny(user, "orders.create") is IResult d1) return d1;
            if (req.Sign && Rbac.Deny(user, "orders.sign") is IResult d2) return d2;

            if (req.Drafts is null || req.Drafts.Count == 0)
                return ApiError.BadRequest("At least one order draft is required (drafts[])");
            if (req.Note?.Length > OrderLogic.MaxTextLength)
                return ApiError.BadRequest($"note exceeds {OrderLogic.MaxTextLength} characters");
            for (var i = 0; i < req.Drafts.Count; i++)
            {
                if (OrderLogic.ValidateDraft(req.Drafts[i], i, db) is string problem)
                    return ApiError.BadRequest(problem);
            }
            /* THE CHOKEPOINT (409, resource state): every draft's patient
               must have an OPEN encounter before ANY order is inserted —
               new care cannot be initiated on a closed episode. The open
               encounter also provides the order's lifecycle scope. */
            var openByPatient = new Dictionary<string, Encounter>();
            foreach (var draft in req.Drafts)
            {
                if (openByPatient.ContainsKey(draft.PatientId!)) continue;
                if (EncounterGuard.RequireOpenForPatient(db, draft.PatientId!, "creating orders", out var openEnc) is IResult conflict)
                    return conflict;
                openByPatient[draft.PatientId!] = openEnc!;
            }

            var actor = user.FindFirst("name")?.Value ?? "Unknown";
            var time = DateTime.UtcNow.ToString("HH:mm");
            var created = new List<OrderDto>();
            foreach (var draft in req.Drafts)
            {
                /* Layer 2: name/bed resolution reads Core ADT (Patient +
                   open Encounter) — the former roster-table seam site */
                var pt = db.AdtPatients.AsNoTracking().First(p => p.PatientId == draft.PatientId);
                var enc = openByPatient[draft.PatientId!];
                var history = new List<OrderEventDto> { new(time, actor, "created", req.Note) };
                List<AdminDto>? administrations = null;
                if (req.Sign)
                {
                    history.Add(new(time, actor, "signed", null));
                    if (draft.Medication is not null) administrations = OrderLogic.GenerateAdministrations(draft.Medication);
                }
                var dto = new OrderDto(
                    OrderLogic.NextOrderId(), draft.PatientId!, enc.EncounterId, enc.BedId, pt.Name,
                    draft.Category!, draft.Summary ?? OrderLogic.MedSummary(draft.Medication!),
                    draft.Medication, draft.Priority!, req.Sign ? "active" : "pending",
                    actor, time, draft.RequiresImplementation, administrations, history, null);
                db.Orders.Add(OrderRow.FromDto(dto, OrderLogic.NextSeq()));
                created.Add(dto);
            }
            db.SaveChanges();
            return Results.Json(created, JsonOpts.Web);
        }).RequireAuthorization();

        /* POST /api/icu/orders/{orderId}/sign — doctor RBAC (orders.sign).
           FOUR-CODE RULE (state-conflict PR): the lookup is by id ALONE —
           an absent id is 404; an order that exists but is not pending is
           a 409 naming its current state (the state used to be folded
           into the lookup, making a replayed sign look like absence).
           The encounter guard runs BEFORE the status check so a closed
           episode reports its deeper cause, matching the administer
           precedent. */
        app.MapPost("/api/icu/orders/{orderId}/sign", (string orderId, ClaimsPrincipal user, AuroraDb db) =>
        {
            if (Rbac.Deny(user, "orders.sign") is IResult denied) return denied;
            var row = db.Orders.FirstOrDefault(x => x.OrderId == orderId);
            if (row is null) return ApiError.NotFound();
            if (EncounterGuard.RequireOpen(db, row.EncounterId, "signing an order") is IResult conflict) return conflict;
            if (row.Status != "pending")
                return ApiError.StateConflict(
                    $"order '{orderId}' is {(row.Status == "active" ? "already active" : row.Status)} — it is not awaiting signature");
            var actor = user.FindFirst("name")?.Value ?? "Unknown";
            var o = row.ToDto();
            row.Status = "active";
            row.HistoryJson = OrderLogic.AppendHistory(row.HistoryJson,
                new(DateTime.UtcNow.ToString("HH:mm"), actor, "signed", null));
            if (o.Medication is not null && o.Administrations is null)
                row.AdministrationsJson = JsonSerializer.Serialize(OrderLogic.GenerateAdministrations(o.Medication), JsonOpts.Web);
            db.SaveChanges();
            return Results.Json(row.ToDto(), JsonOpts.Web);
        }).RequireAuthorization();

        /* PUT /api/icu/orders/{orderId} — modify medication fields; reason required
           (doctor RBAC, orders.modify). Body: { changes, reason }. */
        app.MapPut("/api/icu/orders/{orderId}", (string orderId, ModifyOrderRequest req, ClaimsPrincipal user, AuroraDb db) =>
        {
            if (Rbac.Deny(user, "orders.modify") is IResult denied) return denied;
            if (string.IsNullOrWhiteSpace(req.Reason))
                return ApiError.BadRequest("Reason required");
            if (req.Reason.Length > OrderLogic.MaxTextLength)
                return ApiError.BadRequest($"reason exceeds {OrderLogic.MaxTextLength} characters");
            /* a modify that carries no recognized change field is a malformed
               request (typo'd payload), not a no-op to record — reject it */
            if (req.Changes is null || !req.Changes.HasAnyField)
                return ApiError.BadRequest("changes must include at least one medication field (drug, dose, route, frequency, duration, prn, prnIndication)");
            /* provided change values must be usable — a whitespace dose blanking an
               ACTIVE medication order is exactly the silent hazard this guards */
            if (OrderLogic.ValidateChanges(req.Changes) is string invalid)
                return ApiError.BadRequest(invalid);
            var row = db.Orders.FirstOrDefault(x => x.OrderId == orderId);
            if (row is null) return ApiError.NotFound();
            /* SHAPE, not state: a non-medication order has no medication
               fields in ANY state — the request can never succeed against
               this resource, so it is a 400 (like requiresImplementation
               on a medication draft), never a 409 */
            if (row.MedicationJson is null)
                return ApiError.BadRequest(
                    $"order '{orderId}' is not a medication order — there are no medication fields to modify");
            if (EncounterGuard.RequireOpen(db, row.EncounterId, "modifying an order") is IResult conflict) return conflict;
            if (row.Status is not ("active" or "pending"))
                return ApiError.StateConflict(
                    $"order '{orderId}' is {row.Status} — a {row.Status} order cannot be modified");
            var actor = user.FindFirst("name")?.Value ?? "Unknown";
            var before = JsonSerializer.Deserialize<MedicationDto>(row.MedicationJson, JsonOpts.Web)!;
            var (merged, diff) = OrderLogic.ApplyChanges(before, req.Changes);
            row.MedicationJson = JsonSerializer.Serialize(merged, JsonOpts.Web);
            row.Summary = OrderLogic.MedSummary(merged);
            row.HistoryJson = OrderLogic.AppendHistory(row.HistoryJson,
                new(DateTime.UtcNow.ToString("HH:mm"), actor, "modified",
                    $"{(diff.Length > 0 ? diff : "no field change")} — {req.Reason.Trim()}"));
            db.SaveChanges();
            return Results.Json(row.ToDto(), JsonOpts.Web);
        }).RequireAuthorization();

        /* POST /api/icu/orders/{orderId}/discontinue — reason required (doctor RBAC). */
        app.MapPost("/api/icu/orders/{orderId}/discontinue", (string orderId, DiscontinueRequest req, ClaimsPrincipal user, AuroraDb db) =>
        {
            if (Rbac.Deny(user, "orders.discontinue") is IResult denied) return denied;
            if (string.IsNullOrWhiteSpace(req.Reason))
                return ApiError.BadRequest("Reason required");
            if (req.Reason.Length > OrderLogic.MaxTextLength)
                return ApiError.BadRequest($"reason exceeds {OrderLogic.MaxTextLength} characters");
            var row = db.Orders.FirstOrDefault(x => x.OrderId == orderId);
            if (row is null) return ApiError.NotFound();
            /* deliberately NO EncounterGuard (closing out the record stays
               allowed on a closed encounter) — but the state machine still
               holds: an order already at a terminal state cannot be
               discontinued again */
            if (row.Status == "discontinued")
                return ApiError.StateConflict(
                    $"order '{orderId}' is already discontinued{(row.StatusReason is null ? "" : $" ({row.StatusReason})")} — there is nothing to discontinue");
            if (row.Status == "completed")
                return ApiError.StateConflict(
                    $"order '{orderId}' is completed — it has already reached a terminal state");
            var actor = user.FindFirst("name")?.Value ?? "Unknown";
            /* shared mechanics — same status/reason/cancelled-schedule/audit
               path as the discharge hook and the backfill */
            OrderLogic.Discontinue(row, actor, req.Reason.Trim());
            db.SaveChanges();
            return Results.Json(row.ToDto(), JsonOpts.Web);
        }).RequireAuthorization();

        /* POST /api/icu/orders/{orderId}/implement — nurse RBAC (orders.implement):
           one-shot completion of a non-med order from "Orders to Implement".
           Note a DOCTOR token is correctly rejected here — implementation is a
           nursing permission in the locked RBAC model. */
        app.MapPost("/api/icu/orders/{orderId}/implement", (string orderId, ClaimsPrincipal user, AuroraDb db) =>
        {
            if (Rbac.Deny(user, "orders.implement") is IResult denied) return denied;
            var row = db.Orders.FirstOrDefault(x => x.OrderId == orderId);
            if (row is null) return ApiError.NotFound();
            /* THE TWO HALVES of the old folded lookup, split deliberately:
               requiresImplementation is SHAPE — immutable; implementing
               this order can never succeed in any state → 400 (the same
               judgement as create's "a medication order cannot set
               requiresImplementation"). Status is STATE — sign it and the
               same request succeeds → 409. */
            if (row.RequiresImplementation != true)
                return ApiError.BadRequest(row.MedicationJson is not null
                    ? $"order '{orderId}' is a medication order — doses are administered via the MAR, not implemented"
                    : $"order '{orderId}' does not require implementation");
            if (EncounterGuard.RequireOpen(db, row.EncounterId, "implementing an order") is IResult conflict) return conflict;
            if (row.Status != "active")
                return ApiError.StateConflict(row.Status == "pending"
                    ? $"order '{orderId}' is pending — it must be signed before it can be implemented"
                    : $"order '{orderId}' is {(row.Status == "completed" ? "already completed" : row.Status)} — it is not awaiting implementation");
            var actor = user.FindFirst("name")?.Value ?? "Unknown";
            var time = DateTime.UtcNow.ToString("HH:mm");
            row.Status = "completed";
            row.HistoryJson = OrderLogic.AppendHistory(
                OrderLogic.AppendHistory(row.HistoryJson, new(time, actor, "implemented", null)),
                new(time, actor, "completed", null));
            db.SaveChanges();
            return Results.Json(row.ToDto(), JsonOpts.Web);
        }).RequireAuthorization();
    }
}

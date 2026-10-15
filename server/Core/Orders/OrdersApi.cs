using System.Security.Claims;
using System.Text.Json;
using Aurora.Core.Adt;
using Aurora.Core.Identity;
using Aurora.Core.MasterData;
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
        app.MapGet("/api/icu/orders", (string? patientId, string? status, bool? implement, System.Security.Claims.ClaimsPrincipal user, AuroraDb db) =>
        {
            if (Identity.Rbac.Deny(user, "orders.view") is IResult denied) return denied;
            var q = db.Orders.AsNoTracking().AsQueryable();
            if (patientId is not null) q = q.Where(o => o.PatientId == patientId);
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
            /* DERIVED COMPLETION (see OrderLogic): the wire status is the
               EFFECTIVE status — a fulfilled lab/imaging order and a given
               one-off med read completed everywhere, and the status/
               implement filters apply to the derived value so the Completed
               view and the queues agree with what the rows say. The rows
               are AsNoTracking — the in-memory status swap is never saved.
               The implement queue is TASK orders only: a Lab/Imaging order
               completes when its result is documented against it, never by
               a manual done (no claim without the fact). */
            var fulfilled = OrderLogic.FulfilledOrderIds(db);
            var rows = q.OrderBy(o => o.Seq).AsEnumerable()
                .Select(o => { o.Status = OrderLogic.DeriveStatus(o, fulfilled); return o; });
            if (status is not null) rows = rows.Where(o => o.Status == status);
            if (implement == true) rows = rows.Where(o =>
                o.Status == "active" && o.RequiresImplementation == true
                && o.Category != "Lab" && o.Category != "Imaging");
            return Results.Json(rows.Select(o => o.ToDto()), JsonOpts.Web);
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
            Create(req, user, db)).RequireAuthorization();

        /* the sign endpoint and everything below are unchanged; the create
           body lives in Create() so the ORDER-SET APPLY endpoint (Layer 4
           phase 2, Core/MasterData/OrderSetsApi) runs through the exact
           same path — every invariant (RBAC, validation, encounter guard,
           inactive-drug/test 409) applies identically; a set is a
           convenience layer, never a bypass. */
        MapRest(app);
    }

    /** the SINGLE order-creation path — the POST /api/icu/orders body and
        the order-set apply both run through here */
    internal static IResult Create(CreateOrdersRequest req, ClaimsPrincipal user, AuroraDb db)
    {
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
            /* LAYER 4 — the formulary's deactivation invariant, RESOURCE
               STATE (409): an INACTIVE drug cannot be selected for a new
               order (reactivate it and the same request succeeds).
               Checked for every draft BEFORE any insert, after the
               encounter guard (the deeper cause reports first). A drugId
               with NO formulary row stays permitted free text — the
               documented escape hatch until the formulary is the sole
               source of orderable drugs. */
            foreach (var draft in req.Drafts)
            {
                if (draft.Medication is not null
                    && FormularyLogic.Resolve(db, draft.Medication.DrugId) is { Active: false } inactive)
                    return ApiError.StateConflict(
                        $"drug '{inactive.Name}' ({inactive.DrugId}) is inactive in the formulary — it cannot be selected for a new order");
                /* the named-frequency vocabulary's identical invariant
                   (Configuration Vocabularies §4): a RETIRED named
                   frequency cannot be newly ordered — validation already
                   400'd unknown values as SHAPE; retired-but-stored is
                   STATE (every order carrying it keeps rendering, and a
                   structured q<n>h value can never be retired) */
                if (draft.Medication is not null
                    && FormularyLogic.IsRetiredFrequency(db, draft.Medication.Frequency))
                    return ApiError.StateConflict(
                        $"frequency '{draft.Medication.Frequency}' is retired from the named-frequency vocabulary — it cannot be selected for a new order; reactivate it or choose an active frequency");
                /* the lab catalogue's identical invariant (Layer 4 phase 2):
                   an INACTIVE test cannot be newly ordered; an UNKNOWN
                   testId stays accepted (the recorded escape hatch, closed
                   by the queued catalogue-authority enforcement) */
                if (draft.TestId is not null
                    && LabCatalogLogic.Resolve(db, draft.TestId) is { Active: false } inactiveTest)
                    return ApiError.StateConflict(
                        $"test '{inactiveTest.Name}' ({inactiveTest.TestId}) is inactive in the lab catalogue — it cannot be selected for a new order");
                /* the imaging catalogue's identical invariant: a RETIRED
                   study cannot be newly ordered (validation already 400'd
                   unknown studyIds — the imaging catalogue is authoritative,
                   no free-text escape hatch existed to preserve) */
                if (draft.StudyId is not null
                    && ImagingCatalogLogic.Resolve(db, draft.StudyId) is { Active: false } inactiveStudy)
                    return ApiError.StateConflict(
                        $"study '{inactiveStudy.Name}' ({inactiveStudy.StudyId}) is inactive in the imaging catalogue — it cannot be selected for a new order");
            }

            /* SERVER-SIDE MEDICATION SAFETY (the safety.ts move — see
               SafetyLogic): hard blocks are 409 and never overridable;
               warn-level findings are 409 unless the request carries an
               audited overrideJustification. Checked for EVERY draft
               before any insert (a blocked batch creates zero orders). */
            if (req.OverrideJustification is { Length: > OrderLogic.MaxTextLength })
                return ApiError.BadRequest($"overrideJustification exceeds {OrderLogic.MaxTextLength} characters");
            var overridesByDraft = new Dictionary<NewOrderDraftDto, List<SafetyLogic.Issue>>();
            foreach (var draft in req.Drafts)
            {
                if (draft.Medication is null) continue;
                var issues = SafetyLogic.Check(db, draft.PatientId!, openByPatient[draft.PatientId!].EncounterId, draft.Medication);
                var blocks = issues.Where(i => i.Severity == "block").ToList();
                if (blocks.Count > 0)
                    return ApiError.StateConflict(
                        $"safety block — {string.Join(" | ", blocks.Select(b => b.Message))} This contraindication cannot be overridden.");
                var warns = issues.Where(i => i.Severity == "warn").ToList();
                if (warns.Count > 0)
                {
                    if (string.IsNullOrWhiteSpace(req.OverrideJustification))
                        return ApiError.StateConflict(
                            $"safety warning — {string.Join(" | ", warns.Select(w => w.Message))} Ordering requires an acknowledged override (overrideJustification).");
                    overridesByDraft[draft] = warns;
                }
            }

            var actor = user.FindFirst("name")?.Value ?? "Unknown";
            var time = DateTime.UtcNow.ToString("yyyy-MM-dd HH:mm");
            var created = new List<OrderDto>();
            foreach (var draft in req.Drafts)
            {
                /* Layer 2: name/bed resolution reads Core ADT (Patient +
                   open Encounter) — the former roster-table seam site */
                var pt = db.AdtPatients.AsNoTracking().First(p => p.PatientId == draft.PatientId);
                var enc = openByPatient[draft.PatientId!];
                var history = new List<OrderEventDto> { new(time, actor, "created", req.Note) };
                if (overridesByDraft.TryGetValue(draft, out var overridden))
                    history.Add(new(time, actor, "safety override",
                        $"{string.Join(" | ", overridden.Select(w => w.Message))} — justification: {req.OverrideJustification!.Trim()}"));
                /* STRUCTURED INFUSION: the stored display dose is composed
                   from the structured entry (validation already rejected a
                   mismatching client dose) — single source, no desync */
                var medication = draft.Medication is null ? null : OrderLogic.NormaliseMedication(draft.Medication);
                if (req.Sign) history.Add(new(time, actor, "signed", null));
                /* DERIVED SCHEDULE (MAR safety fix): no dose schedule is
                   stored — administrations begin EMPTY and accumulate only
                   documented FACTS. Expected instances derive at MAR read
                   from frequency + the signed time (therapy start). */
                /* Imaging Catalogue (snapshot-at-use): a coded imaging
                   order's Summary defaults to the ASSEMBLED description —
                   study name + typed region + contrast (the corrected
                   model: "CT — head — with contrast") — captured here,
                   never re-resolved (a client-provided summary stays
                   authoritative; the client composes the same assembly) */
                var region = draft.Region?.Trim() is { Length: > 0 } r ? r : null;
                var summary = draft.Summary;
                if (summary is null && draft.StudyId is not null)
                    summary = string.Join(" — ", new[]
                    {
                        ImagingCatalogLogic.Resolve(db, draft.StudyId)!.Name,
                        region,
                        draft.Contrast == true ? "with contrast" : null,
                    }.Where(p => p is not null));
                var dto = new OrderDto(
                    OrderLogic.NextOrderId(), draft.PatientId!, enc.EncounterId, enc.BedId, pt.DisplayName,
                    draft.Category!, summary ?? OrderLogic.MedSummary(medication!),
                    medication, draft.Priority!, req.Sign ? "active" : "pending",
                    actor, time, draft.RequiresImplementation, null, history, null,
                    draft.TestId, draft.StudyId, region, draft.Contrast,
                    /* NURSING ORDERS: the schedule starts with no completed
                       round; a signed order's round 1 is open now */
                    draft.Nursing is null ? null : new NursingOrderDto(draft.Nursing.IntervalMinutes, []));
                var newRow = OrderRow.FromDto(dto, OrderLogic.NextSeq());
                db.Orders.Add(newRow);
                /* a nursing order answers with its DERIVED current round;
                   every other order's response is unchanged */
                created.Add(dto.Nursing is null ? dto : newRow.ToDto());
            }
            db.SaveChanges();
            return Results.Json(created, JsonOpts.Web);
        }
    }

    static void MapRest(WebApplication app)
    {
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
            using var tx = OrderLogic.LockOrder(db, orderId);   // the order write lock (atomic mutation)
            var row = db.Orders.FirstOrDefault(x => x.OrderId == orderId);
            if (row is null) return ApiError.NotFound();
            if (EncounterGuard.RequireOpen(db, row.EncounterId, "signing an order") is IResult conflict) return conflict;
            if (row.Status != "pending")
                return ApiError.StateConflict(
                    $"order '{orderId}' is {(row.Status == "active" ? "already active" : row.Status)} — it is not awaiting signature");
            var actor = user.FindFirst("name")?.Value ?? "Unknown";
            row.Status = "active";
            /* DERIVED SCHEDULE (MAR safety fix): signing stores no dose
               slots — this signed event's dated stamp IS the therapy start
               the MAR derives the expected instances from. */
            row.HistoryJson = OrderLogic.AppendHistory(row.HistoryJson,
                new(DateTime.UtcNow.ToString("yyyy-MM-dd HH:mm"), actor, "signed", null));
            db.SaveChanges();
            tx.Commit();
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
            if (OrderLogic.ValidateChanges(req.Changes, db) is string invalid)
                return ApiError.BadRequest(invalid);
            using var tx = OrderLogic.LockOrder(db, orderId);   // the order write lock (atomic mutation)
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
            /* LAYER 4: changing the order TO an inactive formulary drug is
               the same new-selection state conflict as at create */
            if (req.Changes.DrugId is not null
                && FormularyLogic.Resolve(db, req.Changes.DrugId) is { Active: false } inactiveDrug)
                return ApiError.StateConflict(
                    $"drug '{inactiveDrug.Name}' ({inactiveDrug.DrugId}) is inactive in the formulary — it cannot be selected for a new order");
            /* changing TO a retired named frequency is the same
               new-selection state conflict (Configuration Vocabularies
               §4) — the order's EXISTING frequency keeps rendering */
            if (req.Changes.Frequency is not null
                && FormularyLogic.IsRetiredFrequency(db, req.Changes.Frequency))
                return ApiError.StateConflict(
                    $"frequency '{req.Changes.Frequency}' is retired from the named-frequency vocabulary — it cannot be selected for a new order; reactivate it or choose an active frequency");
            var actor = user.FindFirst("name")?.Value ?? "Unknown";
            var before = JsonSerializer.Deserialize<MedicationDto>(row.MedicationJson, JsonOpts.Web)!;
            /* STRUCTURED INFUSION desync guards (SHAPE, 400): on an order
               that carries a structured dose, the display dose derives
               from the structure — a dose-only change could silently
               contradict it, and a frequency change away from
               'continuous' would leave a continuous-infusion dose on a
               non-continuous order. */
            if (before.Infusion is not null && req.Changes.Dose is not null && req.Changes.Infusion is null)
                return ApiError.BadRequest(
                    $"order '{orderId}' carries a structured infusion dose — change the structured entry (infusion); the display dose derives from it");
            if ((req.Changes.Infusion ?? before.Infusion) is not null
                && req.Changes.Frequency is not null && req.Changes.Frequency != "continuous")
                return ApiError.BadRequest(
                    $"order '{orderId}' carries a structured infusion dose — its frequency is 'continuous' (an infusion runs continuously)");
            if (req.Changes.Infusion is not null && req.Changes.Dose is not null
                && req.Changes.Dose != OrderLogic.ComposeInfusionDose(req.Changes.Infusion))
                return ApiError.BadRequest(
                    $"changes.dose '{req.Changes.Dose}' does not match the structured infusion dose '{OrderLogic.ComposeInfusionDose(req.Changes.Infusion)}' — omit dose (it derives from the structured entry)");
            var (merged, diff) = OrderLogic.ApplyChanges(before, req.Changes);
            row.MedicationJson = JsonSerializer.Serialize(merged, JsonOpts.Web);
            row.Summary = OrderLogic.MedSummary(merged);
            row.HistoryJson = OrderLogic.AppendHistory(row.HistoryJson,
                new(DateTime.UtcNow.ToString("yyyy-MM-dd HH:mm"), actor, "modified",
                    $"{(diff.Length > 0 ? diff : "no field change")} — {req.Reason.Trim()}"));
            db.SaveChanges();
            tx.Commit();
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
            using var tx = OrderLogic.LockOrder(db, orderId);   // the order write lock (atomic mutation)
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
            /* DERIVED COMPLETION GUARD — the false-record protection: a
               performed order cannot be discontinued. "Cancelled" and
               "done" are different facts; a result documented against the
               order (or a given one-off dose) means the work happened, and
               recording it as discontinued would say it didn't. If the
               result was attached to the wrong order, correct the LINKAGE
               (the report-correction path) — that un-completes the order
               and this discontinue then succeeds. */
            if (row.Status == "active" && OrderLogic.IsFulfilled(db, orderId))
                return ApiError.StateConflict(
                    $"order '{orderId}' is completed — a result is documented against it (performed and cancelled are different facts; if the result was linked in error, correct the linkage first)");
            if (row.Status == "active" && OrderLogic.OneOffGiven(row))
                return ApiError.StateConflict(
                    $"order '{orderId}' is completed — its one-off dose was administered on the MAR");
            var actor = user.FindFirst("name")?.Value ?? "Unknown";
            /* shared mechanics — same status/reason/cancelled-schedule/audit
               path as the discharge hook and the backfill */
            OrderLogic.Discontinue(row, actor, req.Reason.Trim());
            db.SaveChanges();
            tx.Commit();
            return Results.Json(row.ToDto(), JsonOpts.Web);
        }).RequireAuthorization();

        /* POST /api/icu/orders/{orderId}/implement — nurse RBAC (orders.implement):
           one-shot completion of a non-med order from "Orders to Implement".
           Note a DOCTOR token is correctly rejected here — implementation is a
           nursing permission in the locked RBAC model.
           NURSING ROUNDS (icu-update-nursing-patient-chart-contracts.md §3.4):
           an optional body { roundId, attemptId } completes the order's
           CURRENT ROUND (NursingRounds.cs). No body / an empty body / {} is
           the existing request — accepted for one-time orders, legacy
           behaviour byte-identical; a repeating order requires the round
           contract. A resend of a recorded attempt is answered with the order
           as it is, before any state check (safe retry). */
        app.MapPost("/api/icu/orders/{orderId}/implement", async (string orderId, HttpContext ctx, ClaimsPrincipal user, AuroraDb db) =>
        {
            if (Rbac.Deny(user, "orders.implement") is IResult denied) return denied;
            /* the body is read by hand so that the existing no-body request
               (no Content-Type) keeps binding exactly as before */
            ImplementRequest? req = null;
            using (var reader = new StreamReader(ctx.Request.Body))
            {
                var text = await reader.ReadToEndAsync();
                if (text.Length > 4096) return ApiError.BadRequest("implementation request body is too large");
                if (!string.IsNullOrWhiteSpace(text))
                {
                    try { req = JsonSerializer.Deserialize<ImplementRequest>(text, JsonOpts.Web); }
                    catch (JsonException) { return ApiError.BadRequest("implementation request must be empty or { roundId, attemptId }"); }
                }
            }
            var roundId = req?.RoundId;
            var attemptId = req?.AttemptId;
            if ((roundId is null) != (attemptId is null))
                return ApiError.BadRequest("roundId and attemptId go together — send both to complete a nursing round, or neither for a one-time order");
            if (attemptId is not null && !NursingRounds.IsValidAttemptId(attemptId))
                return ApiError.BadRequest("attemptId must be 8–64 characters of A–Z, a–z, 0–9, '-' or '_'");
            if (roundId is not null && !NursingRounds.IsValidRoundId(roundId))
                return ApiError.BadRequest("roundId must be the order's current round identity ('yyyy-MM-ddTHH:mm~r<n>')");

            using var tx = OrderLogic.LockOrder(db, orderId);   // the order write lock (atomic mutation)
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
            /* SHAPE, like the medication rejection above: a Lab/Imaging
               order completes when its RESULT is documented against it
               (the derived-completion model) — a manual done here would
               let someone claim a lab is done with no result. 400 in any
               state, never a 409. */
            if (row.Category is "Lab" or "Imaging")
                return ApiError.BadRequest(
                    $"order '{orderId}' is a {row.Category} order — it completes when its result is documented against it, never by a manual done");
            var nursing = NursingRounds.Read(row);
            /* SAFE RETRY — judged FIRST inside the lock, before any state
               check: an attempt this order already recorded (a retry after no
               answer, or the original arriving after its retry) is answered
               with the order as it is now — no second completion, no audit
               entry — even after the order completed, was discontinued or its
               encounter closed. The same attempt with a different round is
               refused. */
            if (attemptId is not null && nursing?.Completions.FirstOrDefault(c => c.AttemptId == attemptId) is { } prior)
            {
                if (prior.RoundId == roundId) return Results.Json(row.ToDto(), JsonOpts.Web);
                return ApiError.StateConflict(
                    $"attempt '{attemptId}' already recorded a different completion (round {prior.Round}, {prior.RoundId}); a retry must resend the same round");
            }
            /* the round contract is SHAPE: a legacy order has no rounds; a
               repeating order cannot be completed without naming its round */
            if (roundId is not null && nursing is null)
                return ApiError.BadRequest(
                    $"order '{orderId}' is a one-time order without nursing rounds — implement it with an empty request");
            if (roundId is null && nursing?.IntervalMinutes is int every)
                return ApiError.BadRequest(
                    $"order '{orderId}' repeats every {every} minute{(every == 1 ? "" : "s")} — completing a round requires roundId and attemptId (the order's current round)");
            if (EncounterGuard.RequireOpen(db, row.EncounterId, "implementing an order") is IResult conflict) return conflict;
            if (row.Status != "active")
                return ApiError.StateConflict(row.Status == "pending"
                    ? $"order '{orderId}' is pending — it must be signed before it can be implemented"
                    : $"order '{orderId}' is {(row.Status == "completed" ? "already completed" : row.Status)} — it is not awaiting implementation");
            var actor = user.FindFirst("name")?.Value ?? "Unknown";
            var nowUtc = DateTime.UtcNow;
            var time = nowUtc.ToString("yyyy-MM-dd HH:mm");
            var current = nursing is null ? null : NursingRounds.CurrentRound(row, nursing);
            if (roundId is not null)
            {
                /* STALE / EARLY — 409 with nothing written: the round must be
                   the order's current round, and due */
                if (current is null)
                    return ApiError.StateConflict($"order '{orderId}' has no current nursing round");
                if (roundId != current.RoundId)
                {
                    if (nursing!.Completions.FirstOrDefault(c => c.RoundId == roundId) is { } done)
                        return ApiError.StateConflict(
                            $"round {done.Round} of order '{orderId}' was already completed by {done.CompletedBy} at {done.CompletedTime} — it is not awaiting completion");
                    return ApiError.StateConflict(
                        $"round '{roundId}' is not the current round of order '{orderId}' — the current round is round {current.Number}, due {current.DueTime}");
                }
                if (nowUtc < NursingRounds.ParseStamp(current.DueTime)!.Value)
                    return ApiError.StateConflict(
                        $"round {current.Number} of order '{orderId}' is not due yet — it opens at {current.DueTime}");
            }
            if (nursing is not null && current is not null)
            {
                nursing.Completions.Add(new(current.Number, current.RoundId, current.DueTime, time, actor, attemptId));
                row.NursingJson = NursingRounds.Write(nursing);
            }
            if (nursing?.IntervalMinutes is not null)
            {
                /* a repeating order stays active — its next round is due at
                   this completion time + the interval */
                row.HistoryJson = OrderLogic.AppendHistory(row.HistoryJson,
                    new(time, actor, "implemented", $"round {current!.Number}"));
            }
            else
            {
                row.Status = "completed";
                row.HistoryJson = OrderLogic.AppendHistory(
                    OrderLogic.AppendHistory(row.HistoryJson, new(time, actor, "implemented", null)),
                    new(time, actor, "completed", null));
            }
            db.SaveChanges();
            tx.Commit();
            return Results.Json(row.ToDto(), JsonOpts.Web);
        }).RequireAuthorization();
    }
}

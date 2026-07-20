using System.Security.Claims;
using System.Text.Json;
using Aurora.Core.Adt;
using Aurora.Core.Identity;
using Aurora.Core.Orders;
using Aurora.Core.Persistence;
using Aurora.Core.Shared;
using Microsoft.EntityFrameworkCore;

namespace Aurora.Core.Mar;

/* ---------------- Medication Administration Record (Stage 10 Phase 3, MAR) ----------------
   The MAR has NO table of its own — and since the derived-schedule fix it
   stores NO schedule either. The orders table holds the two FACTS (the
   medication order and the documented administration events, both dated);
   the expected dose instances are DERIVED at read time by MarSchedule from
   frequency + therapy start + the current clock, and the facts overlay
   them. Documenting a dose APPENDS an administration fact carrying the
   instance's dated identity — it never consumes a stored slot, so doses
   never run out and a missed dose stays the missed dose of ITS calendar
   day. RBAC polarity FLIPS vs the prescriber mutations: administering a
   dose requires the NURSE's meds.administer, so a doctor token is 403'd
   here (mirroring implement). The administering actor is always the
   token's name claim. Given needs no reason; Held/Refused require one
   (validated like discontinue). */
static class MarApi
{
    public static void Map(WebApplication app)
    {
        /* GET /api/icu/mar — unit-wide MAR rows, DERIVED server-side at read time
           (expected instances from the order's frequency + therapy start,
           overlaid with the stored administration facts — derived state is
           never stored). The nurse-worklist narrowing stays a client-side
           derivation, same as the orders implement queue — WORKFLOW, not
           authority; since Assignment Simplification its source is the
           opt-out coverage read (/assignments/mine), and it must never
           become a server-side gate here: a nurse responding to an
           emergency documents any patient's dose (locked decision 6). */
        app.MapGet("/api/icu/mar", (System.Security.Claims.ClaimsPrincipal user, AuroraDb db) =>
        {
            if (Identity.Rbac.Deny(user, "orders.view") is IResult denied) return denied;
            /* ENCOUNTER SCOPE (defense in depth): MAR rows derive only from
               orders on OPEN encounters — a discharged admission's schedule
               must never surface as current doses (the ORD-113 class). On
               healthy data this changes nothing: discharge already
               discontinued those orders. */
            var open = db.Encounters.AsNoTracking()
                .Where(e => e.Status == "open").Select(e => e.EncounterId).ToHashSet();
            var now = DateTime.UtcNow;
            return Results.Json(db.Orders.AsNoTracking()
                .Where(o => o.MedicationJson != null)
                .OrderBy(o => o.Seq)
                .AsEnumerable()
                .Where(o => open.Contains(o.EncounterId))
                .SelectMany(o => MarLogic.MarRowsFor(o, now)), JsonOpts.Web);
        }).RequireAuthorization();

        /* POST /api/icu/mar/{orderId}/administrations/{adminId} — document a dose
           (Given/Held/Refused). Nurse RBAC (meds.administer); doctor → 403.
           Body: { action, reason? }; reason required for held/refused.
           adminId is the DERIVED instance identity: dated "yyyy-MM-ddTHH:mm"
           for a scheduled instance, "prn" for a PRN availability, "ondemand"
           for an order whose frequency has no derivable grid. Documentation
           APPENDS an administration fact — nothing stored is consumed. */
        app.MapPost("/api/icu/mar/{orderId}/administrations/{adminId}",
            (string orderId, string adminId, AdministerRequest req, ClaimsPrincipal user, AuroraDb db) =>
        {
            if (Rbac.Deny(user, "meds.administer") is IResult denied) return denied;
            if (req.Action is not ("given" or "held" or "refused"))
                return ApiError.BadRequest("action must be one of: given, held, refused");
            var needsReason = req.Action is "held" or "refused";
            if (needsReason && string.IsNullOrWhiteSpace(req.Reason))
                return ApiError.BadRequest($"reason is required when a dose is {req.Action}");
            if (req.Reason is not null && req.Reason.Length > OrderLogic.MaxTextLength)
                return ApiError.BadRequest($"reason exceeds {OrderLogic.MaxTextLength} characters");

            var row = db.Orders.FirstOrDefault(x => x.OrderId == orderId);
            if (row is null || row.MedicationJson is null)
                return ApiError.NotFound();   // absent order, or not a medication order — the adminId resolves to nothing
            /* THE CHOKEPOINT (409, resource state): the encounter must be
               OPEN — asserted independently of order status so the two can
               never diverge silently, and even a Consultant with full
               authority is equally blocked. */
            if (EncounterGuard.RequireOpen(db, row.EncounterId, "documenting a dose") is IResult conflict) return conflict;

            var med = JsonSerializer.Deserialize<MedicationDto>(row.MedicationJson, JsonOpts.Web)!;
            var admins = row.AdministrationsJson is null
                ? new List<AdminDto>()
                : JsonSerializer.Deserialize<List<AdminDto>>(row.AdministrationsJson, JsonOpts.Web)!;

            /* a stored AdminId addresses a FACT: re-documenting it is the
               two-nurses race — FOUR-CODE RULE (state-conflict PR): the dose
               EXISTS, it is simply already documented. A 404 tells the
               second nurse the dose vanished; a 409 tells them their
               colleague documented it first. (A stored row still carrying
               the retired stub's 'scheduled' status is not a fact and not
               documentable — the schedule is derived now.) */
            var stored = admins.FirstOrDefault(a => a.AdminId == adminId);
            if (stored is not null)
            {
                if (stored.Status != "scheduled")
                    return ApiError.StateConflict(
                        $"dose '{adminId}' was already documented as {stored.Status}"
                        + (stored.DocumentedBy is null ? "" : $" by {stored.DocumentedBy} at {stored.DocumentedTime}")
                        + " — it is not awaiting documentation");
                return ApiError.BadRequest(
                    $"'{adminId}' is a retired stored-schedule stub — the dose schedule is derived at read now; document against the dated instance identity from GET /api/icu/mar");
            }

            var now = DateTime.UtcNow;
            var parsed = MarSchedule.Parse(med);
            string scheduledStamp;
            if (adminId == "prn")
            {
                if (parsed.Kind != MarSchedule.Kind.Prn)
                    return ApiError.BadRequest($"order '{orderId}' is not a PRN order — document the dated dose instance from GET /api/icu/mar");
                if (row.Status != "active")
                    return ApiError.StateConflict($"order '{orderId}' is {row.Status} — it is not in force, no dose is available from it");
                scheduledStamp = "";   // a PRN fact has no expected instance — availability derives from the last administration only
            }
            else if (adminId == "ondemand")
            {
                if (parsed.Kind != MarSchedule.Kind.Underivable)
                    return ApiError.BadRequest($"order '{orderId}' has a derivable dose schedule ('{med.Frequency}') — document the dated instance identity from GET /api/icu/mar");
                if (row.Status != "active")
                    return ApiError.StateConflict($"order '{orderId}' is {row.Status} — it is not in force, no dose is available from it");
                scheduledStamp = "";
            }
            else if (DateTime.TryParseExact(adminId, "yyyy-MM-ddTHH:mm", null,
                         System.Globalization.DateTimeStyles.AssumeUniversal | System.Globalization.DateTimeStyles.AdjustToUniversal,
                         out var instant))
            {
                if (parsed.Kind is MarSchedule.Kind.Prn)
                    return ApiError.BadRequest($"order '{orderId}' is PRN — doses are documented on demand ('prn'), never against a schedule");
                if (parsed.Kind is MarSchedule.Kind.Underivable)
                    return ApiError.BadRequest($"order '{orderId}' has no derivable dose schedule ('{med.Frequency}') — document on demand ('ondemand')");
                /* state before existence-within-the-schedule: a non-active
                   order EXISTS but derives no expected instances */
                if (row.Status != "active")
                    return ApiError.StateConflict($"order '{orderId}' is {row.Status} — it is not in force, no dose instance is expected from it");
                var anchor = MarSchedule.TherapyStart(row, now);
                if (anchor is null)
                    return ApiError.BadRequest($"order '{orderId}' has no parseable therapy start — its schedule cannot be derived");
                var first = MarSchedule.FirstDose(anchor.Value);
                /* grid membership first (pure arithmetic): the identity must
                   BE on the anchor grid at all, else it addresses nothing */
                var onGrid = parsed.Kind == MarSchedule.Kind.Once
                    ? instant == first
                    : instant >= first && (instant - first).Ticks % TimeSpan.FromHours(parsed.IntervalHours).Ticks == 0;
                if (!onGrid) return ApiError.NotFound();   // not an expected dose instance of this order
                scheduledStamp = MarSchedule.StampOf(instant);
                /* the duplicate check comes BEFORE the render-window check:
                   a re-documented instance has left the renderable set by
                   definition, and a racing second nurse must still see
                   "already given by X" (409), never "not found" */
                var dup = admins.FirstOrDefault(a => a.Status != "scheduled" && a.ScheduledTime == scheduledStamp);
                if (dup is not null)
                    return ApiError.StateConflict(
                        $"dose '{adminId}' was already documented as {dup.Status}"
                        + (dup.DocumentedBy is null ? "" : $" by {dup.DocumentedBy} at {dup.DocumentedTime}")
                        + " — it is not awaiting documentation");
                if (parsed.Kind == MarSchedule.Kind.Interval)
                {
                    /* only RENDERED instances are documentable — within the
                       past window and not beyond the next expected dose (the
                       same set GET /api/icu/mar serves) */
                    var docStamps = admins.Where(a => a.Status != "scheduled").Select(a => a.ScheduledTime).ToHashSet();
                    var (_, _, renderable) = MarSchedule.IntervalInstances(first, parsed.IntervalHours, docStamps, now);
                    if (!renderable.Contains(instant)) return ApiError.NotFound();
                }
            }
            else
            {
                return ApiError.NotFound();   // neither a fact, a derived identity, prn, nor ondemand
            }

            var actor = user.FindFirst("name")?.Value ?? "Unknown";
            var time = now.ToString("yyyy-MM-dd HH:mm");
            var reason = needsReason ? req.Reason!.Trim() : null;
            admins.Add(new AdminDto(OrderLogic.NextAdminId(), scheduledStamp, req.Action!,
                time, actor, reason));
            row.AdministrationsJson = JsonSerializer.Serialize(admins, JsonOpts.Web);
            var verb = req.Action == "given" ? "administered" : req.Action;
            var detail = $"{(scheduledStamp.Length > 0 ? scheduledStamp : adminId == "prn" ? "PRN" : $"unscheduled ({med.Frequency})")} dose {req.Action} at {time}"
                + (reason is not null ? $" — {reason}" : "");
            row.HistoryJson = OrderLogic.AppendHistory(row.HistoryJson, new(time, actor, verb, detail));
            db.SaveChanges();
            return Results.Json(row.ToDto(), JsonOpts.Web);
        }).RequireAuthorization();
    }
}

/* MAR derivation — the read-side composition: stored FACTS first, derived
   expected instances overlaid around them (MarSchedule owns the schedule
   arithmetic). */
static class MarLogic
{
    /** MAR rows for one order: every documented administration FACT (any
        order status — documented ones stay for the record, exactly as
        before), plus — for ACTIVE orders only — the derived expected
        instances that no fact covers. Stored rows still carrying the
        retired stub's 'scheduled' status are artefacts of the removed
        plan, not facts: the derivation ignores them entirely. */
    public static IEnumerable<MarRowDto> MarRowsFor(OrderRow o, DateTime nowUtc)
    {
        var m = JsonSerializer.Deserialize<MedicationDto>(o.MedicationJson!, JsonOpts.Web)!;
        var route = $"{m.Route} · {(m.Prn ? $"PRN — {m.PrnIndication ?? "as required"}" : m.Frequency)}";
        MarRowDto Row(string adminId, string scheduledTime, string status,
            string? documentedTime = null, int? missedEarlier = null, string? scheduleNote = null) =>
            new(o.OrderId, adminId, o.PatientId, o.BedId, m.Drug, m.Dose, route,
                scheduledTime, m.Prn, status, documentedTime, missedEarlier, scheduleNote);

        var admins = o.AdministrationsJson is null
            ? new List<AdminDto>()
            : JsonSerializer.Deserialize<List<AdminDto>>(o.AdministrationsJson, JsonOpts.Web)!;
        var facts = admins.Where(a => a.Status != "scheduled").ToList();
        var rows = new List<(DateTime sort, MarRowDto row)>();
        foreach (var a in facts)
            rows.Add((MarSchedule.ParseStamp(a.ScheduledTime, nowUtc)
                      ?? MarSchedule.ParseStamp(a.DocumentedTime, nowUtc) ?? nowUtc,
                Row(a.AdminId, a.ScheduledTime, a.Status, a.DocumentedTime)));

        if (o.Status == "active")
        {
            var parsed = MarSchedule.Parse(m);
            switch (parsed.Kind)
            {
                case MarSchedule.Kind.Prn:
                    /* the PRN availability — derived from the last
                       administration only: always present, never consumed */
                    rows.Add((nowUtc, Row("prn", "", "scheduled")));
                    break;
                case MarSchedule.Kind.Underivable:
                    /* HONEST-SOURCE RULE: no invented schedule — the row
                       says so, and doses are documented on demand */
                    rows.Add((nowUtc, Row("ondemand", "", "scheduled",
                        scheduleNote: $"no derivable dose schedule — '{m.Frequency}'; document on demand")));
                    break;
                case MarSchedule.Kind.Once:
                case MarSchedule.Kind.Interval:
                    var anchor = MarSchedule.TherapyStart(o, nowUtc);
                    if (anchor is null)
                    {
                        rows.Add((nowUtc, Row("ondemand", "", "scheduled",
                            scheduleNote: "no derivable dose schedule — therapy start is not parseable; document on demand")));
                        break;
                    }
                    var first = MarSchedule.FirstDose(anchor.Value);
                    var docStamps = facts.Select(a => a.ScheduledTime).ToHashSet();
                    if (parsed.Kind == MarSchedule.Kind.Once)
                    {
                        /* a single expected dose renders individually forever
                           until its fact exists — never aggregated */
                        if (!docStamps.Contains(MarSchedule.StampOf(first)))
                            rows.Add((first, Row(MarSchedule.IdentityOf(first), MarSchedule.StampOf(first), "scheduled")));
                        break;
                    }
                    var (aggregated, oldest, renderable) =
                        MarSchedule.IntervalInstances(first, parsed.IntervalHours, docStamps, nowUtc);
                    if (aggregated > 0)
                        /* the render horizon's explicit remainder — older
                           missed doses are counted out loud, never silently
                           truncated (design §6) */
                        rows.Add((oldest!.Value, Row("missed-earlier", MarSchedule.StampOf(oldest.Value),
                            "missed-earlier", missedEarlier: aggregated)));
                    foreach (var t in renderable)
                        rows.Add((t, Row(MarSchedule.IdentityOf(t), MarSchedule.StampOf(t), "scheduled")));
                    break;
            }
        }
        return rows.OrderBy(r => r.sort).Select(r => r.row);
    }
}

/* MAR row — mirrors MarRow in src/lib/api/types.ts; derived at read time,
   never stored. scheduledTime is DATED ("yyyy-MM-dd HH:mm") on derived
   instances — the identity rule; "" on PRN/on-demand rows; legacy facts
   keep whatever they recorded. missedEarlier rides only the per-order
   horizon summary row; scheduleNote only the honest underivable row
   (WhenWritingNull keeps both absent everywhere else). */
record MarRowDto(
    string OrderId, string AdminId, string PatientId, string BedId, string Medication,
    string Dose, string Route, string ScheduledTime, bool Prn, string Status,
    string? DocumentedTime, int? MissedEarlier = null, string? ScheduleNote = null);

/* MAR administration action request (Stage 10 Phase 3) — Disallow rejects
   any unrecognized field; action/reason validated explicitly in the
   endpoint (reason required for held/refused, like discontinue). */
[System.Text.Json.Serialization.JsonUnmappedMemberHandling(System.Text.Json.Serialization.JsonUnmappedMemberHandling.Disallow)]
record AdministerRequest(string? Action, string? Reason);

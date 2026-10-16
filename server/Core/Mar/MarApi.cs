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
   token's name claim. Held/Refused require a reason (validated like
   discontinue). GIVEN needs no reason ON TIME — but a dose given more
   than MarSchedule.LateThresholdHours past its scheduled instant
   requires a DELAY REASON (the overdue-delay-reason safety fix,
   validator option a): the dose is never blocked, the lateness and its
   reason are captured on the fact, the MAR row and the audit trail. A
   given dose may also carry an explicit administeredAt (the #145
   editable-timestamp pattern — auto-filled now client-side, editable),
   recorded as the fact's documentedTime; the audit event then records
   both times. THE ROLLING TIMER (owner's rule, 2026-09-30 — Amendment B,
   superseding the late-only re-timing): a repeating order has ONE current
   round; documenting it (the fact carries Round) starts the next — Given
   from its actual administration time, Held/Refused from the round's
   scheduled time — see MarSchedule's rolling-timer section. A resolved or
   re-timed round is 409'd. The whole documentation runs under the order
   write lock (OrderLogic.LockOrder). */
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
           Body: { action, reason?, administeredAt? }; reason required for
           held/refused AND for a given dose more than LateThresholdHours
           past its scheduled instant (the overdue delay reason);
           administeredAt (given only, "yyyy-MM-dd HH:mm" UTC) records the
           actual administration time when it differs from the documenting
           moment. adminId is the DERIVED instance identity: the current
           round "yyyy-MM-ddTHH:mm~r<n>" of a repeating order, the dated
           "yyyy-MM-ddTHH:mm" single instance of a 'once' order, "prn" for a PRN
           availability, "ondemand" for an order whose frequency has no
           derivable grid. Documentation APPENDS an administration fact —
           nothing stored is consumed. A scheduled dose (current round or
           'once' dose) opens at its scheduled time: before it, any action
           is 409 and nothing is written (one action per round, 2026-10-05)
           — except the order's FIRST dose, available immediately after
           signing (owner's decision, 2026-10-05, ### F). attemptId
           (optional, ### F SAFE RETRY): the client's identity for this one
           documentation attempt, stored on the fact; resending it returns
           the existing record instead of documenting again. */
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
            /* administeredAt — the actual administration time (#145
               editable-timestamp pattern): GIVEN only (a held/refused dose
               was not administered), UTC wire form, bounded to the render
               horizon and never in the future (a dose cannot honestly have
               been given at a time that has not happened). */
            DateTime? administeredAt = null;
            if (req.AdministeredAt is not null)
            {
                if (req.Action != "given")
                    return ApiError.BadRequest("administeredAt applies only when a dose is given — a held or refused dose has no administration time");
                if (!DateTime.TryParseExact(req.AdministeredAt, "yyyy-MM-dd HH:mm", null,
                        System.Globalization.DateTimeStyles.AssumeUniversal | System.Globalization.DateTimeStyles.AdjustToUniversal,
                        out var at))
                    return ApiError.BadRequest("administeredAt must be 'yyyy-MM-dd HH:mm'");
                administeredAt = at;   // its window is judged after the safe-retry match below
            }
            if (req.AttemptId is not null && !System.Text.RegularExpressions.Regex.IsMatch(req.AttemptId, "^[A-Za-z0-9_-]{8,64}$"))
                return ApiError.BadRequest("attemptId must be 8–64 characters of A–Z, a–z, 0–9, '-' or '_'");

            /* THE ORDER WRITE LOCK (Codex review of PR #234): the whole
               read → validate → append fact → timer → audit → save below
               runs in one transaction holding this order's row lock, so a
               competing documentation or order change waits and then
               validates against the fresh facts — two overlapping requests
               can never both pass on the same facts and lose one write. */
            using var tx = OrderLogic.LockOrder(db, orderId);
            var row = db.Orders.FirstOrDefault(x => x.OrderId == orderId);
            if (row is null || row.MedicationJson is null)
                return ApiError.NotFound();   // absent order, or not a medication order — the adminId resolves to nothing
            /* SAFE RETRY (owner-directed correction, 2026-10-05 — ### F): an
               attempt this order already recorded — the client resending it
               after getting no answer, or the original request arriving
               after its retry — is answered with the existing record: no
               second fact, no audit entry. Judged FIRST, inside the lock,
               so nothing that changed since (the round this very fact
               resolved, the order discontinued, the encounter closed, the
               time window passing) can make a recorded attempt read as
               refused. The same attempt id carrying different
               documentation is refused (409). PRN and on-demand doses have
               no round to deduplicate on — this is what makes their retry
               safe. */
            if (req.AttemptId is not null && row.AdministrationsJson is not null
                && JsonSerializer.Deserialize<List<AdminDto>>(row.AdministrationsJson, JsonOpts.Web)!
                    .FirstOrDefault(a => a.AttemptId == req.AttemptId) is { } prior)
            {
                if (prior.Status == req.Action && SameDose(prior, adminId))
                    return Results.Json(row.ToDto(), JsonOpts.Web);
                return ApiError.StateConflict(
                    $"attempt '{req.AttemptId}' already recorded a different documentation ({prior.Status} — fact {prior.AdminId}); a retry must resend the same documentation");
            }
            if (administeredAt is DateTime actual)
            {
                if (actual > DateTime.UtcNow.AddMinutes(1))
                    return ApiError.BadRequest("administeredAt cannot be in the future");
                if (actual < DateTime.UtcNow.AddHours(-MarSchedule.PastWindowHours))
                    return ApiError.BadRequest($"administeredAt is more than {MarSchedule.PastWindowHours} hours ago — outside the documentable window");
            }
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
            /* the dated instance's instant — set only on the scheduled-grid
               branch; PRN/on-demand doses have no schedule, so the
               late-administration rule can never apply to them */
            DateTime? scheduledInstant = null;
            /* the round this documentation resolves (repeating orders only) */
            MarSchedule.Round? round = null;
            DateTime? first = null;
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
            else if (MarSchedule.ParseRoundIdentity(adminId) is { } roundId)
            {
                var (roundDue, roundNumber) = roundId;
                /* THE ROLLING TIMER (Amendment B): a repeating order has ONE
                   current round; this endpoint accepts exactly that round,
                   computed by the same CurrentRound GET /api/icu/mar uses */
                if (parsed.Kind != MarSchedule.Kind.Interval)
                    return ApiError.NotFound();   // rounds exist only on repeating orders
                if (row.Status != "active")
                    return ApiError.StateConflict($"order '{orderId}' is {row.Status} — it is not in force, no dose round is expected from it");
                var start = MarSchedule.TherapyStart(row, now);
                if (start is null)
                    return ApiError.BadRequest($"order '{orderId}' has no parseable therapy start — its schedule cannot be derived");
                first = MarSchedule.FirstDose(start.Value);
                var facts = admins.Where(a => a.Status != "scheduled").ToList();
                var current = MarSchedule.CurrentRound(first.Value, parsed.IntervalHours, facts, now);
                if (roundNumber < current.Number)
                {
                    /* the two-nurses race / a duplicate or stale submission:
                       the round EXISTS and is already resolved — 409 naming
                       who resolved it, never a 404 */
                    var done = facts.FirstOrDefault(a => a.Round == roundNumber);
                    if (done is null) return ApiError.NotFound();
                    return ApiError.StateConflict(
                        $"dose round {roundNumber} (due {done.ScheduledTime}) was already documented as {done.Status}"
                        + (done.DocumentedBy is null ? "" : $" by {done.DocumentedBy} at {done.DocumentedTime}")
                        + $" — it is not awaiting documentation; the current round is {MarSchedule.RoundIdentity(current)}");
                }
                if (roundNumber > current.Number)
                    return ApiError.NotFound();   // a round that does not exist yet
                if (roundDue != current.Due)
                    /* the right round, a different due minute: the schedule
                       changed after this view loaded (a frequency change) */
                    return ApiError.StateConflict(
                        $"dose round {roundNumber} is now due {MarSchedule.StampOf(current.Due)}, not {MarSchedule.StampOf(roundDue)} — the order's schedule changed after this view was loaded; refresh the MAR and document the current round");
                /* ONE ACTION PER ROUND (owner's correction, 2026-10-05):
                   the current round opens at its exact scheduled time —
                   Given, Held and Refused alike, never before (the
                   30-minute due-soon reminder is display only). Judged
                   here, inside the order lock, against the round just
                   derived from the stored facts and the server clock, so
                   a stale page or a racing request is refused the same
                   way; nothing is appended or audited. The order's FIRST
                   dose is exempt (### F): available on signing. */
                if (!MarSchedule.IsFirstDose(admins) && MarSchedule.NotYetDue(current.Due, now) is string early)
                    return ApiError.StateConflict($"dose round {roundNumber} {early}");
                round = current;
                scheduledStamp = MarSchedule.StampOf(current.Due);
                scheduledInstant = current.Due;
            }
            else if (DateTime.TryParseExact(adminId, "yyyy-MM-ddTHH:mm", null,
                         System.Globalization.DateTimeStyles.AssumeUniversal | System.Globalization.DateTimeStyles.AdjustToUniversal,
                         out var instant))
            {
                if (parsed.Kind is MarSchedule.Kind.Prn)
                    return ApiError.BadRequest($"order '{orderId}' is PRN — doses are documented on demand ('prn'), never against a schedule");
                if (parsed.Kind is MarSchedule.Kind.Underivable)
                    return ApiError.BadRequest($"order '{orderId}' has no derivable dose schedule ('{med.Frequency}') — document on demand ('ondemand')");
                /* a repeating order's doses are ROUNDS now ("…~r<n>"); a bare
                   dated identity (e.g. an old pre-update page's grid slot)
                   addresses nothing */
                if (parsed.Kind is MarSchedule.Kind.Interval)
                    return ApiError.NotFound();
                /* 'once': state before existence-within-the-schedule — a
                   non-active order EXISTS but derives no expected instance */
                if (row.Status != "active")
                    return ApiError.StateConflict($"order '{orderId}' is {row.Status} — it is not in force, no dose instance is expected from it");
                var start = MarSchedule.TherapyStart(row, now);
                if (start is null)
                    return ApiError.BadRequest($"order '{orderId}' has no parseable therapy start — its schedule cannot be derived");
                if (instant != MarSchedule.FirstDose(start.Value))
                    return ApiError.NotFound();   // not this order's single expected dose
                scheduledStamp = MarSchedule.StampOf(instant);
                scheduledInstant = instant;
                /* already documented → the two-nurses race (409, never 404) */
                var dup = admins.FirstOrDefault(a => a.Status != "scheduled" && a.ScheduledTime == scheduledStamp);
                if (dup is not null)
                    return ApiError.StateConflict(
                        $"dose '{adminId}' was already documented as {dup.Status}"
                        + (dup.DocumentedBy is null ? "" : $" by {dup.DocumentedBy} at {dup.DocumentedTime}")
                        + " — it is not awaiting documentation");
                /* the single 'once' dose opens at its scheduled time too —
                   unless it is the order's first documentation, which is
                   available on signing (### F) */
                if (!MarSchedule.IsFirstDose(admins) && MarSchedule.NotYetDue(instant, now) is string early)
                    return ApiError.StateConflict($"this dose {early}");
            }
            else
            {
                return ApiError.NotFound();   // neither a fact, a derived identity, prn, nor ondemand
            }

            /* 🔴 THE OVERDUE DELAY REASON (validator option a): a dose
               given more than LateThresholdHours past its scheduled
               instant is clinically significant lateness — it can still
               be given (the patient needs the drug; never blocked), but
               the delay must be documented. Lateness is judged against
               NOW (the documenting moment), never a client-supplied time
               — a backdated administeredAt cannot dodge the rule. */
            var lateBy = req.Action == "given" && scheduledInstant is not null
                ? now - scheduledInstant.Value : TimeSpan.Zero;
            var isLate = lateBy > TimeSpan.FromHours(MarSchedule.LateThresholdHours);
            if (isLate && string.IsNullOrWhiteSpace(req.Reason))
                return ApiError.BadRequest(
                    $"this dose was scheduled at {scheduledStamp} and is {(int)lateBy.TotalHours}h {lateBy.Minutes:D2}m overdue — a delay reason is required to document it given");

            var actor = user.FindFirst("name")?.Value ?? "Unknown";
            var time = now.ToString("yyyy-MM-dd HH:mm");
            /* the recorded administration time: the explicit actual time
               when supplied (#145 editable), else the documenting moment */
            var adminTime = administeredAt?.ToString("yyyy-MM-dd HH:mm") ?? time;
            /* a volunteered reason is documentation — never dropped */
            var reason = string.IsNullOrWhiteSpace(req.Reason) ? null : req.Reason.Trim();
            /* the fact: a round's fact carries its Round (the rolling-timer
               metadata); scheduledTime keeps the round's due minute (its
               scheduled identity) and documentedTime the actual
               administration time — the audit event below carries the
               documenting moment */
            var fact = new AdminDto(OrderLogic.NextAdminId(), scheduledStamp, req.Action!,
                adminTime, actor, reason, round?.Number, req.AttemptId);
            admins.Add(fact);
            row.AdministrationsJson = JsonSerializer.Serialize(admins, JsonOpts.Web);
            /* the timer this documentation leaves in force, said out loud in
               the audit record */
            var timerNote = "";
            if (round is not null)
            {
                var next = MarSchedule.CurrentRound(first!.Value, parsed.IntervalHours,
                    admins.Where(a => a.Status != "scheduled").ToList(), now);
                var from = MarSchedule.TimerInstant(fact) == next.TimerFrom
                        && next.TimerRule == (req.Action == "given" ? "given" : "skipped")
                    ? (req.Action == "given"
                        ? "from the actual administration time"
                        : "from the skipped dose's scheduled time")
                    : $"timer unchanged — {(next.TimerRule == "given" ? "the administration at" : "the skipped dose due")} {MarSchedule.StampOf(next.TimerFrom!.Value)} already set it; an older time never rewinds it";
                timerNote = $" — round {round.Value.Number}; next round due {MarSchedule.StampOf(next.Due)} ({med.Frequency} {from})";
            }
            var verb = req.Action == "given" ? "administered" : req.Action!;
            var detail = $"{(scheduledStamp.Length > 0 ? scheduledStamp : adminId == "prn" ? "PRN" : $"unscheduled ({med.Frequency})")} dose {req.Action} at {adminTime}"
                + (adminTime != time ? $" (documented {time})" : "")
                + (isLate ? $" — LATE: {(int)lateBy.TotalHours}h {lateBy.Minutes:D2}m after the scheduled time" : "")
                + timerNote
                + (reason is not null ? $" — {reason}" : "");
            row.HistoryJson = OrderLogic.AppendHistory(row.HistoryJson, new(time, actor, verb, detail));
            db.SaveChanges();
            tx.Commit();
            return Results.Json(row.ToDto(), JsonOpts.Web);
        }).RequireAuthorization();
    }

    /** does a recorded fact document the dose `adminId` addresses? — the
        safe-retry match (a fact's own AdminId is its ADM-n id): the round's
        number and due minute, the 'once' dose's dated instance, or an
        unscheduled PRN / on-demand dose */
    static bool SameDose(AdminDto a, string adminId) =>
        adminId is "prn" or "ondemand"
            ? a.Round is null && a.ScheduledTime == ""
            : MarSchedule.ParseRoundIdentity(adminId) is { } r
                ? a.Round == r.Number && a.ScheduledTime == MarSchedule.StampOf(r.Due)
                : a.Round is null && a.ScheduledTime == adminId.Replace('T', ' ');
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
            string? documentedTime = null, string? scheduleNote = null, string? reason = null,
            int? round = null, string? timerFrom = null, string? timerRule = null,
            bool? firstDose = null, string? attemptId = null) =>
            new(o.OrderId, adminId, o.PatientId, o.BedId, m.Drug, m.Dose, route,
                scheduledTime, m.Prn, status, documentedTime, scheduleNote, reason, round, timerFrom, timerRule,
                firstDose, attemptId);

        var admins = o.AdministrationsJson is null
            ? new List<AdminDto>()
            : JsonSerializer.Deserialize<List<AdminDto>>(o.AdministrationsJson, JsonOpts.Web)!;
        var facts = admins.Where(a => a.Status != "scheduled").ToList();
        var rows = new List<(DateTime sort, MarRowDto row)>();
        foreach (var a in facts)
            rows.Add((MarSchedule.ParseStamp(a.ScheduledTime, nowUtc)
                      ?? MarSchedule.ParseStamp(a.DocumentedTime, nowUtc) ?? nowUtc,
                /* the documented reason rides the row — held/refused reasons
                   and the overdue DELAY reason are part of the record; so
                   does the round a rolling-timer fact resolved */
                Row(a.AdminId, a.ScheduledTime, a.Status, a.DocumentedTime, reason: a.Reason,
                    round: a.Round, attemptId: a.AttemptId)));
        /* the order's first dose is open on signing (### F) — said on its row */
        bool? firstDose = facts.Count == 0 ? true : null;

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
                    if (parsed.Kind == MarSchedule.Kind.Once)
                    {
                        /* a single expected dose renders individually forever
                           until its fact exists — never aggregated */
                        if (!facts.Any(a => a.ScheduledTime == MarSchedule.StampOf(first)))
                            rows.Add((first, Row(MarSchedule.IdentityOf(first), MarSchedule.StampOf(first), "scheduled",
                                firstDose: firstDose)));
                        break;
                    }
                    /* THE ROLLING TIMER (Amendment B): exactly ONE current
                       round, whatever the clock says — the write endpoint's
                       own CurrentRound, so it accepts exactly this row. It
                       carries what timed it (the fact that resolved the
                       previous round), so the bedside sees why it is due. */
                    var current = MarSchedule.CurrentRound(first, parsed.IntervalHours, facts, nowUtc);
                    rows.Add((current.Due, Row(MarSchedule.RoundIdentity(current), MarSchedule.StampOf(current.Due), "scheduled",
                        round: current.Number,
                        timerFrom: current.TimerFrom is DateTime tf ? MarSchedule.StampOf(tf) : null,
                        timerRule: current.TimerRule, firstDose: firstDose)));
                    break;
            }
        }
        return rows.OrderBy(r => r.sort).Select(r => r.row);
    }
}

/* MAR row — mirrors MarRow in src/lib/api/types.ts; derived at read time,
   never stored. scheduledTime is DATED ("yyyy-MM-dd HH:mm") on derived
   instances — the identity rule; "" on PRN/on-demand rows; legacy facts
   keep whatever they recorded. scheduleNote rides only the honest
   underivable row. THE ROLLING TIMER (2026-09-30): round rides the current
   round of a repeating order and every fact that resolved one; timerFrom
   ("yyyy-MM-dd HH:mm") + timerRule ("given" | "skipped") only the current
   round, when an earlier round timed it. (The missed-earlier horizon row
   and its missedEarlier count are gone with the grid.) 2026-10-05 (### F),
   ADDITIVE: firstDose (true) rides the current round / 'once' row of an
   order with no documented administration — it is open on signing;
   attemptId rides a fact that recorded one (the client's confirmation of
   an unanswered save). WhenWritingNull keeps each absent everywhere else. */
record MarRowDto(
    string OrderId, string AdminId, string PatientId, string BedId, string Medication,
    string Dose, string Route, string ScheduledTime, bool Prn, string Status,
    string? DocumentedTime, string? ScheduleNote = null, string? Reason = null,
    int? Round = null, string? TimerFrom = null, string? TimerRule = null,
    bool? FirstDose = null, string? AttemptId = null);

/* MAR administration action request (Stage 10 Phase 3) — Disallow rejects
   any unrecognized field; action/reason validated explicitly in the
   endpoint (reason required for held/refused, like discontinue).
   AttemptId (2026-10-05, ### F SAFE RETRY): optional and additive — a
   request without it behaves exactly as before; Disallow means a server
   older than this field refuses it (400), which the appliance's single
   origin (client and server ship together) never exercises. */
[System.Text.Json.Serialization.JsonUnmappedMemberHandling(System.Text.Json.Serialization.JsonUnmappedMemberHandling.Disallow)]
record AdministerRequest(string? Action, string? Reason, string? AdministeredAt = null, string? AttemptId = null);

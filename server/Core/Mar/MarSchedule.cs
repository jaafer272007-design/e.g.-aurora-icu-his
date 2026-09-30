using System.Text.Json;
using Aurora.Core.Orders;
using Aurora.Core.Shared;

namespace Aurora.Core.Mar;

/* ---------------- MAR derived-at-read schedule (clinical safety fix) ----------------
   Replaces the retired one-shot schedule stub (OrderLogic.GenerateAdministrations,
   self-described "mock schedule generation"): it generated two slots at sign
   time and never regenerated, so an active q8h medication ran out of doses
   after two documentations, and a never-documented dateless slot was
   relabelled from OVERDUE to tonight's upcoming dose at midnight.

   THE MODEL (MAR_DERIVED_SCHEDULE_DESIGN.md — the clinical validator's
   decision): store only FACTS — the medication order (start + frequency) and
   the documented administration events. Never store a dose schedule. At
   read: order + frequency + therapy start + current time → expected dose
   instances, overlaid with the documented facts.

   THE IDENTITY RULE (what kills the rollover bug by construction): every
   expected instance carries a DATED identity — "yyyy-MM-ddTHH:mm" as the
   documentable adminId, "yyyy-MM-dd HH:mm" as its scheduledTime — never a
   bare HH:mm. "The 23:00 dose on the 15th" can never become "the 23:00 dose
   on the 16th"; a passed instance with no administration is missed and STAYS
   missed — it ages, it does not transform.

   SCHEDULE RULES (the design's §1):
   - doses never run out — instances are generated, not consumed;
   - a late dose stays late and does NOT shift the schedule: the grid derives
     from THERAPY START, never from the last documented dose;
     [SUPERSEDED 2026-09-30 by the project owner — mar-derived-schedule.md
     Amendment A: a dose documented GIVEN later than its scheduled instant
     on a repeating order RE-TIMES the grid — the next repeating dose is
     the actual administration time + the interval. The late dose itself
     still stays late (its fact keeps its original scheduled identity).
     Only facts carrying the explicit ScheduleAnchor re-time (see
     RetimingState below); the grid still starts at therapy start.]
     [SUPERSEDED AGAIN 2026-09-30 by the project owner — Amendment B: the
     ROLLING TIMER. A repeating order has no grid at all: one current round
     at a time, the next one due from the fact that resolved the last
     (Given → actual time + interval; Held/Refused → the skipped round's
     scheduled time + interval). See the rolling-timer section below.]
   - PRN derives from the last administration only (an availability, no grid);
   - a frequency that cannot be honestly parsed gets NO invented schedule —
     the row says so (the #110 free-text-lab discipline). */
static class MarSchedule
{
    public enum Kind { Interval, Once, Prn, Underivable }

    public readonly record struct Parsed(Kind Kind, int IntervalHours);

    /* the documentable identity ("T" form — URL-safe path segment) and the
       displayed/stored scheduled-time form (the project's event-stamp
       convention) for one dated instance */
    public static string IdentityOf(DateTime t) => t.ToString("yyyy-MM-ddTHH:mm");
    public static string StampOf(DateTime t) => t.ToString("yyyy-MM-dd HH:mm");

    /** frequency → schedule shape. The formulary vocabulary is the
        authority on what a frequency string can be (create/modify validate
        against it), so this switch covers the vocabulary exactly: q<n>h is
        an interval; the named multiples-per-day map to their conventional
        intervals FROM THERAPY START (daily=q24h, bid=q12h, tid=q8h,
        qid=q6h — stated approximation: no set clock times exist on the
        order); once is a single instance; everything else (continuous,
        sliding scale, per level, per CRRT protocol, any legacy free text)
        is honestly UNDERIVABLE — condition-driven or continuous therapy
        with no discrete expected-dose grid. */
    public static Parsed Parse(MedicationDto m)
    {
        if (m.Prn) return new(Kind.Prn, 0);
        var q = System.Text.RegularExpressions.Regex.Match(m.Frequency, @"^q([0-9]+)h$");
        if (q.Success && int.TryParse(q.Groups[1].Value, out var h) && h is >= 1 and <= 168)
            return new(Kind.Interval, h);
        return m.Frequency switch
        {
            "daily" => new(Kind.Interval, 24),
            "bid" => new(Kind.Interval, 12),
            "tid" => new(Kind.Interval, 8),
            "qid" => new(Kind.Interval, 6),
            "once" => new(Kind.Once, 0),
            _ => new(Kind.Underivable, 0),
        };
    }

    /** a stored stamp → UTC instant, per the project's three stored forms:
        dated "yyyy-MM-dd HH:mm" (every event since the calendar-date fix),
        "D-n HH:mm" (the seeded display convention — n days before today),
        bare "HH:mm" (pre-fix live stamps — treated as today, as always).
        Null = no honest instant exists. */
    public static DateTime? ParseStamp(string? t, DateTime nowUtc)
    {
        if (string.IsNullOrEmpty(t)) return null;
        if (DateTime.TryParseExact(t, "yyyy-MM-dd HH:mm", null,
                System.Globalization.DateTimeStyles.AssumeUniversal | System.Globalization.DateTimeStyles.AdjustToUniversal,
                out var dated))
            return dated;
        var m = System.Text.RegularExpressions.Regex.Match(t, @"^(?:D-([0-9]+) )?([0-9]{2}):([0-9]{2})$");
        if (!m.Success) return null;
        var days = m.Groups[1].Success ? int.Parse(m.Groups[1].Value) : 0;
        return nowUtc.Date.AddDays(-days).AddHours(int.Parse(m.Groups[2].Value)).AddMinutes(int.Parse(m.Groups[3].Value));
    }

    /** THERAPY START — the schedule's anchor: the signing event's time (the
        moment the order came into force; the retired stub also anchored
        there), falling back to the ordered time. The first expected dose is
        the next full hour after the anchor (the retired stub's first-dose
        semantics, preserved). */
    public static DateTime? TherapyStart(OrderRow o, DateTime nowUtc)
    {
        var history = JsonSerializer.Deserialize<List<OrderEventDto>>(o.HistoryJson, JsonOpts.Web)!;
        var signed = history.FirstOrDefault(e => e.Action == "signed");
        return ParseStamp(signed?.Time, nowUtc) ?? ParseStamp(o.OrderedTime, nowUtc);
    }

    public static DateTime FirstDose(DateTime anchor) =>
        new DateTime(anchor.Year, anchor.Month, anchor.Day, anchor.Hour, 0, 0, DateTimeKind.Utc).AddHours(1);

    /* RENDER HORIZON (the design's §6 — the stated choice):
       - FUTURE: exactly the NEXT undocumented instance — the bedside
         question is "what is due next", and emitting one instance
         guarantees doses never run out (documenting it surfaces the next).
       - PAST: every undocumented instance of the last 24 hours renders
         INDIVIDUALLY (a missed dose ages in place, visibly); older missed
         instances are never silently truncated — they collapse into one
         explicit summary row carrying the count and the oldest stamp.
       - 'once' instances always render individually (a single expected
         dose is never an aggregate). Documented instances render as their
         facts wherever the facts fall — facts are the record and are
         always shown. */
    /* [2026-09-30, Amendment B: repeating orders no longer use this
       horizon — their single current round renders, and stays documentable,
       at any age. It remains the bound on how far back an explicit actual
       administration time (administeredAt) may be entered.] */
    public const int PastWindowHours = 24;

    /* LATE-ADMINISTRATION THRESHOLD (overdue delay reason — the clinical
       validator's option a): a dose documented GIVEN more than this long
       after its scheduled instant requires a DELAY REASON — late
       administration is clinically significant (patient off the floor,
       pharmacy delay, refusal) and must be documented, never silent. The
       dose is never BLOCKED — the patient still needs the drug. This is
       the single definition of "late enough to require a reason",
       enforced at the documentation endpoint and mirrored by the client
       dialog (LATE_THRESHOLD_MINUTES in src/lib/time.ts). It is
       deliberately DISTINCT from the display state that turns a row
       OVERDUE the moment it passes (dueStateFor) — instances sit on
       full-hour grid points and real documentation lands minutes after,
       so an instant-threshold reason requirement would end the
       single-click on-time flow. PRN and on-demand doses have no
       schedule and can never be late. */
    public const int LateThresholdHours = 2;

    /* ---------------- THE ROLLING TIMER (owner's rule, 2026-09-30) ----------------
       mar-derived-schedule.md Amendment B, which supersedes Amendment A's
       late-only re-timing and its segmented grid. The owner: "the timer of
       the next round will start after the first has been given (not
       something fixed)". A repeating (interval) order has ONE CURRENT ROUND
       at a time, never a grid:
       - round 1 is the first dose (FirstDose, unchanged), or, for an order
         whose stored facts all predate this rule, its LEGACY ENTRY slot;
       - exactly one fact resolves a round, and carries Round = its number;
       - the next round is due at TIMER + interval. A resolving fact's timer
         instant is its ACTUAL administration time when GIVEN (early, on time
         or late alike), and its SCHEDULED time when HELD/REFUSED (the
         owner-confirmed skipped-dose rule, never the documenting time);
       - the timer in force is the LATEST of those instants, by actual
         chronology, so a backdated older actual time resolves its round
         without rewinding a newer timer;
       - the clock never creates a round: an unresolved round stays current
         as it turns due, then overdue, for as long as it takes. There are no
         missed rows, no future rounds and no 24 h horizon for it.
       Only stored facts and the order feed this, so a round's identity is
       stable across refreshes. The write endpoint and the read side call the
       same CurrentRound, so the endpoint accepts exactly the round
       GET /api/icu/mar serves. Nothing new is stored but the fact's Round. */

    /** the current round: its number, its due instant, and what timed it
        (the timer instant + "given" | "skipped"; null on round 1) */
    public readonly record struct Round(int Number, DateTime Due, DateTime? TimerFrom, string? TimerRule);

    /** the round's documentable identity: its due minute plus its number
        ("yyyy-MM-ddTHH:mm~r<n>", URL-safe). Two rounds, or a round and a
        stored fact, can share a due minute and stay distinguishable. */
    public static string RoundIdentity(Round r) => $"{IdentityOf(r.Due)}~r{r.Number}";

    public static (DateTime Due, int Number)? ParseRoundIdentity(string id)
    {
        var m = System.Text.RegularExpressions.Regex.Match(id, @"^([0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2})~r([1-9][0-9]{0,8})$");
        if (!m.Success || !DateTime.TryParseExact(m.Groups[1].Value, "yyyy-MM-ddTHH:mm", null,
                System.Globalization.DateTimeStyles.AssumeUniversal | System.Globalization.DateTimeStyles.AdjustToUniversal,
                out var due))
            return null;
        return (due, int.Parse(m.Groups[2].Value));
    }

    /** a DATED stamp → UTC instant; null for anything else (PRN/on-demand
        ""; legacy "HH:mm" / "D-n HH:mm" forms). Every fact this rule writes
        is dated. */
    public static DateTime? ParseDated(string? t) =>
        !string.IsNullOrEmpty(t) && DateTime.TryParseExact(t, "yyyy-MM-dd HH:mm", null,
            System.Globalization.DateTimeStyles.AssumeUniversal | System.Globalization.DateTimeStyles.AdjustToUniversal,
            out var d) ? d : null;

    /** a round-resolving fact's timer instant: GIVEN → its actual
        administration time (the fact's documentedTime); HELD/REFUSED → the
        skipped round's scheduled time */
    public static DateTime? TimerInstant(AdminDto a) =>
        a.Status == "given" ? ParseDated(a.DocumentedTime) : ParseDated(a.ScheduledTime);

    /** THE rule, shared by GET /api/icu/mar and the write endpoint. `facts`
        are the stored administrations in recording order (retired
        'scheduled' stubs are ignored — never facts). */
    public static Round CurrentRound(DateTime first, int intervalHours, IReadOnlyList<AdminDto> facts, DateTime nowUtc)
    {
        var step = TimeSpan.FromHours(intervalHours);
        var resolved = facts.Where(a => a.Round is not null && a.Status != "scheduled").ToList();
        DateTime? timer = null;
        string? rule = null;
        foreach (var a in resolved)
            if (TimerInstant(a) is DateTime t && (timer is null || t >= timer.Value))
            {
                timer = t;
                rule = a.Status == "given" ? "given" : "skipped";
            }
        var number = resolved.Count == 0 ? 1 : resolved.Max(a => a.Round!.Value) + 1;
        return timer is null
            ? new(number, LegacyEntry(first, step, facts, nowUtc), null, null)
            : new(number, timer.Value + step, timer, rule);
    }

    /** LEGACY ACTIVATION: how an order documented before this rule enters
        it, without reinterpreting anything. A fact with no Round is a legacy
        fact: shown as stored, and it NEVER drives the timer, so no old late
        (or early) administration starts one. Round 1 of such an order is the
        first slot of its original therapy-start grid, at or after the slot
        containing its latest legacy fact's recorded time, that no legacy
        fact documents; with no legacy fact it is simply the first dose. One
        slot, from stored facts only (never the clock): the grid is not used
        to generate anything else. Example (the approved compatibility
        case): q1h, the 07:00 slot given early at 06:50 leaves the 06:00 slot
        outstanding, so round 1 is 06:00; given at 06:55 → next 07:55. The
        undated seed forms ("HH:mm", "D-n HH:mm") resolve as ParseStamp
        always has. */
    public static DateTime LegacyEntry(DateTime first, TimeSpan step, IReadOnlyList<AdminDto> facts, DateTime nowUtc)
    {
        var legacy = facts.Where(a => a.Round is null && a.Status != "scheduled").ToList();
        DateTime? latest = null;
        foreach (var a in legacy)
            if ((ParseStamp(a.DocumentedTime, nowUtc) ?? ParseStamp(a.ScheduledTime, nowUtc)) is DateTime t
                && (latest is null || t > latest.Value))
                latest = t;
        if (latest is null) return first;
        var documented = legacy.Select(a => ParseStamp(a.ScheduledTime, nowUtc))
            .Where(t => t is not null).Select(t => t!.Value).ToHashSet();
        var slot = latest.Value <= first
            ? first
            : first.AddTicks((latest.Value - first).Ticks / step.Ticks * step.Ticks);
        while (documented.Contains(slot)) slot += step;   // bounded by the legacy facts
        return slot;
    }
}

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

    /* ---------------- LATE-DOSE RE-TIMING (owner's rule, 2026-09-30) ----------------
       mar-derived-schedule.md Amendment A. On a repeating (interval) order, a
       dose documented GIVEN whose actual administration time is later than
       its scheduled instant re-times the grid: the next repeating dose is
       actual + interval, then every interval after that (q1h due 06:00,
       given 06:05 → 07:05, 08:05; the 07:05 given 07:12 → 08:12).

       THE MECHANISM — explicit metadata, derived schedule. The write
       endpoint stamps the late fact's ScheduleAnchor (= its actual
       administration time) when, and only when, it re-times; the read side
       derives the grid from those anchors. Nothing else is stored — no
       generated future slot ever is. A pre-update fact has no anchor, so
       installing the update re-times nothing that already exists.

       WHICH late GIVEN re-times (THE FLOOR RULE — one predicate, used by the
       write endpoint to decide and by the read side to replay in recording
       order, so the two can never disagree): the actual time must be later
       than its own scheduled instant AND later than the FLOOR — the latest
       of every earlier fact's dated scheduled instant and every earlier
       effective anchor. Consequences, each by construction:
       - recording an OLDER dose later never rewinds a newer schedule (a
         backdated actual time at or before the floor re-times nothing);
       - a documented instance can never fall off the derived grid (the new
         segment starts after every documented instance), so no fact is
         orphaned and no duplicate "missed" twin appears beside one;
       - effective anchors are strictly increasing, so the grid is one
         strictly increasing sequence (no duplicate instances).

       THE GRID with effective anchors A1 < A2 < … < An: therapy-start points
       first + k·interval while t < A1; then Ai + k·interval (k ≥ 1) while
       t < A(i+1); the last segment is unbounded (doses never run out).
       Instances of an earlier segment that fell BEFORE the re-timing
       instant stay on the grid — a dose missed while the late one was
       still outstanding is a historical miss and stays missed (never
       marked given, never erased). Instances at or after it are SUPERSEDED
       by the re-timed grid — a stale browser posting one gets 409. */

    /** a DATED stamp → UTC instant; null for anything else (PRN/on-demand
        ""; legacy "HH:mm" / "D-n HH:mm" forms, whose instant depends on the
        reading day and so can never decide a re-timing deterministically) */
    public static DateTime? ParseDated(string? t) =>
        !string.IsNullOrEmpty(t) && DateTime.TryParseExact(t, "yyyy-MM-dd HH:mm", null,
            System.Globalization.DateTimeStyles.AssumeUniversal | System.Globalization.DateTimeStyles.AdjustToUniversal,
            out var d) ? d : null;

    /** THE FLOOR RULE's single predicate: does a given dose scheduled at
        `scheduled`, actually administered at `actual`, re-time the grid
        over the facts summarised by `floor`? */
    public static bool Retimes(DateTime scheduled, DateTime actual, DateTime? floor) =>
        actual > scheduled && (floor is null || actual > floor.Value);

    /** replay the facts IN RECORDING ORDER (AdministrationsJson is
        append-only) → the effective anchors (strictly increasing) and the
        floor a NEW fact would be judged against. Only a GIVEN fact carrying
        a dated ScheduleAnchor is a candidate; legacy facts never are. */
    public static (List<DateTime> anchors, DateTime? floor) RetimingState(IEnumerable<AdminDto> factsInRecordingOrder)
    {
        var anchors = new List<DateTime>();
        DateTime? floor = null;
        foreach (var a in factsInRecordingOrder)
        {
            if (a.Status == "scheduled") continue;   // retired stub rows are not facts
            var s = ParseDated(a.ScheduledTime);
            if (a.Status == "given" && s is not null && ParseDated(a.ScheduleAnchor) is DateTime anchor
                && Retimes(s.Value, anchor, floor))
            {
                anchors.Add(anchor);
                floor = anchor;   // anchor > floor and > s by the predicate
            }
            else if (s is not null && (floor is null || s.Value > floor.Value))
                floor = s.Value;
        }
        return (anchors, floor);
    }

    /** the derived grid — strictly increasing and unbounded (callers stop
        iterating; see IntervalInstances) */
    public static IEnumerable<DateTime> Grid(DateTime first, int intervalHours, IReadOnlyList<DateTime> anchors)
    {
        var step = TimeSpan.FromHours(intervalHours);
        var start = first;
        for (var seg = 0; ; seg++)
        {
            DateTime? cutoff = seg < anchors.Count ? anchors[seg] : null;
            for (var t = start; cutoff is null || t < cutoff.Value; t += step)
                yield return t;
            start = cutoff!.Value + step;   // the re-timed segment: anchor + interval onward
        }
    }

    /** is `t` an instance of the derived grid? Arithmetic per segment —
        never iterates, so an absurd far-future identity costs nothing */
    public static bool OnGrid(DateTime t, DateTime first, int intervalHours, IReadOnlyList<DateTime> anchors)
    {
        var step = TimeSpan.FromHours(intervalHours).Ticks;
        /* the segment t falls in: the last anchor at or before t */
        var seg = 0;
        while (seg < anchors.Count && anchors[seg] <= t) seg++;
        var segStart = seg == 0 ? first : anchors[seg - 1].AddTicks(step);
        return t >= segStart && (t - segStart).Ticks % step == 0;
    }

    /** the re-timing instant that SUPERSEDED `t`, when t was an instance of
        an earlier segment at or after that segment's cutoff (a stale
        browser's future instance); null when t never was an instance */
    public static DateTime? SupersededBy(DateTime t, DateTime first, int intervalHours, IReadOnlyList<DateTime> anchors)
    {
        var step = TimeSpan.FromHours(intervalHours).Ticks;
        for (var seg = 0; seg < anchors.Count; seg++)
        {
            var segStart = seg == 0 ? first : anchors[seg - 1].AddTicks(step);
            if (t >= anchors[seg] && t >= segStart && (t - segStart).Ticks % step == 0)
                /* name the re-timing currently in force at t */
                return anchors.Last(a => a <= t);
        }
        return null;
    }

    /** every grid instant for an interval order from therapy start through
        the next undocumented instance after nowUtc, split into
        (aggregatedMissed, renderable) — over the RE-TIMED grid. */
    public static (int aggregatedMissed, DateTime? oldestAggregated, List<DateTime> renderable)
        IntervalInstances(DateTime first, int intervalHours, IReadOnlyList<DateTime> anchors,
            HashSet<string> documentedStamps, DateTime nowUtc)
    {
        var windowStart = nowUtc.AddHours(-PastWindowHours);
        var aggregated = 0;
        DateTime? oldest = null;
        var renderable = new List<DateTime>();
        foreach (var t in Grid(first, intervalHours, anchors))
        {
            var documented = documentedStamps.Contains(StampOf(t));
            /* pre-window grid points: count the undocumented ones (aggregated) */
            if (t < windowStart) { if (!documented) { aggregated++; oldest ??= t; } continue; }
            /* in-window and next-future instances, stopping at the FIRST
               undocumented instance after now (the doses-never-run-out rule) */
            if (t <= nowUtc) { if (!documented) renderable.Add(t); continue; }
            if (!documented) { renderable.Add(t); break; }
        }
        return (aggregated, oldest, renderable);
    }
}

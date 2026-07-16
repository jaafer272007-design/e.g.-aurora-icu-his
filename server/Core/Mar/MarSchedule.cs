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
        var q = System.Text.RegularExpressions.Regex.Match(m.Frequency, @"^q(\d+)h$");
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
        var m = System.Text.RegularExpressions.Regex.Match(t, @"^(?:D-(\d+) )?(\d{2}):(\d{2})$");
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

    /** every grid instant for an interval order from therapy start through
        the next undocumented instance after nowUtc, split into
        (aggregatedMissed, renderable). Pure arithmetic on the anchor grid —
        never loops over the order's full age. */
    public static (int aggregatedMissed, DateTime? oldestAggregated, List<DateTime> renderable)
        IntervalInstances(DateTime first, int intervalHours, HashSet<string> documentedStamps, DateTime nowUtc)
    {
        var step = TimeSpan.FromHours(intervalHours);
        var windowStart = nowUtc.AddHours(-PastWindowHours);
        /* index of the first grid point inside the render window */
        var k0 = first >= windowStart ? 0 : (int)Math.Ceiling((windowStart - first) / step);
        /* pre-window grid points: count the undocumented ones (aggregated) */
        var aggregated = 0;
        DateTime? oldest = null;
        for (var k = 0; k < k0; k++)
        {
            var t = first + k * step;
            if (documentedStamps.Contains(StampOf(t))) continue;
            aggregated++;
            oldest ??= t;
        }
        /* in-window and next-future instances, stopping at the FIRST
           undocumented instance after now (the doses-never-run-out rule) */
        var renderable = new List<DateTime>();
        for (var k = k0; ; k++)
        {
            var t = first + k * step;
            var documented = documentedStamps.Contains(StampOf(t));
            if (t <= nowUtc) { if (!documented) renderable.Add(t); continue; }
            if (!documented) { renderable.Add(t); break; }
        }
        return (aggregated, oldest, renderable);
    }
}

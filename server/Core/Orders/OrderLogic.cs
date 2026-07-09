using System.Text.Json;
using Aurora.Core.Persistence;
using Aurora.Core.Shared;
using Microsoft.EntityFrameworkCore;

namespace Aurora.Core.Orders;

/* ports of the mock store's helpers (src/lib/api/data/orders.ts) so the
   wire behavior matches the adapter contract exactly. (BadRequest moved to
   Aurora.Core.Shared.ApiError — it was never orders-specific; MarRowsFor
   moved to Aurora.Core.Mar.MarLogic — MAR derivation belongs to the MAR.) */
static class OrderLogic
{
    static int _orderSeq = 100;  // new orders: ORD-101… (seeded ones are ORD-2001…)
    static int _adminSeq = 500;  // new administrations: ADM-501…
    static int _rowSeq = 1000;   // insertion order for new rows (seeds are 1…n)

    static readonly string[] Categories = ["Medication", "Lab", "Imaging", "Nursing"];
    static readonly string[] Priorities = ["Routine", "Urgent", "STAT"];

    /* Frequency is the one medication field the server INTERPRETS (it
       drives administration-schedule generation), so unlike the
       display-only free-text fields (dose/route/duration — Layer 4
       formulary scope) it must parse: either a named frequency from the
       vocabulary the formulary/order sets/seeds actually use, or qNh with
       a physically sane interval. Anything else is a 400, never saved. */
    static readonly string[] NamedFrequencies =
        ["continuous", "daily", "bid", "tid", "qid", "once",
         "sliding scale", "per level", "per CRRT protocol"];

    public static bool IsValidFrequency(string f) =>
        NamedFrequencies.Contains(f)
        || (System.Text.RegularExpressions.Regex.Match(f, @"^q(\d{1,2})h$") is { Success: true } m
            && int.TryParse(m.Groups[1].Value, out var h) && h is >= 1 and <= 48);

    public const string FrequencyRule =
        "must be one of: continuous, daily, bid, tid, qid, once, sliding scale, per level, per CRRT protocol, or q<1-48>h";

    /* upper bound on any free-text request field — Kestrel's ~28 MB body
       limit is the only bound otherwise, and multi-megabyte strings would
       be persisted and re-served to every client */
    public const int MaxTextLength = 2000;

    /** shared text-field rule: required fields must be non-whitespace;
        optional fields may be absent but never blank; everything bounded */
    static string? CheckText(string name, string? value, bool required)
    {
        if (value is null) return required ? $"{name} is required" : null;
        if (string.IsNullOrWhiteSpace(value))
            return required ? $"{name} is required" : $"{name} must be non-empty when provided";
        if (value.Length > MaxTextLength) return $"{name} exceeds {MaxTextLength} characters";
        return null;
    }

    /** null when the draft is valid; otherwise the validation error to 400.
        Runs BEFORE any insert so an invalid batch creates zero orders.
        (The roster lookup is part of the sanctioned Core→Module seam.) */
    public static string? ValidateDraft(NewOrderDraftDto? d, int index, AuroraDb db)
    {
        var at = $"drafts[{index}]";
        if (d is null) return $"{at} is null";
        if (CheckText($"{at}.patientId", d.PatientId, required: true) is string p) return p;
        if (!db.Patients.AsNoTracking().Any(x => x.PatientId == d.PatientId))
            return $"{at}.patientId '{d.PatientId}' does not match any roster patient";
        if (d.Category is null || !Categories.Contains(d.Category))
            return $"{at}.category must be one of: {string.Join(", ", Categories)}";
        if (d.Priority is null || !Priorities.Contains(d.Priority))
            return $"{at}.priority must be one of: {string.Join(", ", Priorities)}";
        if (d.Medication is null && string.IsNullOrWhiteSpace(d.Summary))
            return $"{at} requires a summary (non-medication order) or a medication object";
        /* a provided-but-blank summary must never override the composed
           medication summary or create a contentless order */
        if (CheckText($"{at}.summary", d.Summary, required: false) is string s) return s;
        if (d.Medication is not null)
        {
            /* med orders are administered via the MAR schedule — the one-shot
               nursing implement action doesn't apply to them */
            if (d.RequiresImplementation == true)
                return $"{at}: a medication order cannot set requiresImplementation";
            var m = d.Medication;
            foreach (var (name, value, required) in new[] {
                ("drugId", m.DrugId, true), ("drug", m.Drug, true), ("dose", m.Dose, true),
                ("route", m.Route, true), ("frequency", m.Frequency, true),
                ("duration", m.Duration, true), ("prnIndication", m.PrnIndication, false) })
            {
                if (CheckText($"{at}.medication.{name}", value, required) is string e) return e;
            }
            if (!IsValidFrequency(m.Frequency))
                return $"{at}.medication.frequency '{m.Frequency}' is not a valid frequency — {FrequencyRule}";
        }
        return null;
    }

    /** validates a modify payload's provided fields — a change may omit
        fields but can never blank one or exceed the text bound */
    public static string? ValidateChanges(MedicationChanges c)
    {
        foreach (var (name, value) in new[] {
            ("drugId", c.DrugId), ("drug", c.Drug), ("dose", c.Dose), ("route", c.Route),
            ("frequency", c.Frequency), ("duration", c.Duration), ("prnIndication", c.PrnIndication) })
        {
            if (value is null) continue;
            if (string.IsNullOrWhiteSpace(value)) return $"changes.{name} must be a non-empty string";
            if (value.Length > MaxTextLength) return $"changes.{name} exceeds {MaxTextLength} characters";
        }
        if (c.Frequency is not null && !IsValidFrequency(c.Frequency))
            return $"changes.frequency '{c.Frequency}' is not a valid frequency — {FrequencyRule}";
        return null;
    }

    public static string NextOrderId() => $"ORD-{Interlocked.Increment(ref _orderSeq)}";
    public static string NextAdminId() => $"ADM-{Interlocked.Increment(ref _adminSeq)}";
    public static int NextSeq() => Interlocked.Increment(ref _rowSeq);

    public static string MedSummary(MedicationDto m) =>
        $"{m.Drug} {m.Dose} · {m.Route} · {(m.Prn ? $"PRN ({m.PrnIndication ?? "as required"})" : m.Frequency)}";

    /* mock schedule generation for newly signed med orders: next full hour,
       plus one interval for q\dh frequencies; PRN gets one availability row.
       Frequency is free text (mock parity) — the interval is bounds-checked
       with TryParse so no payload can crash schedule generation (a q0h /
       q99999999h string simply yields a single first dose). */
    public static List<AdminDto> GenerateAdministrations(MedicationDto m)
    {
        if (m.Prn) return [new AdminDto(NextAdminId(), "", "scheduled", null, null)];
        var now = DateTime.UtcNow;
        var first = new DateTime(now.Year, now.Month, now.Day, now.Hour, 0, 0, DateTimeKind.Utc).AddHours(1);
        var times = new List<DateTime> { first };
        var interval = System.Text.RegularExpressions.Regex.Match(m.Frequency, @"q(\d+)h");
        if (interval.Success && int.TryParse(interval.Groups[1].Value, out var hours) && hours is >= 1 and <= 168)
            times.Add(first.AddHours(hours));
        return times.Select(t => new AdminDto(NextAdminId(), t.ToString("HH:mm"), "scheduled", null, null)).ToList();
    }

    public static string AppendHistory(string historyJson, OrderEventDto evt)
    {
        var history = JsonSerializer.Deserialize<List<OrderEventDto>>(historyJson, JsonOpts.Web)!;
        history.Add(evt);
        return JsonSerializer.Serialize(history, JsonOpts.Web);
    }

    /* merge non-null change fields; diff string matches the mock's
       ("field: old → new" with lowercase booleans, comma-joined) */
    public static (MedicationDto merged, string diff) ApplyChanges(MedicationDto before, MedicationChanges c)
    {
        var merged = new MedicationDto(
            c.DrugId ?? before.DrugId, c.Drug ?? before.Drug, c.Dose ?? before.Dose,
            c.Route ?? before.Route, c.Frequency ?? before.Frequency, c.Duration ?? before.Duration,
            c.Prn ?? before.Prn, c.PrnIndication ?? before.PrnIndication);
        var parts = new List<string>();
        void Diff(string name, string? oldV, string? newV)
        {
            if (newV is not null && newV != oldV) parts.Add($"{name}: {oldV} → {newV}");
        }
        Diff("drugId", before.DrugId, c.DrugId);
        Diff("drug", before.Drug, c.Drug);
        Diff("dose", before.Dose, c.Dose);
        Diff("route", before.Route, c.Route);
        Diff("frequency", before.Frequency, c.Frequency);
        Diff("duration", before.Duration, c.Duration);
        Diff("prn", before.Prn ? "true" : "false", c.Prn is null ? null : (c.Prn.Value ? "true" : "false"));
        Diff("prnIndication", before.PrnIndication, c.PrnIndication);
        return (merged, string.Join(", ", parts));
    }
}

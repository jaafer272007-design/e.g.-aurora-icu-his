using System.Text.Json;
using Aurora.Core.Adt;
using Aurora.Core.MasterData;
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
       display-only free-text fields (dose/route/duration) it must parse.
       LAYER 4: the named vocabulary is MASTER DATA now — the hardcoded
       array that lived here ("per CRRT protocol" was ICU-specific content
       sitting in Core/Orders) moved to the NamedFrequencies table, read
       via FormularyLogic. Validation behavior is byte-identical: a named
       value ∪ q<1-48>h, and the error text is built from the table in
       seed order. Anything else is a 400, never saved. */

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
        Layer 2: the patient lookup now reads Core ADT (Patient + open
        Encounter) — the former roster-table seam site is dissolved. The
        unknown-patient error text is kept byte-identical (accepted
        historical cosmetics, like the /api/icu/ prefix). */
    public static string? ValidateDraft(NewOrderDraftDto? d, int index, AuroraDb db)
    {
        var at = $"drafts[{index}]";
        if (d is null) return $"{at} is null";
        if (CheckText($"{at}.patientId", d.PatientId, required: true) is string p) return p;
        if (!db.AdtPatients.AsNoTracking().Any(x => x.PatientId == d.PatientId))
            return $"{at}.patientId '{d.PatientId}' does not match any roster patient";
        /* the OPEN-ENCOUNTER requirement is deliberately NOT here: an
           unknown patient is a validation failure (400), but initiating
           care on a closed episode is RESOURCE STATE — the endpoint asks
           EncounterGuard, which answers 409 (the chokepoint). */
        if (d.Category is null || !Categories.Contains(d.Category))
            return $"{at}.category must be one of: {string.Join(", ", Categories)}";
        if (d.Priority is null || !Priorities.Contains(d.Priority))
            return $"{at}.priority must be one of: {string.Join(", ", Priorities)}";
        if (d.Medication is null && string.IsNullOrWhiteSpace(d.Summary))
            return $"{at} requires a summary (non-medication order) or a medication object";
        /* Layer 4 (lab catalogue): a catalogue-test reference is SHAPE —
           only a Lab order can carry one, in any state (400, like
           requiresImplementation on a medication draft). SAFETY
           ENFORCEMENT closed the escape hatch: the CATALOGUE IS
           AUTHORITATIVE — an unknown testId is a validation 400 (payload
           field, the unknown-patientId precedent; 404 stays reserved for
           addressed resources). The inactive-test check is resource STATE
           and lives in the endpoint (409, after the encounter guard). */
        if (d.TestId is not null)
        {
            if (d.Category != "Lab")
                return $"{at}: only a Lab order may reference a catalogue test (testId)";
            if (CheckText($"{at}.testId", d.TestId, required: false) is string tid) return tid;
            if (MasterData.LabCatalogLogic.Resolve(db, d.TestId) is null)
                return $"{at}.testId '{d.TestId}' does not match any catalogue test";
        }
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
            /* STRUCTURED INFUSION: when a structured dose is present the
               display dose text is COMPOSED from it server-side — the
               client may omit dose entirely; a provided dose must match
               the composition exactly (the desync guard). Everything
               else about the order is the shared medication machinery. */
            foreach (var (name, value, required) in new[] {
                ("drugId", m.DrugId, true), ("drug", m.Drug, true), ("dose", m.Dose, m.Infusion is null),
                ("route", m.Route, true), ("frequency", m.Frequency, true),
                ("duration", m.Duration, true), ("prnIndication", m.PrnIndication, false) })
            {
                if (CheckText($"{at}.medication.{name}", value, required) is string e) return e;
            }
            if (m.Infusion is InfusionDoseDto inf)
            {
                if (ValidateInfusion(inf) is string iErr) return $"{at}.medication.infusion: {iErr}";
                /* SHAPE: a continuous-infusion dose on a non-continuous
                   order can never be right, in any state → 400 */
                if (m.Frequency != "continuous")
                    return $"{at}.medication: a structured infusion dose requires frequency 'continuous'";
                if (m.Prn)
                    return $"{at}.medication: a structured infusion dose cannot be PRN — an infusion runs continuously";
                var composed = ComposeInfusionDose(inf);
                if (!string.IsNullOrWhiteSpace(m.Dose) && m.Dose != composed)
                    return $"{at}.medication.dose '{m.Dose}' does not match the structured infusion dose '{composed}' — omit dose (the display text derives from the structured entry)";
            }
            /* SAFETY ENFORCEMENT: the FORMULARY IS AUTHORITATIVE — an
               unknown drugId is a validation 400 (the live ORD-168 finding
               closed; the free-text escape hatch is gone). Inactive stays
               resource state (409, in the endpoint after the guard). */
            if (FormularyLogic.Resolve(db, m.DrugId) is null)
                return $"{at}.medication.drugId '{m.DrugId}' does not match any formulary drug";
            if (!FormularyLogic.IsValidFrequency(db, m.Frequency))
                return $"{at}.medication.frequency '{m.Frequency}' is not a valid frequency — {FormularyLogic.FrequencyRule(db)}";
        }
        return null;
    }

    /** validates a modify payload's provided fields — a change may omit
        fields but can never blank one or exceed the text bound */
    public static string? ValidateChanges(MedicationChanges c, AuroraDb db)
    {
        foreach (var (name, value) in new[] {
            ("drugId", c.DrugId), ("drug", c.Drug), ("dose", c.Dose), ("route", c.Route),
            ("frequency", c.Frequency), ("duration", c.Duration), ("prnIndication", c.PrnIndication) })
        {
            if (value is null) continue;
            if (string.IsNullOrWhiteSpace(value)) return $"changes.{name} must be a non-empty string";
            if (value.Length > MaxTextLength) return $"changes.{name} exceeds {MaxTextLength} characters";
        }
        if (c.Frequency is not null && !FormularyLogic.IsValidFrequency(db, c.Frequency))
            return $"changes.frequency '{c.Frequency}' is not a valid frequency — {FormularyLogic.FrequencyRule(db)}";
        if (c.Infusion is not null && ValidateInfusion(c.Infusion) is string infErr)
            return $"changes.infusion: {infErr}";
        /* formulary authority applies to the modify path's new selection
           too — unknown target drugId is validation (400); inactive stays
           the endpoint's 409 */
        if (c.DrugId is not null && FormularyLogic.Resolve(db, c.DrugId) is null)
            return $"changes.drugId '{c.DrugId}' does not match any formulary drug";
        return null;
    }

    public static string NextOrderId() => $"ORD-{Interlocked.Increment(ref _orderSeq)}";
    public static string NextAdminId() => $"ADM-{Interlocked.Increment(ref _adminSeq)}";
    public static int NextSeq() => Interlocked.Increment(ref _rowSeq);

    /** PERSISTENCE-AWARE COUNTERS (found by the persistence PR's restart
        test): the generated-id blocks (ORD-101+, ADM-501+, Seq 1001+) are
        disjoint from the seed blocks (ORD-2001+, ADM-401-4xx, Seq 1..n).
        With a DURABLE database the counters must resume from the highest
        EXISTING generated id after a restart — resetting to the block
        floor re-issues an id and turns a valid create into a
        duplicate-key 500. Called once at startup (Seeder). Fresh/ephemeral
        databases resolve to the floors, so first-boot behavior is
        unchanged (ORD-101, ADM-501, Seq 1001). The generated blocks hold
        ~1,900 ids before touching the seed block — a documented prototype
        bound, replaced by DB-generated ids at Layer 2. */
    public static void InitializeCounters(AuroraDb db)
    {
        static int SuffixOf(string id) =>
            int.TryParse(id[(id.IndexOf('-') + 1)..], out var n) ? n : 0;
        _orderSeq = db.Orders.AsNoTracking().Select(o => o.OrderId).AsEnumerable()
            .Select(SuffixOf).Where(n => n is >= 100 and < 2000)
            .DefaultIfEmpty(100).Max();
        _adminSeq = db.Orders.AsNoTracking().Where(o => o.AdministrationsJson != null)
            .Select(o => o.AdministrationsJson!).AsEnumerable()
            .SelectMany(j => JsonSerializer.Deserialize<List<AdminDto>>(j, JsonOpts.Web)!)
            .Select(a => SuffixOf(a.AdminId)).Where(n => n is >= 500 and < 2000)
            .DefaultIfEmpty(500).Max();
        _rowSeq = db.Orders.Any() ? Math.Max(1000, db.Orders.Max(o => o.Seq)) : 1000;
    }

    public static string MedSummary(MedicationDto m) =>
        $"{m.Drug} {m.Dose} · {m.Route} · {(m.Prn ? $"PRN ({m.PrnIndication ?? "as required"})" : m.Frequency)}";

    /* ---- Structured Infusion Ordering (kg-based continuous infusions) ---- */

    /** the structured entry's vocabulary: mass µg ("mcg" on the wire) or
        mg; time per minute or per hour; the weight basis is always per kg
        (the design's decision). Bounds reject unit mistakes without
        constraining any real dose. */
    public static string? ValidateInfusion(InfusionDoseDto inf)
    {
        if (!double.IsFinite(inf.Value) || inf.Value is <= 0 or > 100000)
            return "value must be a number greater than 0 and at most 100000";
        if (inf.MassUnit is not ("mcg" or "mg"))
            return "massUnit must be one of: mcg, mg";
        if (inf.TimeBasis is not ("min" or "hour"))
            return "timeBasis must be one of: min, hour";
        return null;
    }

    /** the DISPLAY dose string, composed from the structured entry —
        "0.3 µg/kg/min" / "2 mg/kg/hour". The single source: the free-text
        Dose field of an infusion order always equals this composition,
        so display and structure can never desync. */
    public static string ComposeInfusionDose(InfusionDoseDto inf) =>
        $"{inf.Value.ToString("0.####", System.Globalization.CultureInfo.InvariantCulture)} "
        + $"{(inf.MassUnit == "mcg" ? "µg" : "mg")}/kg/{inf.TimeBasis}";

    /** medication as stored: when a structured infusion entry is present,
        the display Dose is composed from it (validation already rejected
        a mismatching client-supplied dose) */
    public static MedicationDto NormaliseMedication(MedicationDto m) =>
        m.Infusion is null ? m : m with { Dose = ComposeInfusionDose(m.Infusion) };

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
        /* a structured-infusion change composes the display dose (the
           endpoint already rejected a dose-only change on an infusion
           order and a mismatching supplied dose — single source holds) */
        var newDose = c.Infusion is not null ? ComposeInfusionDose(c.Infusion) : c.Dose;
        var merged = new MedicationDto(
            c.DrugId ?? before.DrugId, c.Drug ?? before.Drug, newDose ?? before.Dose,
            c.Route ?? before.Route, c.Frequency ?? before.Frequency, c.Duration ?? before.Duration,
            c.Prn ?? before.Prn, c.PrnIndication ?? before.PrnIndication,
            c.Infusion ?? before.Infusion);
        var parts = new List<string>();
        void Diff(string name, string? oldV, string? newV)
        {
            if (newV is not null && newV != oldV) parts.Add($"{name}: {oldV} → {newV}");
        }
        Diff("drugId", before.DrugId, c.DrugId);
        Diff("drug", before.Drug, c.Drug);
        Diff("dose", before.Dose, newDose);
        Diff("route", before.Route, c.Route);
        Diff("frequency", before.Frequency, c.Frequency);
        Diff("duration", before.Duration, c.Duration);
        Diff("prn", before.Prn ? "true" : "false", c.Prn is null ? null : (c.Prn.Value ? "true" : "false"));
        Diff("prnIndication", before.PrnIndication, c.PrnIndication);
        return (merged, string.Join(", ", parts));
    }
    /** THE single discontinue mechanics — status + reason, remaining
        scheduled administrations cancelled, audited history entry with the
        acting clinician (or the backfill system actor). Shared by the
        manual endpoint, the DISCHARGE hook, and the one-time backfill so
        the invariant ("an order's lifecycle is bounded by its encounter")
        always discontinues the same way — audited, never deleted. */
    public static void Discontinue(OrderRow row, string actor, string reason)
    {
        row.Status = "discontinued";
        row.StatusReason = reason;
        if (row.AdministrationsJson is not null)
        {
            /* remaining scheduled administrations are cancelled with the order */
            var admins = JsonSerializer.Deserialize<List<AdminDto>>(row.AdministrationsJson, JsonOpts.Web)!
                .Where(a => a.Status != "scheduled").ToList();
            row.AdministrationsJson = JsonSerializer.Serialize(admins, JsonOpts.Web);
        }
        row.HistoryJson = AppendHistory(row.HistoryJson,
            new(DateTime.UtcNow.ToString("HH:mm"), actor, "discontinued", reason));
    }

    /** THE DISCHARGE CASCADE — the explicitly-named LIFECYCLE path (never
        routed through EncounterGuard; closing an episode writes to it by
        design). Discontinues the encounter's active/pending orders with
        the DISCHARGING CLINICIAN as the audited actor. Called inside the
        discharge transaction; SaveChanges belongs to the caller. */
    public static int DischargeCascade(AuroraDb db, string encounterId, string actor)
    {
        var n = 0;
        foreach (var row in db.Orders.Where(o =>
            o.EncounterId == encounterId && (o.Status == "active" || o.Status == "pending")))
        {
            Discontinue(row, actor, "patient discharged — auto-discontinued at discharge");
            n++;
        }
        return n;
    }

    /** ONE-TIME, IDEMPOTENT boot backfill for the encounter-scoping fix
        (the ORD-113 defect). Two steps, each a no-op on already-migrated
        data:
        1. Resolve EncounterId for every order that has none. RULE: the
           patient's OPEN encounter if one exists — every existing order
           was created under the forward invariant ("orders require an
           admitted patient"), and no patient in this database has ever
           had a second encounter opened while an order from an earlier
           one survived, so the open encounter IS the creation encounter
           where one exists. Otherwise (patient fully discharged, e.g.
           ORD-113's P-1017) the MOST RECENT encounter (highest id).
        2. Restore the invariant: any active/pending order whose encounter
           is not open is discontinued — audited with a reason recording
           that the encounter closed before the invariant existed; the
           order row is never deleted. */
    public static (int Scoped, int Restored) BackfillEncounterScope(AuroraDb db)
    {
        var encsByPatient = db.Encounters.AsNoTracking().AsEnumerable()
            .GroupBy(e => e.PatientId)
            .ToDictionary(g => g.Key, g => g.ToList());
        var scoped = 0;
        foreach (var row in db.Orders.Where(o => o.EncounterId == ""))
        {
            if (!encsByPatient.TryGetValue(row.PatientId, out var encs) || encs.Count == 0)
                continue; // unresolvable (no encounter has ever existed) — impossible for data created under the forward invariant; step 2 still restores the invariant for it
            var enc = encs.FirstOrDefault(e => e.Status == "open")
                ?? encs.OrderByDescending(e => e.EncounterId, StringComparer.Ordinal).First();
            row.EncounterId = enc.EncounterId;
            scoped++;
        }
        var openIds = db.Encounters.AsNoTracking()
            .Where(e => e.Status == "open").Select(e => e.EncounterId).ToHashSet();
        var restored = 0;
        foreach (var row in db.Orders.AsEnumerable()
            .Where(o => (o.Status == "active" || o.Status == "pending") && !openIds.Contains(o.EncounterId)))
        {
            /* actor = the reserved SYSTEM principal (seeded, never
               authenticates) so a reader years from now sees this was a
               migration, not a clinician's decision */
            Discontinue(row, "System",
                "system migration — encounter closed before the encounter-bound invariant existed");
            restored++;
        }
        db.SaveChanges();
        return (scoped, restored);
    }
}

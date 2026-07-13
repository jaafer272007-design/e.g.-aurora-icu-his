using System.Text.Json;
using Aurora.Core.Orders;
using Aurora.Core.Persistence;
using Aurora.Core.Shared;
using Microsoft.EntityFrameworkCore;

namespace Aurora.Core.LabImaging;

/* Result creation / audit helpers (results audit PR). Validation follows
   the codified rule (precise 400s, whole payload validated before any
   insert); id counters follow the persistence-aware pattern proven by
   OrderLogic.InitializeCounters. */
static class ResultsLogic
{
    static int _labSeq = 9000;   // created labs: LAB-9001… (seeds are LAB-6001…6073)
    static int _studySeq = 9500; // created studies: IMG-9501… (seeds are IMG-7001…7004)

    static readonly string[] ItemFlags = ["normal", "abnormal", "critical"];
    static readonly string[] ImagingFlags = ["normal", "abnormal", "critical"];

    /* the wire contract types these as closed unions (LabPanelKey /
       ImagingModality in src/lib/api/types.ts) — a field the contract
       closes must parse (the frequency-vocabulary precedent), so an
       unknown panel/modality is a 400, never saved. LAYER 4 PHASE 2: the
       PANEL vocabulary is the LAB TEST CATALOGUE now — the hardcoded
       array moved to the LabTests table (seeded from the same seven
       panels, so validation is byte-identical) and the error text is
       built from it in seed order. A panel resolves against ANY catalogue
       test, active OR inactive: deactivation blocks ORDERING, never
       RESULTING — a result completes care already ordered. Modalities
       stay a closed union until the imaging-order workflow exists. */
    static readonly string[] Modalities = ["CXR", "CT", "US", "Echo", "MRI"];

    public static string NextLabId() => $"LAB-{Interlocked.Increment(ref _labSeq)}";
    public static string NextStudyId() => $"IMG-{Interlocked.Increment(ref _studySeq)}";

    /** PERSISTENCE-AWARE COUNTERS (the OrderLogic rule): resume from the
        highest persisted id in the generated blocks (LAB-9001+/IMG-9501+,
        disjoint from the seed blocks) so a restart against a durable
        database never re-issues an id. Fresh databases resolve to the
        block floors — first-boot behavior unchanged. */
    public static void InitializeCounters(AuroraDb db)
    {
        static int SuffixOf(string id) =>
            int.TryParse(id[(id.IndexOf('-') + 1)..], out var n) ? n : 0;
        _labSeq = db.LabDraws.AsNoTracking().Select(d => d.LabId).AsEnumerable()
            .Select(SuffixOf).Where(n => n >= 9000).DefaultIfEmpty(9000).Max();
        _studySeq = db.ImagingStudies.AsNoTracking().Select(s => s.StudyId).AsEnumerable()
            .Select(SuffixOf).Where(n => n >= 9500).DefaultIfEmpty(9500).Max();
    }

    static string? CheckText(string name, string? value, bool required)
    {
        if (value is null) return required ? $"{name} is required" : null;
        if (string.IsNullOrWhiteSpace(value))
            return required ? $"{name} is required" : $"{name} must be non-empty when provided";
        if (value.Length > OrderLogic.MaxTextLength)
            return $"{name} exceeds {OrderLogic.MaxTextLength} characters";
        return null;
    }

    /** null when valid, else the precise 400 message. The whole payload is
        validated before any insert. Unknown patient = VALIDATION (400);
        the open-encounter requirement is deliberately NOT here — that is
        resource state, answered by EncounterGuard with 409 (the same
        split ValidateDraft documents for orders). */
    public static string? ValidateLabCreate(CreateLabRequest r, AuroraDb db)
    {
        if (CheckText("patientId", r.PatientId, required: true) is string p) return p;
        if (!db.AdtPatients.AsNoTracking().Any(x => x.PatientId == r.PatientId))
            return $"patientId '{r.PatientId}' does not match any roster patient";
        if (r.Panel is null || Aurora.Core.MasterData.LabCatalogLogic.Resolve(db, r.Panel) is null)
            return $"panel must be one of: {string.Join(", ", Aurora.Core.MasterData.LabCatalogLogic.TestIds(db))}";
        if (CheckText("label", r.Label, required: true) is string lb) return lb;
        if (CheckText("note", r.Note, required: false) is string nt) return nt;
        if (r.Items is null || r.Items.Count == 0)
            return "at least one result item is required (items[])";
        for (var i = 0; i < r.Items.Count; i++)
        {
            var it = r.Items[i];
            var at = $"items[{i}]";
            if (it is null) return $"{at} is null";
            if (CheckText($"{at}.analyte", it.Analyte, required: true) is string a) return a;
            if (it.Value is null || !double.IsFinite(it.Value.Value))
                return $"{at}.value must be a finite number";
            /* unit may be EMPTY — unitless analytes (pH) are part of the
               canonical shape (14 seed items carry "") — but stays bounded */
            if (it.Unit is { Length: > OrderLogic.MaxTextLength })
                return $"{at}.unit exceeds {OrderLogic.MaxTextLength} characters";
            if (CheckText($"{at}.refRange", it.RefRange, required: true) is string rr) return rr;
            if (it.RefLow is null || !double.IsFinite(it.RefLow.Value)
                || it.RefHigh is null || !double.IsFinite(it.RefHigh.Value)
                || it.RefLow.Value > it.RefHigh.Value)
                return $"{at}.refLow/refHigh must be finite numbers with refLow <= refHigh";
            if (it.Flag is null || !ItemFlags.Contains(it.Flag))
                return $"{at}.flag must be one of: {string.Join(", ", ItemFlags)}";
        }
        return null;
    }

    /** null when valid, else the precise 400 — the MANUAL DOCUMENTATION path
        (Lab Result-Entry design). Leaner than ValidateLabCreate: the client
        supplies only patientId, the catalogue panel, and per-analyte
        {analyte, value}; unit/refRange/bounds/flag are catalogue-derived, so
        they are NOT validated here (they cannot be wrong — the server owns
        them). Each submitted analyte MUST belong to the chosen panel's
        catalogue definition (a display-string match today — coded analyte
        identity is the recorded future item). A panel resolves against ANY
        catalogue test, active OR inactive (resulting is never blocked by a
        reference-status change — the same rule ValidateLabCreate documents). */
    public static string? ValidateLabDocument(DocumentLabRequest r, AuroraDb db)
    {
        if (CheckText("patientId", r.PatientId, required: true) is string p) return p;
        if (!db.AdtPatients.AsNoTracking().Any(x => x.PatientId == r.PatientId))
            return $"patientId '{r.PatientId}' does not match any roster patient";
        var test = r.Panel is null ? null : Aurora.Core.MasterData.LabCatalogLogic.Resolve(db, r.Panel);
        if (test is null)
            return $"panel must be one of: {string.Join(", ", Aurora.Core.MasterData.LabCatalogLogic.TestIds(db))}";
        if (CheckText("note", r.Note, required: false) is string nt) return nt;
        if (r.Items is null || r.Items.Count == 0)
            return "at least one result item is required (items[])";
        var known = JsonSerializer.Deserialize<List<Aurora.Core.MasterData.AnalyteDefDto>>(test.AnalytesJson, JsonOpts.Web)!
            .Select(a => a.Analyte).ToList();
        var knownSet = known.ToHashSet();
        for (var i = 0; i < r.Items.Count; i++)
        {
            var it = r.Items[i];
            var at = $"items[{i}]";
            if (it is null) return $"{at} is null";
            if (CheckText($"{at}.analyte", it.Analyte, required: true) is string a) return a;
            if (!knownSet.Contains(it.Analyte!))
                return $"{at}.analyte '{it.Analyte}' is not part of the {test.TestId} panel — expected one of: {string.Join(", ", known)}";
            if (it.Value is null || !double.IsFinite(it.Value.Value))
                return $"{at}.value must be a finite number";
        }
        return null;
    }

    /** resolve each documented {analyte, value} against the panel's catalogue
        definition — the stored item carries the catalogue-owned unit,
        refRange and numeric bounds, and a VALUE-DERIVED flag (never
        client-claimed). Assumes ValidateLabDocument passed, so every analyte
        resolves. */
    public static List<LabItemFull> BuildDocumentedItems(DocumentLabRequest r, Aurora.Core.MasterData.LabTestRow test)
    {
        var byName = JsonSerializer.Deserialize<List<Aurora.Core.MasterData.AnalyteDefDto>>(test.AnalytesJson, JsonOpts.Web)!
            .ToDictionary(a => a.Analyte);
        return r.Items!.Select(it =>
        {
            var d = byName[it.Analyte!];
            return new LabItemFull(it.Analyte!, it.Value!.Value, d.Unit, d.RefRange, d.RefLow, d.RefHigh,
                FlagForValue(it.Value!.Value, d.RefLow, d.RefHigh));
        }).ToList();
    }

    /** the per-item flag DERIVED from a value against the catalogue reference
        range: in [refLow, refHigh] → normal, otherwise abnormal. The
        catalogue models a SINGLE range per analyte (no separate critical
        threshold), so the manual documentation path grades normal vs abnormal
        only — a "critical" grade would need threshold data the catalogue does
        not carry yet (recorded as a future item). Honest by construction: the
        clinician types the number, the system grades it. */
    public static string FlagForValue(double value, double refLow, double refHigh) =>
        value >= refLow && value <= refHigh ? "normal" : "abnormal";

    public static string? ValidateImagingCreate(CreateImagingRequest r, AuroraDb db)
    {
        if (CheckText("patientId", r.PatientId, required: true) is string p) return p;
        if (!db.AdtPatients.AsNoTracking().Any(x => x.PatientId == r.PatientId))
            return $"patientId '{r.PatientId}' does not match any roster patient";
        if (r.Modality is null || !Modalities.Contains(r.Modality))
            return $"modality must be one of: {string.Join(", ", Modalities)}";
        if (CheckText("description", r.Description, required: true) is string d) return d;
        if (CheckText("report", r.Report, required: true) is string rp) return rp;
        if (CheckText("impression", r.Impression, required: true) is string im) return im;
        if (CheckText("note", r.Note, required: false) is string nt) return nt;
        if (r.Flag is null || !ImagingFlags.Contains(r.Flag))
            return $"flag must be one of: {string.Join(", ", ImagingFlags)} (the reporting clinician grades the finding)";
        return null;
    }

    /** the draw-level flag is DERIVED from the items (critical > abnormal >
        normal) — never client-supplied, so a draw can never understate its
        own worst item */
    public static string DeriveLabFlag(IEnumerable<NewLabItemDto> items) =>
        items.Any(i => i.Flag == "critical") ? "critical"
        : items.Any(i => i.Flag == "abnormal") ? "abnormal" : "normal";

    /** same worst-item rule for the documentation path, over the built items
        (whose flags are catalogue-value-derived — normal/abnormal) */
    public static string DeriveLabFlag(IEnumerable<LabItemFull> items) =>
        items.Any(i => i.Flag == "critical") ? "critical"
        : items.Any(i => i.Flag == "abnormal") ? "abnormal" : "normal";

    public static string AppendEvent(string eventsJson, ResultEventDto evt)
    {
        var events = JsonSerializer.Deserialize<List<ResultEventDto>>(eventsJson, JsonOpts.Web)!;
        events.Add(evt);
        return JsonSerializer.Serialize(events, JsonOpts.Web);
    }

    /** ONE-TIME, IDEMPOTENT boot backfill (results audit PR). Two steps,
        each a no-op on already-migrated data:
        1. Scope EncounterId for every result that has none — the SAME rule
           as the orders backfill: the patient's OPEN encounter if one
           exists, else the MOST RECENT (results existed before results
           carried scope; nothing here is invented).
        2. RESTRUCTURE (not invent) the audit record: a result that is
           Acknowledged but has no "acknowledged" event gets one appended
           FROM ITS OWN STORED AcknowledgedBy/AcknowledgedAt fields — the
           same facts, moved into the append-only history so a later
           reversal can preserve them. Unacknowledged results keep an empty
           history (their acknowledgments will write events live).
        Unlike the orders backfill there is no invariant-restoration step:
        results have no active/pending state to neutralize, and a result on
        a closed encounter is a CORRECT record (completing the record of
        care already given), not a defect. */
    public static (int Scoped, int Restructured) BackfillResultAudit(AuroraDb db)
    {
        var encsByPatient = db.Encounters.AsNoTracking().AsEnumerable()
            .GroupBy(e => e.PatientId)
            .ToDictionary(g => g.Key, g => g.ToList());
        string? ResolveScope(string patientId)
        {
            if (!encsByPatient.TryGetValue(patientId, out var encs) || encs.Count == 0) return null;
            var enc = encs.FirstOrDefault(e => e.Status == "open")
                ?? encs.OrderByDescending(e => e.EncounterId, StringComparer.Ordinal).First();
            return enc.EncounterId;
        }

        var scoped = 0;
        var restructured = 0;
        foreach (var d in db.LabDraws.Where(x => x.EncounterId == "").AsEnumerable())
        {
            if (ResolveScope(d.PatientId) is string eid) { d.EncounterId = eid; scoped++; }
        }
        foreach (var s in db.ImagingStudies.Where(x => x.EncounterId == "").AsEnumerable())
        {
            if (ResolveScope(s.PatientId) is string eid) { s.EncounterId = eid; scoped++; }
        }
        foreach (var d in db.LabDraws.Where(x => x.Acknowledged).AsEnumerable())
        {
            var events = JsonSerializer.Deserialize<List<ResultEventDto>>(d.EventsJson, JsonOpts.Web)!;
            if (events.Any(e => e.Action == "acknowledged")) continue;
            events.Add(new(d.AcknowledgedAt ?? "", d.AcknowledgedBy ?? "Unknown", "acknowledged", null));
            d.EventsJson = JsonSerializer.Serialize(events, JsonOpts.Web);
            restructured++;
        }
        foreach (var s in db.ImagingStudies.Where(x => x.Acknowledged).AsEnumerable())
        {
            var events = JsonSerializer.Deserialize<List<ResultEventDto>>(s.EventsJson, JsonOpts.Web)!;
            if (events.Any(e => e.Action == "acknowledged")) continue;
            events.Add(new(s.AcknowledgedAt ?? "", s.AcknowledgedBy ?? "Unknown", "acknowledged", null));
            s.EventsJson = JsonSerializer.Serialize(events, JsonOpts.Web);
            restructured++;
        }
        db.SaveChanges();
        return (scoped, restructured);
    }
}

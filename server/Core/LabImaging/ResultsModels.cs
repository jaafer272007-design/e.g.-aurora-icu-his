using System.ComponentModel.DataAnnotations;
using System.Text.Json;
using Aurora.Core.Shared;

namespace Aurora.Core.LabImaging;

/* ---------- Laboratory & Imaging results (Stage 10 Phase 3) ----------
   One row per lab draw / imaging study. Scalar fields are real columns;
   the per-draw result items array is a JSON text column (same pattern as
   the roster's nested value objects — portable to SQL Server later).
   Data/labs-seed.json and Data/imaging-seed.json are GENERATED from
   src/lib/api/data/results.ts — never hand-edit them. */

class LabDrawRow
{
    [Key]
    public string LabId { get; set; } = "";
    public string PatientId { get; set; } = "";
    /* lifecycle scope (results audit PR): the encounter the result was
       created under — SERVER-derived from the patient's open encounter,
       never client-supplied. "" only before the boot backfill scopes
       pre-existing rows (same rule as Orders.EncounterId). */
    public string EncounterId { get; set; } = "";
    /* Layer 4 phase 2 (order→result linkage): the lab order this result
       FULFILS — SERVER-derived at creation (the oldest unfulfilled active
       Lab order for the same test on the open encounter), never
       client-supplied. Null when no order matches: walk-in, reflex and
       protocol-added results legitimately exist without an order, and
       every pre-linkage row stays null (a linkage is never invented). */
    public string? OrderId { get; set; }
    public string BedId { get; set; } = "";
    public string PatientName { get; set; } = "";
    public string Panel { get; set; } = "";
    public string Label { get; set; } = "";
    public string CollectedAt { get; set; } = "";
    public string ResultedAt { get; set; } = "";
    public string ItemsJson { get; set; } = "[]";
    public string Flag { get; set; } = "";
    /* Lab Result-Entry design (§5): how this result ENTERED Aurora, so a
       future LIS-fed result is distinguishable from a manually-transcribed
       one — the same source-provenance idea as the observation model.
       "manual" for the human documentation path (results.document); ""
       (absent on the wire) for pre-existing rows and the producing-service
       create path, which predate the field — a source is never invented. */
    public string Source { get; set; } = "";
    /* Custom / Other Lab Test design — an UNSTRUCTURED, UNFLAGGED result for
       a test the catalogue does not have. When Custom is true the row has NO
       catalogue analyte link and NO computed flag (Flag stays ""): the system
       must never fabricate a clinical judgment it cannot justify. The
       free-text value/unit/reference-range live in their own columns (the
       numeric ItemsJson stays "[]") so no numeric consumer misparses them;
       the test NAME is Label and the note is Note. RefRange is DISPLAY-ONLY
       context — it never drives a flag. Absent on the wire for every
       structured result (nullable → WhenWritingNull), so byte-parity holds. */
    public bool Custom { get; set; }
    public string? CustomValue { get; set; }
    public string? CustomUnit { get; set; }
    public string? CustomRefRange { get; set; }
    /* Lab Result Editing design: the PRECISE UTC anchor of the manual
       documentation ("yyyy-MM-dd HH:mm:ss" — the observation EnteredAt
       pattern). Set ONLY by the document / document-custom paths; "" for
       seed rows and the producing-service create path — those carry NO
       bedside correction model (nothing to self-correct) and NO §2a
       acknowledgment gate, which also keeps the deployed suites'
       create→acknowledge flows unchanged. */
    public string DocumentedAt { get; set; } = "";
    /* append-only correction history (Lab Result Editing design) — the
       amend-not-erase record: every correction preserves the previous
       value/note here with actor/tier/time/reason and whether it happened
       AFTER the result was acknowledged (the §2b safeguard fact, stored at
       correction time, never re-derived from timestamp comparison). The
       row's items/CustomValue/Note stay the CURRENT-STATE summary — the
       store's existing convention (Acknowledged* summary + EventsJson
       record), chosen over the observation model's derive-at-read because
       five consumers (trends, inbox, timeline, flag derivation, print)
       read the current items directly. */
    public string AmendmentsJson { get; set; } = "[]";
    public string? Note { get; set; }
    public bool Acknowledged { get; set; }
    public string? AcknowledgedBy { get; set; }
    public string? AcknowledgedAt { get; set; }
    /* append-only audited event history (created / acknowledged /
       unacknowledged) — the never-destroy record. The Acknowledged* fields
       above remain the CURRENT-STATE summary; reversing an acknowledgment
       clears them but the original acknowledgment survives here forever. */
    public string EventsJson { get; set; } = "[]";

    public static LabDrawRow FromDto(LabDrawDto d) => new()
    {
        LabId = d.LabId, PatientId = d.PatientId, EncounterId = d.EncounterId ?? "",
        OrderId = d.OrderId, BedId = d.BedId, PatientName = d.PatientName,
        Panel = d.Panel, Label = d.Label, CollectedAt = d.CollectedAt, ResultedAt = d.ResultedAt,
        ItemsJson = JsonSerializer.Serialize(d.Items, JsonOpts.Web),
        Flag = d.Flag, Source = d.Source ?? "", Note = d.Note, Acknowledged = d.Acknowledged,
        Custom = d.Custom ?? false, CustomValue = d.CustomValue,
        CustomUnit = d.CustomUnit, CustomRefRange = d.CustomRefRange,
        DocumentedAt = d.DocumentedAt ?? "",
        AmendmentsJson = d.Amendments is null ? "[]" : JsonSerializer.Serialize(d.Amendments, JsonOpts.Web),
        AcknowledgedBy = d.AcknowledgedBy, AcknowledgedAt = d.AcknowledgedAt,
        EventsJson = d.History is null ? "[]" : JsonSerializer.Serialize(d.History, JsonOpts.Web),
    };

    public LabDrawDto ToDto()
    {
        var events = JsonSerializer.Deserialize<List<ResultEventDto>>(EventsJson, JsonOpts.Web)!;
        var amendments = JsonSerializer.Deserialize<List<LabAmendmentDto>>(AmendmentsJson, JsonOpts.Web)!;
        return new(
            LabId, PatientId, EncounterId == "" ? null : EncounterId, BedId, PatientName,
            Panel, Label, CollectedAt, ResultedAt,
            JsonSerializer.Deserialize<JsonElement>(ItemsJson, JsonOpts.Web),
            Flag, Note, Acknowledged, AcknowledgedBy, AcknowledgedAt,
            events.Count == 0 ? null : events, OrderId, Source == "" ? null : Source,
            Custom ? true : null, CustomValue, CustomUnit, CustomRefRange,
            DocumentedAt == "" ? null : DocumentedAt,
            amendments.Count == 0 ? null : amendments);
    }
}

class ImagingStudyRow
{
    [Key]
    public string StudyId { get; set; } = "";
    public string PatientId { get; set; } = "";
    /* see LabDrawRow.EncounterId — same rule */
    public string EncounterId { get; set; } = "";
    public string BedId { get; set; } = "";
    public string PatientName { get; set; } = "";
    public string Modality { get; set; } = "";
    public string Description { get; set; } = "";
    public string OrderedAt { get; set; } = "";
    public string? PerformedAt { get; set; }
    public string? ReportedAt { get; set; }
    public string Status { get; set; } = "";
    public string? Report { get; set; }
    public string? Impression { get; set; }
    public string Flag { get; set; } = "";
    public string? Note { get; set; }
    public bool Acknowledged { get; set; }
    public string? AcknowledgedBy { get; set; }
    public string? AcknowledgedAt { get; set; }
    /* see LabDrawRow.EventsJson — same never-destroy audit record */
    public string EventsJson { get; set; } = "[]";

    public static ImagingStudyRow FromDto(ImagingStudyDto d) => new()
    {
        StudyId = d.StudyId, PatientId = d.PatientId, EncounterId = d.EncounterId ?? "",
        BedId = d.BedId, PatientName = d.PatientName,
        Modality = d.Modality, Description = d.Description, OrderedAt = d.OrderedAt,
        PerformedAt = d.PerformedAt, ReportedAt = d.ReportedAt, Status = d.Status,
        Report = d.Report, Impression = d.Impression, Flag = d.Flag, Note = d.Note,
        Acknowledged = d.Acknowledged, AcknowledgedBy = d.AcknowledgedBy, AcknowledgedAt = d.AcknowledgedAt,
        EventsJson = d.History is null ? "[]" : JsonSerializer.Serialize(d.History, JsonOpts.Web),
    };

    public ImagingStudyDto ToDto()
    {
        var events = JsonSerializer.Deserialize<List<ResultEventDto>>(EventsJson, JsonOpts.Web)!;
        return new(
            StudyId, PatientId, EncounterId == "" ? null : EncounterId, BedId, PatientName,
            Modality, Description, OrderedAt,
            PerformedAt, ReportedAt, Status, Report, Impression, Flag, Note,
            Acknowledged, AcknowledgedBy, AcknowledgedAt,
            events.Count == 0 ? null : events);
    }
}

/* wire contracts — mirror LabDraw / ImagingStudy / ResultInboxItem in
   src/lib/api/types.ts (camelCase over the wire; optional fields absent,
   not null — see JsonOpts). Items pass through as-is (JsonElement). */
record LabDrawDto(
    string LabId, string PatientId, string? EncounterId, string BedId, string PatientName, string Panel,
    string Label, string CollectedAt, string ResultedAt, JsonElement Items, string Flag,
    string? Note, bool Acknowledged, string? AcknowledgedBy, string? AcknowledgedAt,
    List<ResultEventDto>? History, string? OrderId = null, string? Source = null,
    bool? Custom = null, string? CustomValue = null, string? CustomUnit = null, string? CustomRefRange = null,
    string? DocumentedAt = null, List<LabAmendmentDto>? Amendments = null);

/* one correction on a documented lab result (Lab Result Editing design) —
   mirrors the observation AmendmentDto plus the lab-specific facts: WHICH
   field was corrected (an analyte name, "value" for a custom result's
   free-text value, or "note") and whether the correction happened AFTER the
   result was acknowledged (§2b — stored at correction time so the
   acknowledged-then-edited ordering is an immutable fact, never a
   re-derivation). Tier is implied by AmenderRole + Reason ("" on Tier-1). */
record LabAmendmentDto(
    string Target, string PreviousValue, string NewValue, string AmendedBy,
    string AmendedAt, string Reason, string AmenderRole, bool AfterAcknowledgment);

record ImagingStudyDto(
    string StudyId, string PatientId, string? EncounterId, string BedId, string PatientName, string Modality,
    string Description, string OrderedAt, string? PerformedAt, string? ReportedAt,
    string Status, string? Report, string? Impression, string Flag, string? Note,
    bool Acknowledged, string? AcknowledgedBy, string? AcknowledgedAt,
    List<ResultEventDto>? History);

/* append-only result audit event — mirrors OrderEventDto's shape */
record ResultEventDto(string Time, string Actor, string Action, string? Detail);

/* parse shape for deriving the inbox headline from ItemsJson */
record LabItemDto(string Analyte, double Value, string Unit, string Flag);

record InboxItemDto(
    string Kind, string Id, string PatientId, string BedId, string PatientName,
    string Title, string Detail, string Time, string Flag,
    /* Lab Result Editing §2a: the documentation anchor, present ONLY for
       manually documented lab results — lets the inbox show that a result
       inside its 5-minute self-correction window is not yet acknowledgeable
       (the server enforces the gate regardless). Absent (null) for imaging,
       seed rows and producing-service results — byte-parity preserved. */
    string? DocumentedAt = null);

/* full lab item shape for the timeline's abnormal-summary derivation.
   CritLow/CritHigh (Option B): the CRITICAL thresholds SNAPSHOTTED from the
   catalogue definition at documentation time — the same snapshot rule as
   refRange/refLow/refHigh (a result is a historical record graded against
   the definition in force when it resulted), and what lets the #80
   correction re-derive a corrected value's flag INCLUDING critical without
   consulting a definition that may have changed since. Nullable → absent on
   the wire for every pre-Option-B result (byte-parity). */
record LabItemFull(string Analyte, double Value, string Unit, string RefRange,
    double RefLow, double RefHigh, string Flag,
    double? CritLow = null, double? CritHigh = null);

/* ---------- REQUEST DTOs (results audit PR) ----------
   All carry [JsonUnmappedMemberHandling(Disallow)] per the codified
   validation rule: an unrecognized field fails binding → automatic 400.
   Deliberately ABSENT from every request shape: encounterId (server-derived
   from the patient's open encounter, exactly as orders — a client must
   never choose the episode a result attaches to), bedId/patientName
   (display snapshots resolved from Core ADT), flag on labs (derived from
   the items), and acknowledged/actor/time fields (server state + token). */

[System.Text.Json.Serialization.JsonUnmappedMemberHandling(System.Text.Json.Serialization.JsonUnmappedMemberHandling.Disallow)]
record NewLabItemDto(
    string? Analyte, double? Value, string? Unit, string? RefRange,
    double? RefLow, double? RefHigh, string? Flag);

[System.Text.Json.Serialization.JsonUnmappedMemberHandling(System.Text.Json.Serialization.JsonUnmappedMemberHandling.Disallow)]
record CreateLabRequest(
    string? PatientId, string? Panel, string? Label, string? Note, List<NewLabItemDto>? Items);

/* ---------- DOCUMENTATION REQUEST DTOs (Lab Result-Entry design) ----------
   The MANUAL documentation path (results.document) is LEANER than the
   producing-service create above: the client sends only patientId, the
   catalogue panel, and per-analyte {analyte, value}. Everything else is
   CATALOGUE-DERIVED server-side (§9): unit, refRange, refLow/refHigh come
   from the lab catalogue's analyte definition, and the per-item flag is
   derived from the value against that reference range — the client cannot
   claim any of them. Label (the catalogue test's Name), source=manual, the
   documenting clinician, encounter scope, order linkage, and timestamps are
   all server-owned, exactly as they are for create. */
[System.Text.Json.Serialization.JsonUnmappedMemberHandling(System.Text.Json.Serialization.JsonUnmappedMemberHandling.Disallow)]
record DocumentLabItemDto(string? Analyte, double? Value);

[System.Text.Json.Serialization.JsonUnmappedMemberHandling(System.Text.Json.Serialization.JsonUnmappedMemberHandling.Disallow)]
record DocumentLabRequest(
    string? PatientId, string? Panel, string? Note, List<DocumentLabItemDto>? Items);

/* ---------- CUSTOM / OTHER DOCUMENTATION REQUEST (Custom Lab Test design) ----------
   The UNSTRUCTURED escape hatch for a test the catalogue does not have.
   Free-text testName + value (both REQUIRED), optional unit / reference
   range / note. The value is FREE TEXT (numeric like "2.5" OR descriptive
   like "positive") — never parsed as a number. RefRange is DISPLAY-ONLY: it
   is NOT validated as bounds and NEVER drives a flag (the safety choice — a
   hand-typed range must not produce an authoritative-looking auto-flag). As
   with the structured path, provenance (clinician + time), source=manual and
   the encounter are all server-owned; a payload claiming them fails binding. */
[System.Text.Json.Serialization.JsonUnmappedMemberHandling(System.Text.Json.Serialization.JsonUnmappedMemberHandling.Disallow)]
record DocumentCustomLabRequest(
    string? PatientId, string? TestName, string? Value, string? Unit, string? RefRange, string? Note);

/* ---------- CORRECTION REQUEST (Lab Result Editing design) ----------
   Corrects a DOCUMENTED lab result's value and/or note. For a STRUCTURED
   result, Analyte names the item and Value must be a JSON number (the
   corrected value re-derives that item's flag and the draw's flag). For a
   CUSTOM result, Analyte is absent and Value is a JSON string (free text —
   custom results stay unflagged). Note corrects the draw note (either
   kind). Reason is REQUIRED on Tier-2 (Consultant-tier — outside the
   5-minute window or on another clinician's entry), optional on Tier-1;
   the SERVER decides the tier. Everything else about the result is
   immutable here — a payload with any other field fails binding. */
[System.Text.Json.Serialization.JsonUnmappedMemberHandling(System.Text.Json.Serialization.JsonUnmappedMemberHandling.Disallow)]
record CorrectLabRequest(string? Analyte, JsonElement? Value, string? Note, string? Reason);

[System.Text.Json.Serialization.JsonUnmappedMemberHandling(System.Text.Json.Serialization.JsonUnmappedMemberHandling.Disallow)]
record CreateImagingRequest(
    string? PatientId, string? Modality, string? Description,
    string? Report, string? Impression, string? Flag, string? Note);

/* reversing an acknowledgment requires a documented reason — the same
   acknowledged-override discipline as MAR held/refused and discontinue */
[System.Text.Json.Serialization.JsonUnmappedMemberHandling(System.Text.Json.Serialization.JsonUnmappedMemberHandling.Disallow)]
record UnacknowledgeRequest(string? Reason);

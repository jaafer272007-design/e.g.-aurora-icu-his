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
        Flag = d.Flag, Note = d.Note, Acknowledged = d.Acknowledged,
        AcknowledgedBy = d.AcknowledgedBy, AcknowledgedAt = d.AcknowledgedAt,
        EventsJson = d.History is null ? "[]" : JsonSerializer.Serialize(d.History, JsonOpts.Web),
    };

    public LabDrawDto ToDto()
    {
        var events = JsonSerializer.Deserialize<List<ResultEventDto>>(EventsJson, JsonOpts.Web)!;
        return new(
            LabId, PatientId, EncounterId == "" ? null : EncounterId, BedId, PatientName,
            Panel, Label, CollectedAt, ResultedAt,
            JsonSerializer.Deserialize<JsonElement>(ItemsJson, JsonOpts.Web),
            Flag, Note, Acknowledged, AcknowledgedBy, AcknowledgedAt,
            events.Count == 0 ? null : events, OrderId);
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
    List<ResultEventDto>? History, string? OrderId = null);

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
    string Title, string Detail, string Time, string Flag);

/* full lab item shape for the timeline's abnormal-summary derivation */
record LabItemFull(string Analyte, double Value, string Unit, string RefRange,
    double RefLow, double RefHigh, string Flag);

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

[System.Text.Json.Serialization.JsonUnmappedMemberHandling(System.Text.Json.Serialization.JsonUnmappedMemberHandling.Disallow)]
record CreateImagingRequest(
    string? PatientId, string? Modality, string? Description,
    string? Report, string? Impression, string? Flag, string? Note);

/* reversing an acknowledgment requires a documented reason — the same
   acknowledged-override discipline as MAR held/refused and discontinue */
[System.Text.Json.Serialization.JsonUnmappedMemberHandling(System.Text.Json.Serialization.JsonUnmappedMemberHandling.Disallow)]
record UnacknowledgeRequest(string? Reason);

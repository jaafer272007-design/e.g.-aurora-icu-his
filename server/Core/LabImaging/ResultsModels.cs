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

    public static LabDrawRow FromDto(LabDrawDto d) => new()
    {
        LabId = d.LabId, PatientId = d.PatientId, BedId = d.BedId, PatientName = d.PatientName,
        Panel = d.Panel, Label = d.Label, CollectedAt = d.CollectedAt, ResultedAt = d.ResultedAt,
        ItemsJson = JsonSerializer.Serialize(d.Items, JsonOpts.Web),
        Flag = d.Flag, Note = d.Note, Acknowledged = d.Acknowledged,
        AcknowledgedBy = d.AcknowledgedBy, AcknowledgedAt = d.AcknowledgedAt,
    };

    public LabDrawDto ToDto() => new(
        LabId, PatientId, BedId, PatientName, Panel, Label, CollectedAt, ResultedAt,
        JsonSerializer.Deserialize<JsonElement>(ItemsJson, JsonOpts.Web),
        Flag, Note, Acknowledged, AcknowledgedBy, AcknowledgedAt);
}

class ImagingStudyRow
{
    [Key]
    public string StudyId { get; set; } = "";
    public string PatientId { get; set; } = "";
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

    public static ImagingStudyRow FromDto(ImagingStudyDto d) => new()
    {
        StudyId = d.StudyId, PatientId = d.PatientId, BedId = d.BedId, PatientName = d.PatientName,
        Modality = d.Modality, Description = d.Description, OrderedAt = d.OrderedAt,
        PerformedAt = d.PerformedAt, ReportedAt = d.ReportedAt, Status = d.Status,
        Report = d.Report, Impression = d.Impression, Flag = d.Flag, Note = d.Note,
        Acknowledged = d.Acknowledged, AcknowledgedBy = d.AcknowledgedBy, AcknowledgedAt = d.AcknowledgedAt,
    };

    public ImagingStudyDto ToDto() => new(
        StudyId, PatientId, BedId, PatientName, Modality, Description, OrderedAt,
        PerformedAt, ReportedAt, Status, Report, Impression, Flag, Note,
        Acknowledged, AcknowledgedBy, AcknowledgedAt);
}

/* wire contracts — mirror LabDraw / ImagingStudy / ResultInboxItem in
   src/lib/api/types.ts (camelCase over the wire; optional fields absent,
   not null — see JsonOpts). Items pass through as-is (JsonElement). */
record LabDrawDto(
    string LabId, string PatientId, string BedId, string PatientName, string Panel,
    string Label, string CollectedAt, string ResultedAt, JsonElement Items, string Flag,
    string? Note, bool Acknowledged, string? AcknowledgedBy, string? AcknowledgedAt);

record ImagingStudyDto(
    string StudyId, string PatientId, string BedId, string PatientName, string Modality,
    string Description, string OrderedAt, string? PerformedAt, string? ReportedAt,
    string Status, string? Report, string? Impression, string Flag, string? Note,
    bool Acknowledged, string? AcknowledgedBy, string? AcknowledgedAt);

/* parse shape for deriving the inbox headline from ItemsJson */
record LabItemDto(string Analyte, double Value, string Unit, string Flag);

record InboxItemDto(
    string Kind, string Id, string PatientId, string BedId, string PatientName,
    string Title, string Detail, string Time, string Flag);

/* full lab item shape for the timeline's abnormal-summary derivation */
record LabItemFull(string Analyte, double Value, string Unit, string RefRange,
    double RefLow, double RefHigh, string Flag);

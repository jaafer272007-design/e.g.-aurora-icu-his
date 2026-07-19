using System.ComponentModel.DataAnnotations;
using System.Text.Json;
using Aurora.Core.Shared;

namespace Aurora.Core.Orders;

/* ---------- Orders & Medication (Stage 10 Phase 3, Orders PR) ----------
   One row per order; medication/administrations/history are JSON columns
   the lifecycle mutations rewrite. Seq preserves insertion order (seed
   order, then append — same as the mock store). Data/orders-seed.json is
   GENERATED from src/lib/api/data/orders.ts — never hand-edit it. */

class OrderRow
{
    [Key]
    public string OrderId { get; set; } = "";
    public int Seq { get; set; }
    public string PatientId { get; set; } = "";
    /* ENCOUNTER SCOPE (the ORD-113 fix): an order's lifecycle is bounded
       by its encounter — patientId stays for person-level identity and
       the longitudinal chart; encounterId carries the lifecycle. "" only
       before the boot-time backfill resolves it (seeds carry none). */
    public string EncounterId { get; set; } = "";
    public string BedId { get; set; } = "";
    public string PatientName { get; set; } = "";
    public string Category { get; set; } = "";
    public string Summary { get; set; } = "";
    public string? MedicationJson { get; set; }
    /* Layer 4 (lab catalogue): the catalogue test a Lab order references —
       the order half of the order→result linkage. Null on non-Lab orders,
       free-text lab orders, and every pre-catalogue row. */
    public string? TestId { get; set; }
    /* Imaging Catalogue: the catalogue study an Imaging order references
       — the ORDER half of the order→report linkage (#105 built the
       report half: ImagingStudyRow.OrderId). Summary carries the study
       NAME at order time (snapshot-at-use — historical orders never
       re-resolve the live catalogue). Null on non-Imaging orders,
       free-text imaging orders, and every pre-catalogue row. */
    public string? StudyId { get; set; }
    public string Priority { get; set; } = "";
    public string Status { get; set; } = "";
    public string OrderedBy { get; set; } = "";
    public string OrderedTime { get; set; } = "";
    public bool? RequiresImplementation { get; set; }
    public string? AdministrationsJson { get; set; }
    public string HistoryJson { get; set; } = "[]";
    public string? StatusReason { get; set; }

    public static OrderRow FromDto(OrderDto d, int seq) => new()
    {
        OrderId = d.OrderId, Seq = seq, PatientId = d.PatientId,
        EncounterId = d.EncounterId ?? "", BedId = d.BedId,
        PatientName = d.PatientName, Category = d.Category, Summary = d.Summary,
        MedicationJson = d.Medication is null ? null : JsonSerializer.Serialize(d.Medication, JsonOpts.Web),
        TestId = d.TestId, StudyId = d.StudyId,
        Priority = d.Priority, Status = d.Status, OrderedBy = d.OrderedBy, OrderedTime = d.OrderedTime,
        RequiresImplementation = d.RequiresImplementation,
        AdministrationsJson = d.Administrations is null ? null : JsonSerializer.Serialize(d.Administrations, JsonOpts.Web),
        HistoryJson = JsonSerializer.Serialize(d.History, JsonOpts.Web),
        StatusReason = d.StatusReason,
    };

    public OrderDto ToDto() => new(
        OrderId, PatientId, EncounterId, BedId, PatientName, Category, Summary,
        MedicationJson is null ? null : JsonSerializer.Deserialize<MedicationDto>(MedicationJson, JsonOpts.Web),
        Priority, Status, OrderedBy, OrderedTime, RequiresImplementation,
        AdministrationsJson is null ? null : JsonSerializer.Deserialize<List<AdminDto>>(AdministrationsJson, JsonOpts.Web),
        JsonSerializer.Deserialize<List<OrderEventDto>>(HistoryJson, JsonOpts.Web)!,
        StatusReason, TestId, StudyId);
}

/* wire contracts — mirror Order / MedicationDetails / MedAdministration /
   OrderEvent / NewOrderDraft in src/lib/api/types.ts */
record OrderDto(
    string OrderId, string PatientId, string? EncounterId, string BedId, string PatientName, string Category,
    string Summary, MedicationDto? Medication, string Priority, string Status,
    string OrderedBy, string OrderedTime, bool? RequiresImplementation,
    List<AdminDto>? Administrations, List<OrderEventDto> History, string? StatusReason,
    string? TestId = null, string? StudyId = null);

/* nested in create requests as well as responses/seeds — Disallow makes a
   typo'd medication field (e.g. "dosage") a 400 at binding time; the seed
   files carry exactly these fields (byte-parity verified) so boot-time
   deserialization is unaffected */
[System.Text.Json.Serialization.JsonUnmappedMemberHandling(System.Text.Json.Serialization.JsonUnmappedMemberHandling.Disallow)]
record MedicationDto(
    string DrugId, string Drug, string Dose, string Route, string Frequency,
    string Duration, bool Prn, string? PrnIndication,
    /* STRUCTURED INFUSION ORDERING (the clinical validator's design):
       ADDITIVE tail — an infusion order carries its dose STRUCTURED
       (numeric value + mass unit + time basis; the weight basis is
       always per kg by design) instead of only free text. Lives inside
       MedicationJson (data, not schema — NO migration); null on every
       non-infusion order and every pre-feature row, and WhenWritingNull
       keeps those wire bytes unchanged. The free-text Dose field remains
       the DISPLAY string and is COMPOSED from this entry server-side
       (single source — the two can never desync). Normalisation to
       µg/kg/min is DERIVED at read (client/scoring), never stored —
       the entry stays faithful to what the physician ordered. */
    InfusionDoseDto? Infusion = null);

/* the structured infusion dose: e.g. {value:0.3, massUnit:"mcg",
   timeBasis:"min"} = 0.3 µg/kg/min; {value:2, massUnit:"mg",
   timeBasis:"hour"} = 2 mg/kg/hour. massUnit is ASCII "mcg"|"mg" on the
   wire (rendered µg/mg); timeBasis "min"|"hour". Per-kg is implicit —
   the design fixes the weight basis (rates use the encounter weight,
   which the CLIENT resolves for display; the µg/kg/min value itself is
   weight-relative so nothing is fabricated when weight is absent). */
[System.Text.Json.Serialization.JsonUnmappedMemberHandling(System.Text.Json.Serialization.JsonUnmappedMemberHandling.Disallow)]
record InfusionDoseDto(double Value, string MassUnit, string TimeBasis);

record AdminDto(string AdminId, string ScheduledTime, string Status,
    string? DocumentedTime, string? DocumentedBy, string? Reason = null);

record OrderEventDto(string Time, string Actor, string Action, string? Detail);

/* REQUEST DTOs — unlike the response/seed DTOs above, these carry
   [JsonUnmappedMemberHandling(Disallow)]: an unrecognized field in a
   mutation payload fails JSON binding, which minimal APIs surface as an
   automatic 400 — a typo'd contract can never silently no-op. Fields
   arrive nullable and are validated explicitly (OrderLogic.ValidateDraft)
   so a missing field is a 400, never a null-crash or a silent default. */

[System.Text.Json.Serialization.JsonUnmappedMemberHandling(System.Text.Json.Serialization.JsonUnmappedMemberHandling.Disallow)]
record NewOrderDraftDto(
    string? PatientId, string? Category, string? Summary, MedicationDto? Medication,
    string? Priority, bool? RequiresImplementation, string? TestId = null, string? StudyId = null);

/* overrideJustification (safety enforcement): the audited acknowledgment
   that lets WARN-level safety findings (cross-reactivity, warn-severity
   interactions, duplicate therapy) proceed — required when any exist,
   recorded on each affected order's history. HARD blocks ignore it. */
[System.Text.Json.Serialization.JsonUnmappedMemberHandling(System.Text.Json.Serialization.JsonUnmappedMemberHandling.Disallow)]
record CreateOrdersRequest(List<NewOrderDraftDto>? Drafts, bool Sign, string? Note, string? OverrideJustification = null);

/* partial medication update — only provided fields are applied */
[System.Text.Json.Serialization.JsonUnmappedMemberHandling(System.Text.Json.Serialization.JsonUnmappedMemberHandling.Disallow)]
record MedicationChanges(
    string? DrugId, string? Drug, string? Dose, string? Route, string? Frequency,
    string? Duration, bool? Prn, string? PrnIndication,
    /* structured-infusion change: when provided, the display Dose is
       COMPOSED from it (a client-supplied dose on an infusion change is
       rejected on mismatch; a dose-only change on an order that carries a
       structured entry is rejected outright — the two can never desync) */
    InfusionDoseDto? Infusion = null)
{
    public bool HasAnyField =>
        DrugId is not null || Drug is not null || Dose is not null || Route is not null
        || Frequency is not null || Duration is not null || Prn is not null || PrnIndication is not null
        || Infusion is not null;
}

[System.Text.Json.Serialization.JsonUnmappedMemberHandling(System.Text.Json.Serialization.JsonUnmappedMemberHandling.Disallow)]
record ModifyOrderRequest(MedicationChanges? Changes, string? Reason);

[System.Text.Json.Serialization.JsonUnmappedMemberHandling(System.Text.Json.Serialization.JsonUnmappedMemberHandling.Disallow)]
record DiscontinueRequest(string? Reason);

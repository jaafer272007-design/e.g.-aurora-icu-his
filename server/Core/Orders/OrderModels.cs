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
        StatusReason);
}

/* wire contracts — mirror Order / MedicationDetails / MedAdministration /
   OrderEvent / NewOrderDraft in src/lib/api/types.ts */
record OrderDto(
    string OrderId, string PatientId, string? EncounterId, string BedId, string PatientName, string Category,
    string Summary, MedicationDto? Medication, string Priority, string Status,
    string OrderedBy, string OrderedTime, bool? RequiresImplementation,
    List<AdminDto>? Administrations, List<OrderEventDto> History, string? StatusReason);

/* nested in create requests as well as responses/seeds — Disallow makes a
   typo'd medication field (e.g. "dosage") a 400 at binding time; the seed
   files carry exactly these fields (byte-parity verified) so boot-time
   deserialization is unaffected */
[System.Text.Json.Serialization.JsonUnmappedMemberHandling(System.Text.Json.Serialization.JsonUnmappedMemberHandling.Disallow)]
record MedicationDto(
    string DrugId, string Drug, string Dose, string Route, string Frequency,
    string Duration, bool Prn, string? PrnIndication);

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
    string? Priority, bool? RequiresImplementation);

[System.Text.Json.Serialization.JsonUnmappedMemberHandling(System.Text.Json.Serialization.JsonUnmappedMemberHandling.Disallow)]
record CreateOrdersRequest(List<NewOrderDraftDto>? Drafts, bool Sign, string? Note);

/* partial medication update — only provided fields are applied */
[System.Text.Json.Serialization.JsonUnmappedMemberHandling(System.Text.Json.Serialization.JsonUnmappedMemberHandling.Disallow)]
record MedicationChanges(
    string? DrugId, string? Drug, string? Dose, string? Route, string? Frequency,
    string? Duration, bool? Prn, string? PrnIndication)
{
    public bool HasAnyField =>
        DrugId is not null || Drug is not null || Dose is not null || Route is not null
        || Frequency is not null || Duration is not null || Prn is not null || PrnIndication is not null;
}

[System.Text.Json.Serialization.JsonUnmappedMemberHandling(System.Text.Json.Serialization.JsonUnmappedMemberHandling.Disallow)]
record ModifyOrderRequest(MedicationChanges? Changes, string? Reason);

[System.Text.Json.Serialization.JsonUnmappedMemberHandling(System.Text.Json.Serialization.JsonUnmappedMemberHandling.Disallow)]
record DiscontinueRequest(string? Reason);

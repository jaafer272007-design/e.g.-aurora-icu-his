using System.ComponentModel.DataAnnotations;
using System.Text.Json;
using Aurora.Core.Orders;
using Aurora.Core.Shared;

namespace Aurora.Core.MasterData;

/* ---------- Master Data — Order Sets (Layer 4 phase 2) ----------
   A named bundle of orders a clinician applies at once, as maintained
   reference data referencing the formulary (drug items) and the lab
   catalogue (lab items). Applying a set composes drafts and runs them
   through the EXISTING order-creation path — every invariant (open
   encounter 409, RBAC, validation, inactive-drug/test 409) applies
   unchanged; a set is a convenience layer, never a bypass.
   Data/ordersets-seed.json is GENERATED from the ORDER_SET_DEFS in
   src/lib/api/data/formulary.ts — never hand-edit. */

class OrderSetRow
{
    [Key]
    public string SetId { get; set; } = "";
    public int Seq { get; set; }
    public string Name { get; set; } = "";
    public string Description { get; set; } = "";
    public string ItemsJson { get; set; } = "[]";
    public bool Active { get; set; } = true;
    public string EventsJson { get; set; } = "[]";

    public static OrderSetRow FromDto(OrderSetDto d, int seq) => new()
    {
        SetId = d.SetId, Seq = seq, Name = d.Name, Description = d.Description,
        ItemsJson = JsonSerializer.Serialize(d.Items, JsonOpts.Web),
        Active = d.Active ?? true,
        EventsJson = d.History is null ? "[]" : JsonSerializer.Serialize(d.History, JsonOpts.Web),
    };

    public OrderSetDto ToDto() => new(
        SetId, Name, Description,
        JsonSerializer.Deserialize<List<OrderSetItemDto>>(ItemsJson, JsonOpts.Web)!,
        Active,
        JsonSerializer.Deserialize<List<FormularyEventDto>>(EventsJson, JsonOpts.Web)!);
}

/* wire contracts — mirror OrderSetDef / OrderSetItemTemplate in
   src/lib/api/types.ts. The item's medication reuses the orders domain's
   MedicationDto so a set item and an order draft can never drift. */
record OrderSetDto(
    string SetId, string Name, string Description, List<OrderSetItemDto> Items,
    bool? Active = null, List<FormularyEventDto>? History = null);

record OrderSetItemDto(
    string Category, string? Summary, MedicationDto? Medication, string? TestId,
    string Priority, bool? RequiresImplementation);

/* REQUEST DTOs — unknown fields fail binding (codified validation rule) */
[System.Text.Json.Serialization.JsonUnmappedMemberHandling(System.Text.Json.Serialization.JsonUnmappedMemberHandling.Disallow)]
record OrderSetItemRequest(
    string? Category, string? Summary, MedicationDto? Medication, string? TestId,
    string? Priority, bool? RequiresImplementation);

[System.Text.Json.Serialization.JsonUnmappedMemberHandling(System.Text.Json.Serialization.JsonUnmappedMemberHandling.Disallow)]
record CreateOrderSetRequest(
    string? SetId, string? Name, string? Description, List<OrderSetItemRequest>? Items);

[System.Text.Json.Serialization.JsonUnmappedMemberHandling(System.Text.Json.Serialization.JsonUnmappedMemberHandling.Disallow)]
record EditOrderSetRequest(string? Name, string? Description, List<OrderSetItemRequest>? Items)
{
    public bool HasAnyField => Name is not null || Description is not null || Items is not null;
}

/** POST /api/icu/order-sets/{setId}/apply — clinician authority (the
    order-creation permissions), never the set-management permission */
[System.Text.Json.Serialization.JsonUnmappedMemberHandling(System.Text.Json.Serialization.JsonUnmappedMemberHandling.Disallow)]
record ApplyOrderSetRequest(string? PatientId, bool Sign, string? Note);

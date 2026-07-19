using System.ComponentModel.DataAnnotations;
using System.Text.Json;
using Aurora.Core.Shared;

namespace Aurora.Core.MasterData;

/* ---------- Master Data — Formulary (Layer 4, Aurora Core) ----------
   The REFERENCE layer — the third kind of data, distinct from
   transactional (orders, results) and entity (patients, encounters,
   users): the drug formulary Pharmacy maintains. One row per drug;
   list-valued fields are JSON columns (the roster/orders pattern). Seq
   preserves the mock store's authoring order. DrugId is a natural key —
   no generated-id counters to resume. Data/formulary-seed.json,
   frequencies-seed.json and interactions-seed.json are GENERATED from
   src/lib/api/data/formulary.ts — never hand-edit them.

   REMOVING A DRUG IS A STATUS CHANGE, NEVER A DELETE (the Layer 3
   deactivation rule): a drug that has ever been prescribed must remain
   resolvable forever or historical orders become unreadable. An inactive
   drug cannot be selected for a NEW order (409 at order create/modify);
   every existing order referencing it still renders. */

class FormularyDrugRow
{
    [Key]
    public string DrugId { get; set; } = "";
    public int Seq { get; set; }
    public string Name { get; set; } = "";
    public string BrandNamesJson { get; set; } = "[]";
    public string DrugClass { get; set; } = "";
    public string Form { get; set; } = "";
    public string StrengthsJson { get; set; } = "[]";
    public string DosesJson { get; set; } = "[]";
    public string DefaultDose { get; set; } = "";
    public string? DoseLimitsJson { get; set; }
    public string RoutesJson { get; set; } = "[]";
    public string FrequenciesJson { get; set; } = "[]";
    public bool PrnCapable { get; set; }
    public string AllergyBlockJson { get; set; } = "[]";
    public string AllergyWarnJson { get; set; } = "[]";
    public bool Active { get; set; } = true;
    /** append-only audit history (Layer 3 users convention — dated UTC
        event times; reference-data changes span months) */
    public string EventsJson { get; set; } = "[]";

    public static FormularyDrugRow FromDto(FormularyDrugDto d, int seq) => new()
    {
        DrugId = d.DrugId, Seq = seq, Name = d.Name,
        BrandNamesJson = JsonSerializer.Serialize(d.BrandNames, JsonOpts.Web),
        DrugClass = d.DrugClass, Form = d.Form,
        StrengthsJson = JsonSerializer.Serialize(d.Strengths, JsonOpts.Web),
        DosesJson = JsonSerializer.Serialize(d.Doses, JsonOpts.Web),
        DefaultDose = d.DefaultDose,
        DoseLimitsJson = d.DoseLimits is null ? null : JsonSerializer.Serialize(d.DoseLimits, JsonOpts.Web),
        RoutesJson = JsonSerializer.Serialize(d.Routes, JsonOpts.Web),
        FrequenciesJson = JsonSerializer.Serialize(d.Frequencies, JsonOpts.Web),
        PrnCapable = d.PrnCapable,
        AllergyBlockJson = JsonSerializer.Serialize(d.AllergyBlock, JsonOpts.Web),
        AllergyWarnJson = JsonSerializer.Serialize(d.AllergyWarn, JsonOpts.Web),
        Active = d.Active ?? true,
        EventsJson = d.History is null ? "[]" : JsonSerializer.Serialize(d.History, JsonOpts.Web),
    };

    public FormularyDrugDto ToDto() => new(
        DrugId, Name,
        JsonSerializer.Deserialize<List<string>>(BrandNamesJson, JsonOpts.Web)!,
        DrugClass, Form,
        JsonSerializer.Deserialize<List<string>>(StrengthsJson, JsonOpts.Web)!,
        JsonSerializer.Deserialize<List<string>>(DosesJson, JsonOpts.Web)!,
        DefaultDose,
        DoseLimitsJson is null ? null : JsonSerializer.Deserialize<DoseLimitsDto>(DoseLimitsJson, JsonOpts.Web),
        JsonSerializer.Deserialize<List<string>>(RoutesJson, JsonOpts.Web)!,
        JsonSerializer.Deserialize<List<string>>(FrequenciesJson, JsonOpts.Web)!,
        PrnCapable,
        JsonSerializer.Deserialize<List<string>>(AllergyBlockJson, JsonOpts.Web)!,
        JsonSerializer.Deserialize<List<string>>(AllergyWarnJson, JsonOpts.Web)!,
        Active,
        JsonSerializer.Deserialize<List<FormularyEventDto>>(EventsJson, JsonOpts.Web)!);
}

/** the NAMED medication-frequency vocabulary (moved here from
    OrderLogic's hardcoded array — "per CRRT protocol" was ICU-specific
    content sitting in Core/Orders). Order validation reads THIS table:
    a valid frequency is a named value ∪ q<1-48>h, byte-identical to the
    pre-Layer-4 behavior.
    MANAGED since the Configuration Vocabularies build (design §4):
    Active + append-only audit on the catalogue pattern — a hospital
    adds/retires NAMED values (the q<n>h structured pattern stays code).
    A retired value keeps rendering on every order that stored it;
    NEW orders and NEW per-drug lists are refused it (409/400). */
class NamedFrequencyRow
{
    [Key]
    public string Value { get; set; } = "";
    public int Seq { get; set; }
    public bool Active { get; set; } = true;
    public string EventsJson { get; set; } = "[]";
}

/** pairwise drug-interaction rules (symmetric — checked both directions).
    Served read-only this PR: the client-side safety checks (safety.ts)
    keep consuming them; moving the checks server-side is recorded scope. */
class InteractionRuleRow
{
    [Key]
    public int Id { get; set; }
    public string A { get; set; } = "";
    public string B { get; set; } = "";
    public string Severity { get; set; } = "";
    public string Note { get; set; } = "";

    public InteractionRuleDto ToDto() => new(A, B, Severity, Note);
}

/* wire contracts — mirror FormularyDrug / DoseLimits / FormularyEvent /
   InteractionRule in src/lib/api/types.ts. Active/History are nullable
   ONLY for seed tolerance (FromDto defaults) — the wire always carries
   both. */
record FormularyDrugDto(
    string DrugId, string Name, List<string> BrandNames, string DrugClass, string Form,
    List<string> Strengths, List<string> Doses, string DefaultDose, DoseLimitsDto? DoseLimits,
    List<string> Routes, List<string> Frequencies, bool PrnCapable,
    List<string> AllergyBlock, List<string> AllergyWarn,
    bool? Active = null, List<FormularyEventDto>? History = null);

[System.Text.Json.Serialization.JsonUnmappedMemberHandling(System.Text.Json.Serialization.JsonUnmappedMemberHandling.Disallow)]
record DoseLimitsDto(string? Min, string? Max, string? MaxDaily, string? PerKg);

record FormularyEventDto(string Time, string Actor, string Action, string? Detail);

record InteractionRuleDto(string A, string B, string Severity, string Note);

/* REQUEST DTOs — unknown fields fail binding (codified validation rule).
   Fields arrive nullable and are validated explicitly so a missing field
   is a precise 400, never a null-crash or a silent default. */

[System.Text.Json.Serialization.JsonUnmappedMemberHandling(System.Text.Json.Serialization.JsonUnmappedMemberHandling.Disallow)]
record CreateDrugRequest(
    string? DrugId, string? Name, List<string>? BrandNames, string? DrugClass, string? Form,
    List<string>? Strengths, List<string>? Doses, string? DefaultDose, DoseLimitsDto? DoseLimits,
    List<string>? Routes, List<string>? Frequencies, bool? PrnCapable,
    List<string>? AllergyBlock, List<string>? AllergyWarn);

/* partial update — only provided fields are applied; drugId is the
   immutable natural key (like username) and is not editable */
[System.Text.Json.Serialization.JsonUnmappedMemberHandling(System.Text.Json.Serialization.JsonUnmappedMemberHandling.Disallow)]
record EditDrugRequest(
    string? Name, List<string>? BrandNames, string? DrugClass, string? Form,
    List<string>? Strengths, List<string>? Doses, string? DefaultDose, DoseLimitsDto? DoseLimits,
    List<string>? Routes, List<string>? Frequencies, bool? PrnCapable,
    List<string>? AllergyBlock, List<string>? AllergyWarn)
{
    public bool HasAnyField =>
        Name is not null || BrandNames is not null || DrugClass is not null || Form is not null
        || Strengths is not null || Doses is not null || DefaultDose is not null
        || DoseLimits is not null || Routes is not null || Frequencies is not null
        || PrnCapable is not null || AllergyBlock is not null || AllergyWarn is not null;
}

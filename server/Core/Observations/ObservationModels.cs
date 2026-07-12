using System.ComponentModel.DataAnnotations;
using System.Text.Json;
using Aurora.Core.Shared;

namespace Aurora.Core.Observations;

/* ---------------- Observations (Stage 11 — per the design document) ----------------
   Specification: docs/design/stage11-observation-model.md (the validator's
   design, F1/F2/F3 decisions baked in). Step 1 of §12: the GENERIC
   Observation record, the data-driven Observation Type Catalogue, and
   per-deployment group enablement.

   Pillar 2 (§3): the Observation table is GENERIC — one row stores
   (typeCode → value) against the catalogue; it is NOT a column-per-vital
   table. Adding an observation type is a catalogue row (data), never a
   schema change. Pillar 1 (§2): the record's shape is identical for
   manual/device/hybrid producers; device-era fields exist from day one. */

/* ---- the catalogue: groups are data (the 8 clinical categories) ---- */
class ObservationGroupRow
{
    [Key]
    public string GroupCode { get; set; } = "";
    public string DisplayName { get; set; } = "";
    public int Seq { get; set; }
    /* per-deployment enablement (§3 — the F3 decision): which categories
       this hospital charts. A configuration change, never a migration.
       Toggled only by the Consultant-tier authority (observations.configure). */
    public bool Enabled { get; set; }
    public string? ChangedBy { get; set; }
    public string? ChangedAt { get; set; }
    /* append-only enablement history — configuration changes are audited */
    public string EventsJson { get; set; } = "[]";

    public ObservationGroupDto ToDto() => new(
        GroupCode, DisplayName, Seq, Enabled, ChangedBy, ChangedAt,
        JsonSerializer.Deserialize<List<GroupEventDto>>(EventsJson, JsonOpts.Web)!);
}

/* ---- the catalogue: one row per observation TYPE (reference data;
   v1 ships this seeded READ-ONLY — the F3 decision; a management UI is
   deferred to v2) ---- */
class ObservationTypeRow
{
    [Key]
    public string TypeCode { get; set; } = "";
    public string GroupCode { get; set; } = "";
    public string DisplayName { get; set; } = "";
    public string Unit { get; set; } = "";
    /* numeric | enum | compound (§3) */
    public string ValueType { get; set; } = "";
    /* numeric: wide PLAUSIBILITY bounds (typo-catching, never clinical
       judgement); null for enum/compound */
    public double? Min { get; set; }
    public double? Max { get; set; }
    /* enum: the allowed value set */
    public string? AllowedValuesJson { get; set; }
    /* compound: named components, each numeric-ranged or enum (e.g. GCS
       eye/verbal/motor; pupils size/reaction per side) */
    public string? ComponentsJson { get; set; }
    /* derived values are COMPUTED, never charted as primary entries
       (§1 note): the catalogue defines them so flowsheets/prints know
       the derivation; the charting path rejects them */
    public bool IsDerived { get; set; }
    public string? DerivationInputsJson { get; set; }
    /* the taxonomy's optional/conditional markers ("optional",
       "if applicable", …) — informational; enablement is per GROUP in v1 */
    public bool Optional { get; set; }
    public int Seq { get; set; }

    public ObservationTypeDto ToDto() => new(
        TypeCode, GroupCode, DisplayName, Unit, ValueType, Min, Max,
        AllowedValuesJson is null ? null : JsonSerializer.Deserialize<List<string>>(AllowedValuesJson, JsonOpts.Web),
        ComponentsJson is null ? null : JsonSerializer.Deserialize<List<ComponentDto>>(ComponentsJson, JsonOpts.Web),
        IsDerived,
        DerivationInputsJson is null ? null : JsonSerializer.Deserialize<List<string>>(DerivationInputsJson, JsonOpts.Web),
        Optional);
}

/* ---- the GENERIC Observation record (design §3, plus §2's verifiedBy) ---- */
class ObservationRow
{
    [Key]
    public string ObservationId { get; set; } = "";
    public string PatientId { get; set; } = "";
    /* encounter scope (§6) — server-derived at creation, never client-supplied */
    public string EncounterId { get; set; } = "";
    /* → references the Observation Type Catalogue */
    public string TypeCode { get; set; } = "";
    /* the charted value: numeric/enum as text; compound as a JSON object
       keyed by component code. NEVER silently rewritten — corrections are
       amendments (§8). */
    public string Value { get; set; } = "";
    /* server-derived from the catalogue at write time (audit snapshot) */
    public string Unit { get; set; } = "";
    /* measurement time (§7) — server-stamped at charting (live charting,
       no back-dating by bedside clinicians) */
    public string ClinicalTime { get; set; } = "";
    /* manual | device | hybrid — always server-stamped by the producer path */
    public string Source { get; set; } = "";
    public string? DeviceId { get; set; }
    /* the charting clinician — from the TOKEN, never the payload */
    public string RecordedBy { get; set; } = "";
    /* system entry timestamp (§7 audit): "charted at X (entered Y) by Z" */
    public string EnteredAt { get; set; } = "";
    /* clinician verification of a device value (§2) — device era */
    public string? VerifiedBy { get; set; }
    /* the §8 correction audit: amend-not-erase, actor ALWAYS recorded —
       [{previousValue,newValue,amendedBy,amendedAt,reason,amenderRole}] */
    public string AmendmentsJson { get; set; } = "[]";

    public ObservationDto ToDto() => new(
        ObservationId, PatientId, EncounterId, TypeCode, Value, Unit,
        ClinicalTime, Source, DeviceId, RecordedBy, EnteredAt, VerifiedBy,
        JsonSerializer.Deserialize<List<AmendmentDto>>(AmendmentsJson, JsonOpts.Web)!);
}

/* ---------- wire contracts (camelCase; optional fields absent, not null) ---------- */

record GroupEventDto(string Time, string Actor, string Action);

record ObservationGroupDto(
    string GroupCode, string DisplayName, int Seq, bool Enabled,
    string? ChangedBy, string? ChangedAt, List<GroupEventDto> Events);

record ComponentDto(
    string Code, string Label, string Kind, double? Min, double? Max, List<string>? Values);

record ObservationTypeDto(
    string TypeCode, string GroupCode, string DisplayName, string Unit,
    string ValueType, double? Min, double? Max, List<string>? AllowedValues,
    List<ComponentDto>? Components, bool IsDerived, List<string>? DerivationInputs,
    bool Optional);

/* the catalogue read: groups in clinical order, each carrying its types —
   disabled groups are INCLUDED (config visibility); charting UIs filter
   on enabled */
record CatalogGroupDto(
    string GroupCode, string DisplayName, int Seq, bool Enabled, List<ObservationTypeDto> Types);

record AmendmentDto(
    string PreviousValue, string NewValue, string AmendedBy, string AmendedAt,
    string Reason, string AmenderRole);

record ObservationDto(
    string ObservationId, string PatientId, string EncounterId, string TypeCode,
    string Value, string Unit, string ClinicalTime, string Source, string? DeviceId,
    string RecordedBy, string EnteredAt, string? VerifiedBy, List<AmendmentDto> Amendments);

/* ---------- REQUEST DTOs (§12 step 2) ----------
   [Disallow] per the codified rule: unrecognized fields fail binding →
   400. Deliberately ABSENT and structurally impossible to supply:
   clinicalTime/enteredAt (SERVER-stamped — §7 live charting, no
   back-dating), source/deviceId/verifiedBy (server-owned provenance,
   §2), unit (catalogue-derived), encounterId (server-derived from the
   open encounter), recordedBy (token), amendments (the audit record).
   A timed ROUND is one request with many entries sharing the stamped
   clinicalTime; an AD-HOC entry is the same request with one entry
   (§10 — a round is just many observations sharing a timepoint).
   Entry values are JsonElement: numeric types accept a number (or
   numeric string), enum types a string, compound types an object of
   components. */

[System.Text.Json.Serialization.JsonUnmappedMemberHandling(System.Text.Json.Serialization.JsonUnmappedMemberHandling.Disallow)]
record NewObservationEntryDto(string? TypeCode, JsonElement Value);

[System.Text.Json.Serialization.JsonUnmappedMemberHandling(System.Text.Json.Serialization.JsonUnmappedMemberHandling.Disallow)]
record ChartObservationsRequest(string? PatientId, List<NewObservationEntryDto>? Entries);

/* the §8 correction: tier-1 (own entry, 5-min window) sends only the
   corrected value — reason OPTIONAL (recorded when given); tier-2
   (Consultant-tier) REQUIRES the reason. The amendment record always
   captures actor/original/new/timestamp/amenderRole. */
[System.Text.Json.Serialization.JsonUnmappedMemberHandling(System.Text.Json.Serialization.JsonUnmappedMemberHandling.Disallow)]
record CorrectObservationRequest(JsonElement Value, string? Reason);

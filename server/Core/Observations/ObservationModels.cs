using System.ComponentModel.DataAnnotations;

namespace Aurora.Core.Observations;

/* ---------------- Observations (Stage 11 — first half: Manual) ----------------
   THE locked Observation model from 01_ARCHITECTURE.md § Stage 11,
   implemented field-for-field. One row per observed VALUE (a bedside
   vitals set is several observations charted together). The model is
   built DEVICE-READY from day one: source ('manual' | 'device' |
   'hybrid'), deviceId, verifiedBy, and the override triplet all exist in
   the table and on the wire NOW — adding the Device source later is a
   new ADAPTER writing through the same service, never a model change.
   Until then, the MANUAL entry path is the only writer: it stamps
   source='manual' server-side, and a client payload attempting to claim
   source/deviceId/verifiedBy fails binding (Disallow → 400). */

class ObservationRow
{
    [Key]
    public string ObservationId { get; set; } = "";
    public string PatientId { get; set; } = "";
    /* lifecycle scope: the encounter the value was charted under —
       SERVER-derived from the patient's open encounter at creation,
       never client-supplied (the Orders/results rule) */
    public string EncounterId { get; set; } = "";
    /* what was measured — a code from the closed server-side vocabulary
       (ObservationLogic.Types); label/kind/range live in the vocabulary */
    public string Type { get; set; } = "";
    /* the recorded value, as charted. Stored as text so numeric readings
       and categorical settings (ventilator mode) share ONE model;
       validation is per-type. NEVER rewritten: a correction is an
       override, the original survives (the never-destroy rule). */
    public string Value { get; set; } = "";
    /* unit DENORMALIZED from the vocabulary at write time (audit
       snapshot — a later vocabulary change never rewrites history);
       clients cannot supply it */
    public string Unit { get; set; } = "";
    /* 'manual' | 'device' | 'hybrid' — always server-set by the writing
       path. The manual endpoint writes 'manual'; the future device
       adapter writes 'device'/'hybrid' through the same service. */
    public string Source { get; set; } = "";
    /* set when source involves a device — null on every manual entry */
    public string? DeviceId { get; set; }
    /* when the value was MEASURED (clinician-charted, dated UTC
       "yyyy-MM-dd HH:mm" — charting may lag the measurement) */
    public string CapturedAt { get; set; } = "";
    /* who entered/accepted the value into the record — from the TOKEN */
    public string RecordedBy { get; set; } = "";
    /* clinician verification of a DEVICE value — null on manual entries;
       the verify path arrives with the device adapter */
    public string? VerifiedBy { get; set; }
    /* the override triplet (the locked never-destroy rule): an override
       NEVER rewrites Value — the original is preserved alongside the
       correction, with the flag marking the record */
    public bool IsOverridden { get; set; }
    public string? OverrideValue { get; set; }
    public string? OverrideReason { get; set; }

    public ObservationDto ToDto() => new(
        ObservationId, PatientId, EncounterId, Type, Value, Unit, Source,
        DeviceId, CapturedAt, RecordedBy, VerifiedBy,
        IsOverridden, OverrideValue, OverrideReason);
}

/* wire contract — mirrors Observation in src/lib/api/types.ts
   (camelCase over the wire; optional fields absent, not null) */
record ObservationDto(
    string ObservationId, string PatientId, string EncounterId, string Type,
    string Value, string Unit, string Source, string? DeviceId,
    string CapturedAt, string RecordedBy, string? VerifiedBy,
    bool IsOverridden, string? OverrideValue, string? OverrideReason);

/* the vocabulary entry served to clients — the type list is reference
   data with ONE source of truth (the server); the frontend never
   duplicates it */
record ObservationTypeDto(
    string Type, string Label, string Unit, string Kind, string Group,
    double? Min, double? Max, string[]? Choices);

/* ---------- REQUEST DTOs ----------
   [Disallow] per the codified validation rule: an unrecognized field
   fails binding → automatic 400. Deliberately ABSENT from the manual
   request shape — and structurally IMPOSSIBLE to supply: source,
   deviceId, verifiedBy (server provenance — the device-readiness
   guarantee), unit (vocabulary-derived), encounterId (server-derived
   from the open encounter), recordedBy (token). A bedside SET is one
   request: every entry is validated before anything is written, and the
   set persists atomically. */

[System.Text.Json.Serialization.JsonUnmappedMemberHandling(System.Text.Json.Serialization.JsonUnmappedMemberHandling.Disallow)]
record NewObservationDto(string? Type, string? Value);

[System.Text.Json.Serialization.JsonUnmappedMemberHandling(System.Text.Json.Serialization.JsonUnmappedMemberHandling.Disallow)]
record RecordObservationsRequest(string? PatientId, string? CapturedAt, List<NewObservationDto>? Entries);

/* correcting a mis-charted value: override with a REQUIRED reason —
   the original value survives untouched (never-destroy) */
[System.Text.Json.Serialization.JsonUnmappedMemberHandling(System.Text.Json.Serialization.JsonUnmappedMemberHandling.Disallow)]
record OverrideObservationRequest(string? Value, string? Reason);

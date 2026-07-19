using System.ComponentModel.DataAnnotations;
using System.Text.Json;
using Aurora.Core.Shared;

namespace Aurora.Core.MasterData;

/* ------- Configuration Vocabularies (Master Data, Aurora Core) -------
   The LAST FOUR vocabularies of the configurability arc (the validator's
   Configuration Vocabularies design): dispositions, isolation types,
   shifts — plus the named frequencies upgrade on NamedFrequencyRow in
   FormularyModels.cs. Each is a hospital-editable list on the exact
   pattern code status proved: natural-key CODE (permanent), display
   LABEL (editable), Seq (authoring order), Active flag, append-only
   audit, DEACTIVATE-NEVER-DELETE. A value ever recorded on a clinical
   row stays resolvable forever; retirement only removes it from NEW
   selection. The safety invariants stay code, never data: the q<n>h
   frequency pattern, the reserved 'died' disposition rule, and the
   IsDeath immutability below. */

/* DISPOSITION — the OUTCOME of an ICU stay, snapshotted onto the closed
   encounter (Encounter.Disposition stores the CODE; history never
   re-resolves through this table for its own validity).
   THE DIED GUARD (design §1 — the one safety-critical choice, both
   halves built):
   - IsDeath is an IMMUTABLE-AT-CREATION attribute: the deceased
     re-admission guard (#120), the patient-history status, and the
     mortality statistics all key on "stored code → row → IsDeath",
     never on the label — so a hospital-added death disposition
     ("Died in OR") arms the guard correctly, and NO edit can flip the
     meaning of an already-recorded outcome (the edit contract simply
     has no isDeath field; rows are never deleted, so resolution is
     total).
   - The seeded 'died' row is RESERVED: it can never be retired (409 in
     the API — a rule in code, like the q<n>h pattern), so recording a
     death is always possible and the mortality numerator can never be
     silently configured away. */
class DispositionRow
{
    [Key]
    public string Code { get; set; } = "";
    public string Label { get; set; } = "";
    public int Seq { get; set; }
    public bool Active { get; set; } = true;
    /** immutable after creation — see the header block */
    public bool IsDeath { get; set; }
    public string EventsJson { get; set; } = "[]";

    public DispositionDto ToDto() => new(Code, Label, Seq, Active, IsDeath,
        JsonSerializer.Deserialize<List<FormularyEventDto>>(EventsJson, JsonOpts.Web)!);
}

/* ISOLATION TYPE — real IPC precautions (design §2), replacing the
   boolean flag. A patient's isolation is a SET of active type codes on
   the OPEN ENCOUNTER (multiple is clinically real: contact AND
   droplet). The seeded 'unspecified' entry is the honest migration
   target for pre-vocabulary `isolation: true` patients — the recorded
   fact was "isolated", not which kind; a clinician refines it. A type
   is never guessed. */
class IsolationTypeRow
{
    [Key]
    public string Code { get; set; } = "";
    public string Label { get; set; } = "";
    public int Seq { get; set; }
    public bool Active { get; set; } = true;
    public string EventsJson { get; set; } = "[]";

    public IsolationTypeDto ToDto() => new(Code, Label, Seq, Active,
        JsonSerializer.Deserialize<List<FormularyEventDto>>(EventsJson, JsonOpts.Web)!);
}

/* SHIFT — the working shifts assignments are made against (design §3;
   the validator's decision: two-shift day/night was itself a
   hospital-varying assumption — three-shift ICUs are real).
   PatientAssignment.Shift stores the CODE as a SNAPSHOT (the row is the
   audit record): retiring a shift never touches existing assignments —
   they keep rendering through the label resolver (retired entries
   resolve forever), and only NEW assignments are refused it. */
class ShiftRow
{
    [Key]
    public string Code { get; set; } = "";
    public string Label { get; set; } = "";
    public int Seq { get; set; }
    public bool Active { get; set; } = true;
    public string EventsJson { get; set; } = "[]";

    public ShiftDto ToDto() => new(Code, Label, Seq, Active,
        JsonSerializer.Deserialize<List<FormularyEventDto>>(EventsJson, JsonOpts.Web)!);
}

/* ---------- wire contracts (camelCase over the wire) ---------- */

record DispositionDto(string Code, string Label, int Seq, bool Active, bool IsDeath,
    List<FormularyEventDto> History);

record IsolationTypeDto(string Code, string Label, int Seq, bool Active,
    List<FormularyEventDto> History);

record ShiftDto(string Code, string Label, int Seq, bool Active,
    List<FormularyEventDto> History);

/** named-frequency management view: Value is BOTH the identity and the
    display (it is what orders store), so there is no label to edit —
    the manager is add / retire / reactivate only. ReferencedBy names
    the formulary drugs whose per-drug frequency list carries the value
    (the design's allowed-but-surfaced retirement). */
record FrequencyEntryDto(string Value, int Seq, bool Active, List<string> ReferencedBy,
    List<FormularyEventDto> History);

/* REQUEST DTOs — Disallow: an unrecognized field fails binding → automatic
   400, never a silent no-op (codified patient-safety rule) */
[System.Text.Json.Serialization.JsonUnmappedMemberHandling(System.Text.Json.Serialization.JsonUnmappedMemberHandling.Disallow)]
record CreateDispositionRequest(string? Code, string? Label, bool? IsDeath);

[System.Text.Json.Serialization.JsonUnmappedMemberHandling(System.Text.Json.Serialization.JsonUnmappedMemberHandling.Disallow)]
record CreateVocabEntryRequest(string? Code, string? Label);

[System.Text.Json.Serialization.JsonUnmappedMemberHandling(System.Text.Json.Serialization.JsonUnmappedMemberHandling.Disallow)]
record EditVocabEntryRequest(string? Label);

[System.Text.Json.Serialization.JsonUnmappedMemberHandling(System.Text.Json.Serialization.JsonUnmappedMemberHandling.Disallow)]
record CreateFrequencyRequest(string? Value);

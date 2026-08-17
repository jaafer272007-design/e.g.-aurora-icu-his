using System.ComponentModel.DataAnnotations;
using System.Text.Json;
using Aurora.Core.Shared;

namespace Aurora.Core.MasterData;

/* ------- Inpatient Reception master data (Aurora Core, Module #2 Ward) -------
   The GOVERNED VOCABULARIES of docs/design/inpatient-reception.md §2, built on
   the same shape the ICU configuration vocabularies proved: natural-key CODE
   (permanent), display LABEL (editable), Seq, Active, append-only audit,
   DEACTIVATE-NEVER-DELETE. They live in their own file rather than beside
   DispositionRow/IsolationTypeRow/ShiftRow because that file's header records a
   closed arc ("the LAST FOUR vocabularies of the configurability arc") and
   these are a different module's master data, not a fifth entry in it.

   FOUR OF THE DESIGN'S FIVE LISTS ARE HERE. The fifth — the referring-doctor
   TYPEAHEAD SOURCE — is deliberately absent: it is not a governed vocabulary
   (Amendment A), its gate is `admissions.create`, and both defer to the
   Configuration-screen step. See the design's "Build sequencing" amendment for
   the reason; it is a decision, not an omission.

   GATING: all four are `hospital.configure` — the office Administrator's
   ADMINISTRATIVE configuration atom (the hospital-identity precedent).
   Departments and services are how a hospital describes ITSELF; they carry no
   clinical data, so they never sit on a clinical profile. This is the same
   administrative/clinical split 01_ARCHITECTURE.md records: administrative
   configuration → office Administrator; clinical vocabularies
   (codestatus.manage, dispositions.manage) → SeniorDoctor.

   SEEDING — PRODUCTION SEEDS NOTHING. These four lists are 100%
   hospital-specific: one hospital's departments are meaningless to another, so
   there is no honest starting set to ship. Reception is unusable until a
   hospital configures it, and that is correct rather than a gap. This
   DELIBERATELY BREAKS the precedent set by dispositions / isolation types /
   shifts, which seed in BOTH modes because they are clinically universal —
   every ICU discharges home, to a ward, or to a death; every hospital isolates
   for contact and droplet. The precedent followed here is HOSPITAL IDENTITY,
   which seeds in demo only and is asserted EMPTY on a production boot. The
   asymmetry is recorded with its reason in 02_PROJECT_STATUS.md, because four
   vocabularies seeded and four not, unexplained, reads as a forgotten seed. */

/* ADMISSION TYPE — Elective / Emergency / Urgent / … (design §2). Flat. */
class AdmissionTypeRow : IVocabRow
{
    [Key]
    public string Code { get; set; } = "";
    public string Label { get; set; } = "";
    public int Seq { get; set; }
    public bool Active { get; set; } = true;
    public string EventsJson { get; set; } = "[]";

    public AdmissionTypeDto ToDto() => new(Code, Label, Seq, Active,
        JsonSerializer.Deserialize<List<FormularyEventDto>>(EventsJson, JsonOpts.Web)!);
}

/* DEPARTMENT — the parent half of the design's one hierarchy (§2.1). Flat in
   itself; ServiceRow points AT it by code.
   THE RETIRE GUARD IS HALF-BUILT, DELIBERATELY AND VISIBLY. §2.1 requires
   retiring a department to be refused while it has active SERVICES **or open
   ADMISSIONS**. The services half is built (VocabApi's deactivateGuard). The
   admissions half CANNOT be built yet: an admission does not carry a
   department until the admission build lands, so there is nothing to count.
   Recorded as owed in 02_PROJECT_STATUS.md rather than left silently absent —
   a half-guard that looks whole is the failure this project keeps recording. */
class DepartmentRow : IVocabRow
{
    [Key]
    public string Code { get; set; } = "";
    public string Label { get; set; } = "";
    public int Seq { get; set; }
    public bool Active { get; set; } = true;
    public string EventsJson { get; set; } = "[]";

    public DepartmentDto ToDto() => new(Code, Label, Seq, Active,
        JsonSerializer.Deserialize<List<FormularyEventDto>>(EventsJson, JsonOpts.Web)!);
}

/* SERVICE — the child half (§2.1): belongs to exactly ONE department, never
   free-floating.

   THE PARENT IS IMMUTABLE AT CREATION, and that is enforced by the SHAPE OF
   THE CONTRACT rather than by a guard: `CreateServiceRequest` carries
   `DepartmentCode`, `EditVocabEntryRequest` does not carry it at all, and
   `JsonUnmappedMemberHandling.Disallow` turns a PUT that names it into a
   binding 400. This is the mechanism `isDeath` already proved on
   DispositionRow — a field that does not exist on the edit request cannot be
   forgotten by a future edit path, whereas a guard can. There is no
   reparenting, by construction.

   THE PARENT IS VALIDATED IN APPLICATION CODE, not by a foreign key — this
   database has none. The precedent is ObservationType.GroupCode
   (ObservationCatalogApi.cs:51-54): look the parent up, and an unknown one is
   a payload reference resolving to nothing → 400 naming what IS valid.

   A CODE IS IDENTITY, NEVER MEANING. No surface may switch, compare or style
   on a department or service code. Labels resolve at read; an audit entry
   snapshots the label it saw; and a change of MEANING is a new entry plus a
   retire, never a rename — so renaming a department can never silently
   reinterpret the records already filed under it. */
class ServiceRow : IVocabRow
{
    [Key]
    public string Code { get; set; } = "";
    public string Label { get; set; } = "";
    /** the parent department's CODE — immutable after creation (the edit
        contract has no field for it) */
    public string DepartmentCode { get; set; } = "";
    public int Seq { get; set; }
    public bool Active { get; set; } = true;
    public string EventsJson { get; set; } = "[]";

    public ServiceDto ToDto() => new(Code, Label, DepartmentCode, Seq, Active,
        JsonSerializer.Deserialize<List<FormularyEventDto>>(EventsJson, JsonOpts.Web)!);
}

/* SOURCE OF ADMISSION — Home / Clinic / Emergency Dept / … (design §2). Flat. */
class AdmissionSourceRow : IVocabRow
{
    [Key]
    public string Code { get; set; } = "";
    public string Label { get; set; } = "";
    public int Seq { get; set; }
    public bool Active { get; set; } = true;
    public string EventsJson { get; set; } = "[]";

    public AdmissionSourceDto ToDto() => new(Code, Label, Seq, Active,
        JsonSerializer.Deserialize<List<FormularyEventDto>>(EventsJson, JsonOpts.Web)!);
}

/* ---------- wire contracts (camelCase over the wire) ---------- */

record AdmissionTypeDto(string Code, string Label, int Seq, bool Active,
    List<FormularyEventDto> History);

record DepartmentDto(string Code, string Label, int Seq, bool Active,
    List<FormularyEventDto> History);

/** departmentCode is on the READ contract because Reception picks the
    department first and filters services to it (§3.2); it is absent from the
    EDIT contract because the parent is immutable (see ServiceRow). */
record ServiceDto(string Code, string Label, string DepartmentCode, int Seq, bool Active,
    List<FormularyEventDto> History);

record AdmissionSourceDto(string Code, string Label, int Seq, bool Active,
    List<FormularyEventDto> History);

/* REQUEST DTO — Disallow: an unrecognized field fails binding → automatic 400,
   never a silent no-op (codified validation rule). Services map their own POST
   because the shared CreateVocabEntryRequest has no departmentCode field. */
[System.Text.Json.Serialization.JsonUnmappedMemberHandling(System.Text.Json.Serialization.JsonUnmappedMemberHandling.Disallow)]
record CreateServiceRequest(string? Code, string? Label, string? DepartmentCode);

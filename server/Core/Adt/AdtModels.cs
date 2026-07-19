using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;
using System.Text.Json;
using Aurora.Core.MasterData;
using Aurora.Core.Shared;

namespace Aurora.Core.Adt;

/* ---------- ADT — Patient / Encounter / Bed (Layer 2, Aurora Core) ----------
   The first domain BUILT IN CORE from the start, and the first write feature
   on the durable database. A Patient is a person and persists across visits;
   an Encounter is one admission carrying location (bed), attending,
   admission time, status and the discharge/transfer event history. The ICU
   bedside snapshot (SOFA, EWS, rhythm, vitals, organ map) deliberately stays
   in Modules/Icu/Roster until Stage 11 Observations absorb it.

   Seeding: AdtPatients + Encounters are derived at boot from the SAME
   roster-seed.json the bedside table uses (one source, no drift); Beds from
   Data/beds-seed.json — GENERATED from src/lib/api/data/beds.ts BED_LAYOUT
   (bed = place, occupancy NEVER stored — derived from open encounters). */

/* table name avoids colliding with the roster's historical "Patients"
   table; the roster table dissolves into this one at Stage 11 */
[Table("AdtPatients")]
class Patient
{
    [Key]
    public string PatientId { get; set; } = "";
    public string Mrn { get; set; } = "";
    /* LEGACY single-name field (pre-structured-identity rows). NEVER
       decomposed — "Ahmed Al-Saadi" → First: Ahmed, Family: Al-Saadi is a
       GUESS, and "Maria Hansen" does not decompose into a five-part Iraqi
       legal name at all (the design's §7). Legacy rows keep this value
       byte-for-byte and render it honestly as their display name; rows
       with structured parts leave it untouched as the pre-correction
       record. */
    public string Name { get; set; } = "";
    /* STRUCTURED PATIENT NAME (the clinical validator's design — locked
       decision 1): the Iraqi legal name in five parts — first · second
       (father) · third (grandfather) · fourth (great-grandfather) ·
       family/tribal. First, Second, Family REQUIRED on structured rows;
       Third/Fourth optional and BLANK IS HONEST (never a placeholder).
       Names are NOT unique (two "Unknown" patients must both admit).
       The display name (First + Second + Family) and the full legal name
       are DERIVED at read — never stored concatenated. */
    public string? NameFirst { get; set; }
    public string? NameSecond { get; set; }
    public string? NameThird { get; set; }
    public string? NameFourth { get; set; }
    public string? NameFamily { get; set; }
    /* NATIONAL IDENTITY NUMBER (locked decision 3): stored EXACTLY as it
       appears on the identity card — no format invention, no
       normalisation. UNIQUE WHEN PRESENT (a duplicate at admission is a
       409 naming the conflict); OPTIONAL — the unidentified have none,
       and multiple ID-less patients never collide. Distinct from the
       MRN (the hospital's own record number). */
    public string? NationalId { get; set; }
    /* PATIENT FILE NUMBER (the Locale/File-Number design §2 — the
       contracted hospital's own chart number, the identifier they have
       always filed by): stored EXACTLY as the hospital records it — no
       format invention (the national ID's as-on-card rule). OPTIONAL (a
       walk-in has none); UNIQUE WHEN PRESENT (one hospital — a duplicate
       is refused naming the conflict, like the national ID); TYPED by
       the registrar, which is SAFE because it is NOT a linking key — the
       MRN and patientId remain the keys (#116), so a typo here is a
       correctable data error, never a wrong-patient linkage. Three
       identifiers, each one job: MRN (Aurora's, generated) · national ID
       (the state's, typed) · file number (the hospital's, typed). */
    public string? PatientFileNumber { get; set; }
    /* IDENTITY CORRECTION history (§3 — append-only, amend never erase):
       every name/national-ID/DOB/MRN correction records actor + ACTIVE
       role (#104) + dated time + reason + the previous→new diff. A record
       that read "Unknown" for six hours and now reads a real name is a
       fact — orders and doses were documented against that identity. */
    public string IdentityJson { get; set; } = "[]";
    /* IDENTITY REDESIGN (the patient-identity-read PR): exactly ONE of
       DateOfBirth / Age is populated per row. DateOfBirth ("yyyy-MM-dd")
       is captured on new admissions and age is COMPUTED at read (the
       clock-computed-state rule — never stored). Age survives as the
       LEGACY field for rows admitted before DOB capture existed: an
       admission-era estimate that cannot be turned into a birth date
       without fabrication, so it is served plainly with its provenance
       (ageSource) instead — the never-fabricate discipline. */
    public int? Age { get; set; }
    public string? DateOfBirth { get; set; }
    public string Sex { get; set; } = "";
    public string Allergies { get; set; } = "";

    /* DERIVED NAME RENDERINGS (never stored — the house rule):
       - DisplayName (locked decision 4): First + Second + Family — every
         compact surface (rail, bed board, orders, MAR, results, timeline,
         worklists) renders this; legacy rows honestly render their stored
         single name (it simply IS their name — §7).
       - FullLegalName: all present parts in order — the patient header
         and official/print documents, alongside the national ID. */
    public bool HasStructuredName =>
        !string.IsNullOrEmpty(NameFirst) && !string.IsNullOrEmpty(NameSecond) && !string.IsNullOrEmpty(NameFamily);

    public string DisplayName =>
        HasStructuredName ? $"{NameFirst} {NameSecond} {NameFamily}" : Name;

    public string FullLegalName =>
        HasStructuredName
            ? string.Join(" ", new[] { NameFirst, NameSecond, NameThird, NameFourth, NameFamily }
                .Where(p => !string.IsNullOrEmpty(p)))
            : Name;

    /* THE canonical identity resolver (the no-fork rule): the roster
       projection, the admissions response, and GET /adt/patients/{id}
       all serve identity through THIS method — one source of truth,
       several entry points, never a parallel assembly of these fields.
       Weight/height are deliberately NOT here — they are ENCOUNTER
       attributes (see Encounter below, the project owner's decision).
       `name` on the wire is the DERIVED display name (derived at read,
       never stored concatenated); the structured parts, the full legal
       name, the national ID and the identity-correction history ride as
       an ADDITIVE nullable tail (WhenWritingNull — legacy rows keep
       their pre-feature wire bytes). */
    public PatientDto ToDto()
    {
        var (age, source) = ResolveAge();
        var history = JsonSerializer.Deserialize<List<IdentityEventDto>>(IdentityJson, JsonOpts.Web)!;
        return new(PatientId, Mrn, DisplayName, DateOfBirth, age, source, Sex, Allergies,
            NameFirst, NameSecond, NameThird, NameFourth, NameFamily,
            HasStructuredName ? FullLegalName : null,
            NationalId,
            history.Count == 0 ? null : history,
            PatientFileNumber);
    }

    (int Age, string Source) ResolveAge()
    {
        if (DateOfBirth is not null && DateTime.TryParseExact(DateOfBirth, "yyyy-MM-dd",
                null, System.Globalization.DateTimeStyles.None, out var dob))
        {
            var today = DateTime.UtcNow.Date;
            var age = today.Year - dob.Year;
            if (dob.Date > today.AddYears(-age)) age--;
            return (age, "dateOfBirth");
        }
        return (Age ?? 0, "recordedAtAdmission");
    }
}

[Table("Encounters")]
class Encounter
{
    [Key]
    public string EncounterId { get; set; } = "";
    public string PatientId { get; set; } = "";
    public string BedId { get; set; } = "";
    public string Diagnosis { get; set; } = "";
    public string Attending { get; set; } = "";
    public string Status { get; set; } = "";      // open | discharged
    public string AdmittedAt { get; set; } = "";  // "" on historical seeds
    public string AdmittedBy { get; set; } = "";
    public string? DischargedAt { get; set; }
    public string? DischargedBy { get; set; }
    /* DISCHARGE DISPOSITION — the OUTCOME of the ICU stay, selected by the
       discharging clinician as part of the discharge flow (Statistics
       prerequisite: ICU mortality = "died" over discharges WITH a recorded
       disposition). One of AdtLogic.Dispositions. NULL = not recorded —
       every pre-feature discharge (and any API discharge without a body)
       stays honestly blank; an outcome is NEVER fabricated, and null rows
       are EXCLUDED from any mortality denominator. */
    public string? Disposition { get; set; }
    public string EventsJson { get; set; } = "[]";
    /* WEIGHT & HEIGHT (Patient Weight & Height Capture — the clinical
       validator's design): ENCOUNTER-SCOPED attributes, not observations —
       ICU patients are not weighed daily, so this is THE ADMISSION's
       recorded reference weight (dosing, SOFA µg/kg/min), captured at
       admission and addable/correctable later within the encounter.
       Units are FIXED: kg / cm.
       MODELLING (design open item #1, decided by the project owner on
       the flagged choice): each admission keeps ITS OWN weight/height —
       a patient re-admitted a year later may genuinely differ, so a new
       encounter STARTS FRESH (never inherits, never overwrites a prior
       admission's values). DateOfBirth stays person-level identity (age
       already computes at read, correctly per-time); weight/height are
       per-episode clinical data.
       MeasurementsJson is the amend-not-erase history WITHIN this
       encounter: every set/change records who, when (UTC
       "yyyy-MM-dd HH:mm" — dated like the Layer-3 user audit), and the
       prior value. Values are never cleared — only corrected. */
    public double? WeightKg { get; set; }
    public double? HeightCm { get; set; }
    public string MeasurementsJson { get; set; } = "[]";

    /* CODE STATUS (the governed-vocabulary SAFETY FIX) — ENCOUNTER-SCOPED
       like weight/height, and for the same reason the owner decided that
       shape: each admission records ITS OWN goals-of-care decision. A
       re-admission STARTS FRESH — a stale DNR from a prior episode must
       never silently carry forward; it is re-confirmed (re-set) on the
       new encounter or it is honestly "not recorded".
       NULL = NOT RECORDED — rendered as an unmistakable explicit state,
       never a blank that could read as "Full Code" and never a
       fabricated default (the roster's old `?? "Full Code"` fallback is
       exactly the defect this fixes). The value is a CODE from the
       CodeStatuses vocabulary — selected, never typed.
       CodeStatusEventsJson is the append-only audit WITHIN this
       encounter: every set records who, when (dated UTC), under which
       ACTIVE role, and the prior code — a resuscitation instruction's
       provenance matters as much as a lab result's. */
    public string? CodeStatusCode { get; set; }
    public string CodeStatusEventsJson { get; set; } = "[]";

    /* ISOLATION PRECAUTIONS (Configuration Vocabularies design §2 — the
       boolean's upgrade) — ENCOUNTER-SCOPED on the code-status rule and
       for the same reason: precautions are ordered for THIS stay; a
       re-admission STARTS FRESH (stale precautions never silently carry
       forward — they are re-established or honestly absent). The value
       is a SET of IsolationTypes vocabulary CODES (multiple is
       clinically real: contact AND droplet), selected never typed;
       [] = no precautions. Set changes are audited into EventsJson (the
       transfer precedent) with the prior set named. The pre-vocabulary
       bedside boolean migrates true → ["unspecified"] (the recorded
       fact was "isolated", not which kind — a clinician refines it;
       a type is NEVER guessed). */
    public string IsolationJson { get; set; } = "[]";

    /* patientName is a denormalized DISPLAY snapshot supplied by the caller
       (same precedent as orders' name/bed snapshots) — identity is never
       redefined here */
    public List<string> IsolationTypes() =>
        JsonSerializer.Deserialize<List<string>>(IsolationJson, JsonOpts.Web)!;

    public EncounterDto ToDto(string patientName)
    {
        var measurements = JsonSerializer.Deserialize<List<MeasurementEventDto>>(MeasurementsJson, JsonOpts.Web)!;
        var codeStatusEvents = JsonSerializer.Deserialize<List<CodeStatusEventDto>>(CodeStatusEventsJson, JsonOpts.Web)!;
        var isolation = IsolationTypes();
        return new(
            EncounterId, PatientId, patientName, BedId, Diagnosis, Attending, Status,
            AdmittedAt, AdmittedBy, DischargedAt, DischargedBy,
            JsonSerializer.Deserialize<List<AdtEventDto>>(EventsJson, JsonOpts.Web)!,
            WeightKg, HeightCm,
            /* empty history serves as ABSENT (WhenWritingNull) — rows
               without measurements keep their pre-feature wire bytes */
            measurements.Count == 0 ? null : measurements,
            Disposition,
            CodeStatusCode,
            codeStatusEvents.Count == 0 ? null : codeStatusEvents,
            /* additive nullable tail on the same rule: encounters
               without precautions keep their pre-feature wire bytes */
            isolation.Count == 0 ? null : isolation);
    }
}

/* a bed is a PLACE — occupancy is derived from open encounters at read
   time, never stored (locked derived-state rule) */
[Table("Beds")]
/* The BED REGISTRY (bed-registry design): the physical beds of the ONE
   configured unit, on the proven catalogue pattern (Active flag,
   append-only audit, deactivate-never-delete) — with the rule that sets
   beds apart from inert catalogues: a bed is OCCUPIED (occupancy derived
   from open encounters, never stored), so retiring is guarded by LIVE
   occupancy, and beds are NEVER renamed (a renamed occupied bed is a
   wrong-patient-location risk — BedId is stable once created; there is
   deliberately no edit endpoint). Historical references are FK-free
   BedId snapshots that keep rendering after retirement.
   SINGLE-UNIT BOUNDARY (flagged, not deepened): today all beds belong to
   the one configured unit (#135's hospital identity names it); the later
   multi-unit project adds a units catalogue and a UnitId scoping column
   here — nothing in this model or its consumers assumes the unit is
   '4B' beyond the pre-existing data-layer key. */
class BedRow
{
    [Key]
    public string BedId { get; set; } = "";
    public string Area { get; set; } = "";
    public int Seq { get; set; }
    /* catalogue pattern (NEW): retired beds leave the board and the
       admit/transfer pickers but keep rendering on historical records */
    public bool Active { get; set; } = true;
    /* append-only audit — who added/retired/reactivated, when, as which
       role; seeded beds carry an empty history (no invented audit) */
    public string EventsJson { get; set; } = "[]";

    public List<FormularyEventDto> History() =>
        JsonSerializer.Deserialize<List<FormularyEventDto>>(EventsJson, JsonOpts.Web)!;
}

/* wire contracts. PatientDto: dateOfBirth is null on legacy rows (never
   fabricated); age is computed-at-read when dateOfBirth exists, else the
   admission-era recorded value; ageSource names which
   ("dateOfBirth" | "recordedAtAdmission"). name = the DERIVED display
   name (First+Second+Family on structured rows, the stored legacy name
   otherwise). The structured-identity tail (nameFirst…nameFamily,
   fullName, nationalId, identity history) is additive and nullable —
   legacy rows keep their pre-feature wire bytes (WhenWritingNull). */
record PatientDto(
    string PatientId, string Mrn, string Name, string? DateOfBirth, int Age,
    string AgeSource, string Sex, string Allergies,
    string? NameFirst = null, string? NameSecond = null, string? NameThird = null,
    string? NameFourth = null, string? NameFamily = null,
    string? FullName = null, string? NationalId = null,
    List<IdentityEventDto>? Identity = null,
    /* the hospital's own chart number (Locale/File-Number §2) — an
       additive nullable tail like the rest: absent is honest (existing
       patients predate the field), WhenWritingNull keeps their bytes */
    string? FileNumber = null);

/* one append-only identity-correction event (§3): dated time, actor +
   ACTIVE role (#104), the required reason, and the previous→new diff —
   the previous identity is preserved and visible, never erased. */
record IdentityEventDto(string Time, string Actor, string Role, string Reason, string Detail);

/* one amend-not-erase history entry for a weight/height set/change:
   field "weight" | "height"; action "recorded at admission" | "added" |
   "corrected"; prior carries the PREVIOUS value whenever one existed
   within the encounter (the design's who/when/prior rule — a value that
   drives dosing is never silently overwritten). */
record MeasurementEventDto(
    string Time, string Actor, string Field, string Action, double? Prior, double Value);

record AdtEventDto(string Time, string Actor, string Action, string? Detail);

/* weightKg/heightCm/measurements are the Weight & Height capture —
   ENCOUNTER-SCOPED, ADDITIVE nullable tail (WhenWritingNull: encounters
   without them keep their pre-feature wire bytes). BMI/IBW/BSA are NEVER
   served — they are derived at render from weight+height (the
   derived-values discipline: Net Balance, GCS Total), and never shown
   when an input is missing. */
record EncounterDto(
    string EncounterId, string PatientId, string PatientName, string BedId, string Diagnosis,
    string Attending, string Status, string AdmittedAt, string AdmittedBy, string? DischargedAt,
    string? DischargedBy, List<AdtEventDto> Events,
    double? WeightKg = null, double? HeightCm = null,
    List<MeasurementEventDto>? Measurements = null,
    /* discharge disposition — additive nullable tail (WhenWritingNull:
       encounters without one keep their pre-feature wire bytes) */
    string? Disposition = null,
    /* code status — additive nullable tail on the same rule: the CODE
       from the governed vocabulary (null = not recorded, an explicit
       state, never a default) + the append-only set history */
    string? CodeStatusCode = null,
    List<CodeStatusEventDto>? CodeStatusEvents = null,
    /* isolation precautions — additive nullable tail on the same rule:
       the SET of IsolationTypes vocabulary codes for THIS stay (absent
       = none; set changes are audited into events) */
    List<string>? IsolationTypes = null);

/* one append-only code-status set event: dated time, actor + ACTIVE role
   (the #104 convention), the code set, the LABEL SNAPSHOT the clinician
   saw when selecting it (the results-range precedent: historical
   rendering — prints especially — reads the snapshot and never consults
   the live vocabulary), and the prior code (null on the first set) — a
   resuscitation instruction is never silently changed. */
record CodeStatusEventDto(string Time, string Actor, string Role, string Code, string Label, string? Prior);

/* POST /adt/encounters/{id}/code-status — the ONLY field is the selected
   vocabulary code (never typed text); unknown fields fail binding */
[System.Text.Json.Serialization.JsonUnmappedMemberHandling(System.Text.Json.Serialization.JsonUnmappedMemberHandling.Disallow)]
record SetCodeStatusRequest(string? Code);

/* POST /adt/encounters/{id}/isolation — the REPLACEMENT set of selected
   IsolationTypes vocabulary codes ([] clears precautions); every code
   must be an ACTIVE entry (unknown → 400, retired → 409 — the
   code-status precedent); unknown fields fail binding */
[System.Text.Json.Serialization.JsonUnmappedMemberHandling(System.Text.Json.Serialization.JsonUnmappedMemberHandling.Disallow)]
record SetIsolationRequest(List<string>? Types);

/* bed registry row incl. derived occupancy — feeds the admission form's
   free-bed picker, transfer target picker, and the bed board layout */
record AdtBedDto(string BedId, string Area, int Seq, bool Active, string? PatientId, string? PatientName,
    string? EncounterId, List<FormularyEventDto> History);

/* POST /adt/beds — add a bed to the registry (bed-registry design §3).
   Add/retire only, NEVER rename (locked decision 2) — hence no edit
   request exists. Seq optional: appended after the area's last bed. */
[System.Text.Json.Serialization.JsonUnmappedMemberHandling(System.Text.Json.Serialization.JsonUnmappedMemberHandling.Disallow)]
record CreateBedRequest(string? BedId, string? Area, int? Seq = null);

record BedSeedDto(string BedId, string Area);

/* REQUEST DTOs — Disallow: an unrecognized field fails binding → automatic
   400, never a silent no-op (codified patient-safety rule) */
/* STRUCTURED IDENTITY (the validator's design): admission captures the
   five name parts — nameFirst/nameSecond/nameFamily REQUIRED,
   nameThird/nameFourth optional — plus the OPTIONAL national identity
   number (as on the card). The legacy single `name` field is RETIRED
   from this request (Disallow → automatic 400): a new admission always
   states the structured legal name; unidentified patients use the same
   fields, named "unknown" by the admitting user (no special mode).
   THE MRN IS RETIRED FROM THIS REQUEST TOO (auto-generated MRN — the
   #113 flag resolved by the owner): the MRN is the HOSPITAL'S OWN
   record number — the hospital assigns it, the patient doesn't bring
   one (the patient brings a national identity number, which has its
   own field). A typed MRN is exactly how P-1191 ended up with his
   national ID in the MRN slot. Aurora now GENERATES the MRN at patient
   creation (AdtLogic.NextMrn — the seeded MRN-###### format, unique);
   a payload carrying `mrn` fails binding → automatic 400.
   RE-ADMISSION, which the typed MRN used to key, is now the OPTIONAL
   patientId: the existing patient re-admitted under a NEW encounter —
   their stored identity (and their MRN) stands; identity fields are
   optional on that path (provided names never overwrite — the recorded
   #113 rule; a provided dateOfBirth/nationalId still completes-or-409s
   exactly as before). */
[System.Text.Json.Serialization.JsonUnmappedMemberHandling(System.Text.Json.Serialization.JsonUnmappedMemberHandling.Disallow)]
record AdmitRequest(
    string? PatientId, string? NameFirst, string? NameSecond, string? NameThird, string? NameFourth,
    string? NameFamily, string? NationalId,
    int? Age, string? DateOfBirth, string? Sex, string? Allergies,
    string? Diagnosis, string? Attending, string? BedId,
    /* Weight & Height capture — OPTIONAL at admission by design (if
       omitted, a clinician adds them later on the patient record) */
    double? WeightKg = null, double? HeightCm = null,
    /* Code status — OPTIONAL at admission on the same rule (selected
       from the ACTIVE vocabulary, never typed; omitted = honestly NOT
       RECORDED until a physician sets it — never a default) */
    string? CodeStatusCode = null,
    /* Patient file number (Locale/File-Number §2) — the hospital's own
       chart number, OPTIONAL and typed as recorded. NOT the MRN and not
       a replacement for it: the MRN member stays retired from this
       request (Disallow → a typed `mrn` still fails binding, the #116
       hole stays closed). Unique when present; a re-admission may
       complete an absent value but never silently contradict a recorded
       one (the nationalId rule). */
    string? FileNumber = null);

/* PUT /adt/patients/{id}/identity — the audited identity-correction path
   (§3, REQUIRED by the unknown-patient decision): correcting the name
   requires the COMPLETE structured set (first/second/family — the form
   pre-fills current values); nationalId and dateOfBirth correct
   independently; reason is always required. Amend never erase — every
   correction appends to the patient's identity history.
   THE MRN IS CORRECTABLE HERE TOO (the #116 flag resolved by the owner):
   #116 retired the MRN as the re-admission linking key (re-admission
   keys on an explicit patientId), so the MRN is purely a display
   identifier — correcting one no longer changes who a future
   re-admission attaches to, which is what made this safe to build.
   A typed `mrn` must use the canonical MRN-###### format (free-form
   record numbers are exactly the class of error this path exists to
   remove — P-1191's national ID in the MRN slot); `regenerateMrn`
   instead has Aurora assign a fresh unique canonical number
   (AdtLogic.NextMrn — the #116 generator, no fork). Exactly one of the
   two; a corrected MRN must be unique against every existing MRN; the
   previous value is preserved in the history diff. NEVER silent — every
   MRN change is deliberate, reasoned and audited. */
[System.Text.Json.Serialization.JsonUnmappedMemberHandling(System.Text.Json.Serialization.JsonUnmappedMemberHandling.Disallow)]
record CorrectIdentityRequest(
    string? NameFirst, string? NameSecond, string? NameThird, string? NameFourth,
    string? NameFamily, string? NationalId, string? DateOfBirth, string? Reason,
    string? Mrn = null, bool? RegenerateMrn = null,
    /* the file number corrects independently like the national ID —
       unique against every other patient, clearing refused (amend never
       erase), previous value preserved in the history diff */
    string? FileNumber = null);

/* POST /adt/patients/match — PATIENT IDENTITY MATCH (the match+overview
   design §1-2): the on-submit duplicate check that runs BEFORE anything
   is created. POST (not GET), deliberately: the payload carries a
   national identity number, which must never ride a URL into request
   logs. THREE TIERS, honestly graded:
   - Tier A (mrn / nationalId): both unique → an exact hit is CONFIRMED.
   - Tier B (the three REQUIRED name parts + dateOfBirth): PROBABILISTIC
     — exact parts (case-insensitive: a case difference is data-entry
     noise, not a different person; fuzzy/phonetic stays out per #113),
     exact DOB. Third/Fourth names are deliberately NOT matched — they
     are optional fields and optional fields cannot be required.
   - Tier C (unknown patients) EXCLUDED by construction: Tier B compares
     the STORED DateOfBirth, and an unidentified patient has none (the
     estimated-age row — DateOfBirth null, ageSource
     recordedAtAdmission). No flag, no name-text matching, no special
     mode: they re-enter matching once identity correction records a
     real DOB or a national ID. Legacy single-name rows likewise match
     on mrn/nationalId only (no structured parts to compare). */
[System.Text.Json.Serialization.JsonUnmappedMemberHandling(System.Text.Json.Serialization.JsonUnmappedMemberHandling.Disallow)]
record MatchPatientRequest(
    string? Mrn, string? NationalId,
    string? NameFirst, string? NameSecond, string? NameFamily, string? DateOfBirth,
    /* the hospital's file number — unique when present, so it is a
       CONFIRMED-tier key like the national ID and the MRN (staff look
       patients up by the number they know — §2.3 searchable) */
    string? FileNumber = null);

/* the match dialog's identity summary card — IDENTITY ONLY (the office
   Administrator sees exactly this; no clinical fields exist here to
   leak). The national ID is masked to its LAST 4 DIGITS SERVER-SIDE —
   the full number never rides to a lookup dialog (deliberately stricter
   than #113's PII default; a "same person?" check needs no more). */
record MatchCardDto(
    string PatientId, string FullName, string Mrn, string? NationalIdLast4,
    int Age, string AgeSource, string Sex,
    string LastAdmission, int AdmissionCount, string Status,
    string? CurrentBedId = null, string? CurrentEncounterId = null,
    /* UNMASKED, deliberately (stated choice): the file number is the
       hospital's own chart label, not state PII like the national ID —
       verifying "same chart?" against the paper record is this card's
       whole job, and a masked chart number cannot do it */
    string? FileNumber = null);

[System.Text.Json.Serialization.JsonUnmappedMemberHandling(System.Text.Json.Serialization.JsonUnmappedMemberHandling.Disallow)]
record TransferRequest(string? BedId);

/* discharge body — OPTIONAL at the API, deliberately (flagged design
   point): the discharge POST took no body for its whole life, and every
   deployed suite's discharge legs AND failure-path cleanups rely on the
   body-less form, so requiring one would break them all. The UI discharge
   flow REQUIRES a disposition; a body-less API discharge records none
   (honest null — see Encounter.Disposition). */
[System.Text.Json.Serialization.JsonUnmappedMemberHandling(System.Text.Json.Serialization.JsonUnmappedMemberHandling.Disallow)]
record DischargeRequest(string? Disposition);

/* PUT /adt/encounters/{id}/measurements — add-if-omitted / correct-with-
   history within the encounter; at least one field required
   (server-validated) */
[System.Text.Json.Serialization.JsonUnmappedMemberHandling(System.Text.Json.Serialization.JsonUnmappedMemberHandling.Disallow)]
record MeasureRequest(double? WeightKg, double? HeightCm);

using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;
using System.Text.Json;
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
    public string Name { get; set; } = "";
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
    /* WEIGHT & HEIGHT (Patient Weight & Height Capture — the clinical
       validator's design): PERSON-LEVEL attributes, not observations —
       ICU patients are not weighed daily, so this is the patient's
       recorded reference weight (dosing, SOFA µg/kg/min), captured at
       admission and addable/correctable later. Units are FIXED: kg / cm.
       FLAGGED MODELLING RESOLUTION (design open item #1 said "patient/
       encounter"): the fields sit on the PATIENT row — the design's own
       §0 calls weight "a patient attribute … simply the patient's
       recorded weight", and height is inherently person-level. A
       re-admission that supplies a different weight UPDATES it with an
       amend event (weight is correctable clinical data — deliberately
       unlike DateOfBirth above, which 409s, because a patient's weight
       legitimately changes between admissions while identity does not).
       Encounter-scoped reference weight is the recorded alternative.
       MeasurementsJson is the amend-not-erase history: every set/change
       records who, when (UTC "yyyy-MM-dd HH:mm" — spans encounters, so
       it carries the date like the Layer-3 user audit), and the prior
       value. Values are never cleared — only corrected. */
    public double? WeightKg { get; set; }
    public double? HeightCm { get; set; }
    public string MeasurementsJson { get; set; } = "[]";

    /* THE canonical identity resolver (the no-fork rule): the roster
       projection, the admissions response, and GET /adt/patients/{id}
       all serve identity through THIS method — one source of truth,
       several entry points, never a parallel assembly of these fields. */
    public PatientDto ToDto()
    {
        var (age, source) = ResolveAge();
        var measurements = JsonSerializer.Deserialize<List<MeasurementEventDto>>(MeasurementsJson, JsonOpts.Web)!;
        return new(PatientId, Mrn, Name, DateOfBirth, age, source, Sex, Allergies,
            WeightKg, HeightCm,
            /* empty history serves as ABSENT (WhenWritingNull) — rows
               without measurements keep their pre-feature wire bytes */
            measurements.Count == 0 ? null : measurements);
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
    public string EventsJson { get; set; } = "[]";

    /* patientName is a denormalized DISPLAY snapshot supplied by the caller
       (same precedent as orders' name/bed snapshots) — identity is never
       redefined here */
    public EncounterDto ToDto(string patientName) => new(
        EncounterId, PatientId, patientName, BedId, Diagnosis, Attending, Status,
        AdmittedAt, AdmittedBy, DischargedAt, DischargedBy,
        JsonSerializer.Deserialize<List<AdtEventDto>>(EventsJson, JsonOpts.Web)!);
}

/* a bed is a PLACE — occupancy is derived from open encounters at read
   time, never stored (locked derived-state rule) */
[Table("Beds")]
class BedRow
{
    [Key]
    public string BedId { get; set; } = "";
    public string Area { get; set; } = "";
    public int Seq { get; set; }
}

/* wire contracts. PatientDto: dateOfBirth is null on legacy rows (never
   fabricated); age is computed-at-read when dateOfBirth exists, else the
   admission-era recorded value; ageSource names which
   ("dateOfBirth" | "recordedAtAdmission").
   weightKg/heightCm/measurements are the Weight & Height capture —
   ADDITIVE nullable tail (WhenWritingNull: rows without them keep their
   pre-feature wire bytes). BMI/IBW/BSA are NEVER served — they are
   derived at render from weight+height (the derived-values discipline:
   Net Balance, GCS Total), and never shown when an input is missing. */
record PatientDto(
    string PatientId, string Mrn, string Name, string? DateOfBirth, int Age,
    string AgeSource, string Sex, string Allergies,
    double? WeightKg = null, double? HeightCm = null,
    List<MeasurementEventDto>? Measurements = null);

/* one amend-not-erase history entry for a weight/height set/change:
   field "weight" | "height"; action "recorded at admission" | "added" |
   "corrected"; prior carries the PREVIOUS value whenever one existed
   (the design's who/when/prior rule — a value that drives dosing is
   never silently overwritten). */
record MeasurementEventDto(
    string Time, string Actor, string Field, string Action, double? Prior, double Value);

record AdtEventDto(string Time, string Actor, string Action, string? Detail);

record EncounterDto(
    string EncounterId, string PatientId, string PatientName, string BedId, string Diagnosis,
    string Attending, string Status, string AdmittedAt, string AdmittedBy, string? DischargedAt,
    string? DischargedBy, List<AdtEventDto> Events);

/* bed registry row incl. derived occupancy — feeds the admission form's
   free-bed picker, transfer target picker, and the bed board layout */
record AdtBedDto(string BedId, string Area, string? PatientId, string? PatientName, string? EncounterId);

record BedSeedDto(string BedId, string Area);

/* REQUEST DTOs — Disallow: an unrecognized field fails binding → automatic
   400, never a silent no-op (codified patient-safety rule) */
[System.Text.Json.Serialization.JsonUnmappedMemberHandling(System.Text.Json.Serialization.JsonUnmappedMemberHandling.Disallow)]
record AdmitRequest(
    string? Mrn, string? Name, int? Age, string? DateOfBirth, string? Sex, string? Allergies,
    string? Diagnosis, string? Attending, string? BedId,
    /* Weight & Height capture — OPTIONAL at admission by design (if
       omitted, a clinician adds them later on the patient record) */
    double? WeightKg = null, double? HeightCm = null);

[System.Text.Json.Serialization.JsonUnmappedMemberHandling(System.Text.Json.Serialization.JsonUnmappedMemberHandling.Disallow)]
record TransferRequest(string? BedId);

/* PUT /adt/patients/{id}/measurements — add-if-omitted / correct-with-
   history; at least one field required (server-validated) */
[System.Text.Json.Serialization.JsonUnmappedMemberHandling(System.Text.Json.Serialization.JsonUnmappedMemberHandling.Disallow)]
record MeasureRequest(double? WeightKg, double? HeightCm);

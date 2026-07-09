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
    public int Age { get; set; }
    public string Sex { get; set; } = "";
    public string Allergies { get; set; } = "";

    public PatientDto ToDto() => new(PatientId, Mrn, Name, Age, Sex, Allergies);
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

/* wire contracts */
record PatientDto(string PatientId, string Mrn, string Name, int Age, string Sex, string Allergies);

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
    string? Mrn, string? Name, int? Age, string? Sex, string? Allergies,
    string? Diagnosis, string? Attending, string? BedId);

[System.Text.Json.Serialization.JsonUnmappedMemberHandling(System.Text.Json.Serialization.JsonUnmappedMemberHandling.Disallow)]
record TransferRequest(string? BedId);

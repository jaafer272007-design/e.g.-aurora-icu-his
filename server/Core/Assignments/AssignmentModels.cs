using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace Aurora.Core.Assignments;

/* ---------- Patient Assignment & Responsibility (Aurora Core) ----------
   The validator's design (docs/design/patient-assignment.md): ONE Core
   concept, two kinds — who is RESPONSIBLE for a patient right now, as a
   WORKLIST and never an authority (meds.administer stays global; a nurse
   responding to an arrest must never be 403'd).

   Locked decisions baked into this model:
   - Patient ⇄ Nurse is MANY-TO-MANY: no 409 on a second nurse — ECMO,
     CRRT, massive transfusion, unstable patients, and briefly three at
     handover are ICU routine, not exceptions. Only re-assigning the SAME
     user+kind while already active is a state conflict.
   - ENCOUNTER-SCOPED and therefore PATIENT-BASED, never bed-based: the
     assignment references the encounter (the aggregate root — exactly as
     orders do), so a bed move for sterilisation or equipment failure
     touches NOTHING here; responsibility follows the patient.
   - UserId references a REAL Users row (Username) — never free text
     (contrast Encounter.Attending, the legacy display string this
     supersedes in meaning; that field is deliberately left alone).
   - Shift is CHOSEN by the assigner, not derived from the clock
     (derivation breaks at boundaries: a nurse arriving 06:45 for
     handover is on the DAY shift). *[Superseded in part by the
     Configuration Vocabularies build (design §3, the validator's
     decision — three-shift ICUs are real): the hardcoded 'day'|'night'
     label is now a CODE from the managed Shifts vocabulary, seeded
     day/night so existing rows stay valid as data. The stored code is
     a SNAPSHOT — retiring a shift never touches existing assignments
     (they keep rendering through the label resolver); only NEW
     assignments are refused it. "No Shift entity exists" is thereby
     superseded: ShiftRow is that entity.]*
   - ENDED, NEVER DELETED (never-destroy): an ended assignment is
     history, not an absence. Every create and end carries actor +
     ACTIVE role (#104) + dated time — the row IS the audit record. */
[Table("PatientAssignments")]
class PatientAssignment
{
    [Key]
    public string AssignmentId { get; set; } = "";
    public int Seq { get; set; }
    public string EncounterId { get; set; } = "";
    /** Users.Username — a real account reference, never free text */
    public string UserId { get; set; } = "";
    public string Kind { get; set; } = "";    // nurse | doctor
    public string Role { get; set; } = "";    // primary | secondary
    public string Shift { get; set; } = "";   // Shifts vocabulary CODE (snapshot, chosen)
    /* audit: who created it, as which ACTIVE role, when (dated UTC
       "yyyy-MM-dd HH:mm"); "" on historical seed rows — facts are never
       invented (the ADT AdmittedAt convention) */
    public string AssignedAt { get; set; } = "";
    public string AssignedBy { get; set; } = "";
    public string AssignedByRole { get; set; } = "";
    /* the END half (null while active): handover, correction, or the
       discharge cascade ("ended at encounter close") */
    public string? EndedAt { get; set; }
    public string? EndedBy { get; set; }
    public string? EndedByRole { get; set; }
    public string? EndReason { get; set; }

    public bool Active => EndedAt is null;
}

/* wire contract. patientId/patientName/bedId are DERIVED at read from the
   encounter (never stored here — the bed especially: a transfer must be
   visible through the assignment without the assignment changing).
   userName/userTitle resolve from the referenced Users row at read —
   the reference is stored, the display is derived (no snapshot to drift). */
record AssignmentDto(
    string AssignmentId, string EncounterId, string PatientId, string PatientName,
    string BedId, string UserId, string UserName, string UserTitle,
    string Kind, string Role, string Shift,
    string AssignedAt, string AssignedBy, string AssignedByRole,
    string? EndedAt = null, string? EndedBy = null, string? EndedByRole = null,
    string? EndReason = null);

/* assignable-staff picker row: active accounts holding a role whose
   profile can carry the kind — Nurse for 'nurse'; Doctor/SeniorDoctor
   for 'doctor'. kinds lists what the account may be assigned AS. */
record AssignableStaffDto(string UserId, string Name, string JobTitle, string[] Kinds);

/* REQUEST DTOs — Disallow: an unrecognized field fails binding → automatic
   400, never a silent no-op (codified patient-safety rule) */
[System.Text.Json.Serialization.JsonUnmappedMemberHandling(System.Text.Json.Serialization.JsonUnmappedMemberHandling.Disallow)]
record CreateAssignmentRequest(
    string? PatientId, string? UserId, string? Kind, string? Role, string? Shift);

[System.Text.Json.Serialization.JsonUnmappedMemberHandling(System.Text.Json.Serialization.JsonUnmappedMemberHandling.Disallow)]
record EndAssignmentRequest(string? Reason);

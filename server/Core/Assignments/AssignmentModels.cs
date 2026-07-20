using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace Aurora.Core.Assignments;

/* ---------- Assignment — the OPT-OUT coverage model (Aurora Core) ----------
   The validator's hands-on clinical correction (Assignment Simplification
   design), REPLACING #114's many-to-many opt-in model:

   - DOCTORS have NO assignment concept at all. Every doctor covers every
     patient — a formal doctor-assignment is a fiction; the doctor view is
     simply "all patients".
   - NURSES cover ALL patients BY DEFAULT (no setup). The persistent
     concept is the EXCEPTION: a REMOVAL takes one patient off one nurse's
     focused worklist (the 1:1 with the crashing patient, the nurse not
     taking the isolation room). Restoring undoes it. Coverage is DERIVED:
     every active Nurse-profile account minus active removals.
   - PRIMARY/SECONDARY: dropped — everyone-covers-everyone needs no
     hierarchy; it is "covering / not covering", nothing more. (A
     primary-nurse concept, if ever wanted, is a later explicit addition —
     recorded.)

   🔴 THE INVARIANT THAT DID NOT CHANGE (asserted in every tier):
   assignment is WORKLIST, never AUTHORITY. A removal changes a nurse's
   focused view, NOT her ability to act — any nurse charts, administers
   and responds on ANY patient (authority is role + licensure; in a crash
   whoever is closest responds regardless of any list). Since this build
   coverage gates NOTHING AT ALL: the #114 SBAR-handoff assignment gate —
   the one scoped exception — is DROPPED by the owner's decision.

   🔴 NEVER ZERO NURSES (the hard guarantee, owner's decision — prevent,
   not warn): removing the LAST covering nurse from a patient is refused
   409. A patient always has coverage; the system does not allow an
   uncovered patient to exist.

   MIGRATION HONESTY: the #114 PatientAssignments table and every row are
   KEPT as the permanent audit record (readable via /assignments/history);
   boot ends any still-active row with the supersede reason. The new model
   starts from everyone-covered (an empty removals table). */

/** ONE carved exception: this nurse is NOT covering this encounter.
    Restored-never-deleted (the ended-never-deleted convention) — the row
    is the audit record of both halves. */
[Table("AssignmentRemovals")]
class AssignmentRemoval
{
    [Key]
    public string RemovalId { get; set; } = "";
    public int Seq { get; set; }
    /** encounter-scoped like every clinical record — a re-admission starts
        from the default (covered by everyone) */
    public string EncounterId { get; set; } = "";
    /** Users.Username — a real account reference, never free text */
    public string UserId { get; set; } = "";
    public string RemovedAt { get; set; } = "";
    public string RemovedBy { get; set; } = "";
    public string RemovedByRole { get; set; } = "";
    /** optional — "1:1 with the crashing patient" is routine, not exceptional */
    public string? Reason { get; set; }
    public string? RestoredAt { get; set; }
    public string? RestoredBy { get; set; }
    public string? RestoredByRole { get; set; }

    public bool ActiveRemoval => RestoredAt is null;
}

/* ---------- the LEGACY #114 table — history, never deleted ---------- */

/** the superseded opt-in assignment row. No new rows are ever created;
    boot ended the active ones with the supersede reason. Kept so the
    #114 audit trail (who was assigned, by whom, ended why) stays
    readable forever via GET /assignments/history. */
[Table("PatientAssignments")]
class PatientAssignment
{
    [Key]
    public string AssignmentId { get; set; } = "";
    public int Seq { get; set; }
    public string EncounterId { get; set; } = "";
    public string UserId { get; set; } = "";
    public string Kind { get; set; } = "";    // nurse | doctor
    public string Role { get; set; } = "";    // primary | secondary (historical)
    public string Shift { get; set; } = "";   // Shifts vocabulary code (historical snapshot)
    public string AssignedAt { get; set; } = "";
    public string AssignedBy { get; set; } = "";
    public string AssignedByRole { get; set; } = "";
    public string? EndedAt { get; set; }
    public string? EndedBy { get; set; }
    public string? EndedByRole { get; set; }
    public string? EndReason { get; set; }

    public bool Active => EndedAt is null;
}

/* ---------------- wire contracts ---------------- */

/** one open encounter's derived coverage: who is covering, and the
    removal exceptions (active AND restored — the audit renders inline).
    patient/bed derived from the encounter at read, never stored. */
record CoverageDto(
    string PatientId, string PatientName, string BedId, string EncounterId,
    List<CoveringNurseDto> Nurses, List<RemovalDto> Removals);

record CoveringNurseDto(string UserId, string Name, string JobTitle);

record RemovalDto(
    string RemovalId, string EncounterId, string PatientId, string PatientName,
    string BedId, string UserId, string UserName, string UserTitle,
    string RemovedAt, string RemovedBy, string RemovedByRole, string? Reason,
    string? RestoredAt = null, string? RestoredBy = null, string? RestoredByRole = null);

/** the signed-in clinician's worklist. kind states the model on the wire:
    'nurse' = all open patients minus my removals; 'doctor' = ALL open
    patients (no assignment concept); null = this profile has no worklist.
    removedPatientIds lets the nurse UI say WHY a patient is absent. */
record MineDto(string? Kind, string[] PatientIds, string[] RemovedPatientIds);

/** coverage-manager picker row: the active Nurse-profile accounts
    coverage derives from (doctors have no assignment concept — no kinds
    field survives). */
record CoverageStaffDto(string UserId, string Name, string JobTitle);

/** the LEGACY #114 row on the wire (history read — shape preserved) */
record AssignmentDto(
    string AssignmentId, string EncounterId, string PatientId, string PatientName,
    string BedId, string UserId, string UserName, string UserTitle,
    string Kind, string Role, string Shift,
    string AssignedAt, string AssignedBy, string AssignedByRole,
    string? EndedAt = null, string? EndedBy = null, string? EndedByRole = null,
    string? EndReason = null);

/* REQUEST DTOs — Disallow: an unrecognized field fails binding → automatic
   400, never a silent no-op (codified patient-safety rule) */
[System.Text.Json.Serialization.JsonUnmappedMemberHandling(System.Text.Json.Serialization.JsonUnmappedMemberHandling.Disallow)]
record RemoveNurseRequest(string? PatientId, string? UserId, string? Reason = null);

[System.Text.Json.Serialization.JsonUnmappedMemberHandling(System.Text.Json.Serialization.JsonUnmappedMemberHandling.Disallow)]
record RestoreNurseRequest(string? PatientId, string? UserId);

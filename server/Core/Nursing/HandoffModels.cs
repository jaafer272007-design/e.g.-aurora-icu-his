using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace Aurora.Core.Nursing;

/* ---------- SBAR Shift Handoff (Aurora Core) ----------
   The production-mock audit's data-loss item made real: the Nurse
   Workspace's SBAR card previously "saved" into component state that
   died on navigation — the toast lied. This is the owner's model,
   decided 2026-07-18:

   - APPEND-ONLY SERIES per encounter: every save is a NEW immutable
     entry — the record of what was communicated at THAT handover. No
     edit path exists at all; a correction is simply the next entry
     (the PatientAssignment row-is-the-record shape).
   - STRUCTURED SBAR: the four fields (Situation / Background /
     Assessment / Recommendation) persist as four fields — SBAR is a
     discipline, not free text. At least one must be non-empty.
   - ENCOUNTER-SCOPED (the ORD-113 lesson): the entry references the
     admission it belongs to; a re-admitted patient starts a fresh
     series and the old one stays on its closed encounter.
   - WRITE AUTHORITY: any NURSE (handoff.document) on any patient.
     *[Superseded (Assignment Simplification, owner's decision): the
     original ACTIVE-assignment gate — the one scoped exception to
     worklist-never-authority — is DROPPED. Coverage gates nothing;
     an SBAR post is fully global like charting and administration.]*
     Doctor handoff is a separate, undesigned record — deliberately
     NOT merged into this one.
   - Stamped with author + ACTIVE role (#104) + dated server time
     (#95); the row IS the audit record. */
[Table("Handoffs")]
class HandoffRow
{
    [Key]
    public string HandoffId { get; set; } = "";
    public int Seq { get; set; }
    public string EncounterId { get; set; } = "";
    public string PatientId { get; set; } = "";
    public string S { get; set; } = "";
    public string B { get; set; } = "";
    public string A { get; set; } = "";
    public string R { get; set; } = "";
    /* author: real account reference + display name + the ACTIVE role
       the entry was written under (multi-role lesson, #104) */
    public string RecordedByUser { get; set; } = "";
    public string RecordedBy { get; set; } = "";
    public string RecordedRole { get; set; } = "";
    /* dated UTC "yyyy-MM-dd HH:mm", SERVER-stamped — a handover record
       carries the date (#95) and is never back-dated */
    public string RecordedAt { get; set; } = "";

    public HandoffDto ToDto() => new(HandoffId, EncounterId, PatientId,
        S, B, A, R, RecordedByUser, RecordedBy, RecordedRole, RecordedAt);
}

record HandoffDto(
    string HandoffId, string EncounterId, string PatientId,
    string S, string B, string A, string R,
    string RecordedByUser, string RecordedBy, string RecordedRole, string RecordedAt);

/* request — Disallow: an unrecognized field fails binding → automatic
   400, never a silent no-op (codified patient-safety rule) */
[System.Text.Json.Serialization.JsonUnmappedMemberHandling(System.Text.Json.Serialization.JsonUnmappedMemberHandling.Disallow)]
record WriteHandoffRequest(string? PatientId, string? S, string? B, string? A, string? R);

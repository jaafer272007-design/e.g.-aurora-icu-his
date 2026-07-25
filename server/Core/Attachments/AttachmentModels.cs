using System.ComponentModel.DataAnnotations;
using System.Text.Json.Serialization;

namespace Aurora.Core.Attachments;

/* ---------- File attachments on the patient chart ----------
   Scanned reports, photos of paper notes, outside documents. The storage
   decision (verify-first, 2026-07-25): bytes live IN THE DATABASE as
   base64 text — the hospital-logo precedent generalized — so the one
   nightly pg_dump keeps capturing the ENTIRE hospital record and the
   backup engine needs zero changes: the Attachments table is swept into
   TableCounts/TableDigests automatically (pg_tables enumeration), into
   born-restore-verify, Test Restore and both in-place-restore passes.
   Filesystem storage was rejected because it would silently fall out of
   every backup, every digest and the off-site mirror.

   Base64 TEXT over bytea, deliberately: matches the logo, works on the
   SQLite dev provider unchanged, and the nightly digest hashes each row's
   TEXT rendering — base64 costs 1.33x where bytea's hex rendering costs
   2x, so text is the CHEAPER choice for the digest scan. */

/** One attached file. PATIENT-scoped (outside documents are documents
 *  about the patient, not about one admission); the open encounter at
 *  upload time is stamped when one exists ("" otherwise — e.g. a report
 *  arriving after discharge, the note-addendum precedent). Deliberately
 *  NOT routed through EncounterGuard: late-arriving documentation is a
 *  real clinical case, and the guard's own exemption list (addenda,
 *  acknowledgments, corrections) is exactly this category.
 *  Amend-not-erase: no delete exists; a wrong upload is RETRACTED
 *  (hidden from the chart, bytes + audit retained) on the labs two-tier
 *  correction model. */
public class AttachmentRow
{
    /** ATT-9701+ — the generated block (persistence-aware counter,
     *  the OrderLogic rule; there is no seed block for attachments) */
    [Key] public string AttachmentId { get; set; } = "";
    public string PatientId { get; set; } = "";
    /** the patient's OPEN encounter at upload time, "" when none —
     *  server-derived, never client-supplied (the results convention) */
    public string EncounterId { get; set; } = "";
    /** original file name — free text (#145 rule), length-capped only */
    public string FileName { get; set; } = "";
    /** application/pdf | image/jpeg | image/png — magic-byte verified */
    public string Mime { get; set; } = "";
    public long SizeBytes { get; set; }
    /** sha256 (lowercase hex) of the RAW bytes at upload — the per-row
     *  integrity check (the manifest LogoSha256 idea, generalized);
     *  re-verified on every byte serve */
    public string Sha256 { get; set; } = "";
    public string DataBase64 { get; set; } = "";
    /** optional clinician note about what this is (<= 2000 chars) */
    public string Description { get; set; } = "";
    /** upload stamp, "yyyy-MM-dd HH:mm:ss" UTC — seconds precision
     *  because it is the Tier-1 self-retract window anchor (the
     *  DocumentedAt convention) */
    public string UploadedAt { get; set; } = "";
    public string UploadedBy { get; set; } = "";
    /** the uploader's ACTIVE role at upload (the #104 audit rule) */
    public string UploadedRole { get; set; } = "";
    /** retract = the audited soft-hide; bytes and audit trail remain */
    public bool Retracted { get; set; }
    public string RetractedAt { get; set; } = "";
    public string RetractedBy { get; set; } = "";
    public string RetractReason { get; set; } = "";
    /** append-only audit events (Time, Actor, Action, Detail) — the
     *  per-row EventsJson shape labs/imaging/orders use */
    public string EventsJson { get; set; } = "[]";
}

/* ---------------- wire DTOs ---------------- */

/** list/read shape — NEVER carries DataBase64 (the logo rule: bytes go
 *  through the dedicated byte endpoint only, here always authenticated) */
public record AttachmentDto(string AttachmentId, string PatientId,
    string EncounterId, string FileName, string Mime, long SizeBytes,
    string Sha256, string Description, string UploadedAt, string UploadedBy,
    string UploadedRole, bool Retracted, string RetractedAt,
    string RetractedBy, string RetractReason,
    List<AttachmentEventDto> Events);

public record AttachmentEventDto(string Time, string Actor, string Action, string? Detail);

/** upload — JSON base64 like the logo (no multipart machinery); unknown
 *  fields fail binding (400) */
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public record UploadAttachmentRequest(string? FileName, string? Mime,
    string? DataBase64, string? Description);

/** retract — reason optional on Tier-1 (uploader, 5-minute window),
 *  REQUIRED on Tier-2 (results.correct, the correction convention) */
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public record RetractAttachmentRequest(string? Reason);

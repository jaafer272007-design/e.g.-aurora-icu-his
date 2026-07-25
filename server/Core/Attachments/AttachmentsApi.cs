using System.Security.Claims;
using System.Security.Cryptography;
using System.Text.Json;
using Aurora.Core.Identity;
using Aurora.Core.Persistence;
using Aurora.Core.Shared;
using Microsoft.EntityFrameworkCore;

namespace Aurora.Core.Attachments;

/* ---------- File attachments on the patient chart (endpoints) ----------
   RBAC (the owner's decision, 2026-07-25):
     attachments.view = the chart's CLINICAL tier (every results.view
       holder) — attachments are result-like clinical documents; the
       identity-tier office Administrator is excluded exactly as it is
       from the orders/results/ai panes.
     attachments.add  = the documenting roles: Doctor, SeniorDoctor,
       Nurse, Ancillary (lab/radiology technicians scan outside reports).
     retract          = the labs two-tier correction model verbatim:
       Tier-1 the uploader within 5 minutes (reason optional), Tier-2
       results.correct with reason REQUIRED. No delete exists.

   Limits (env-knob convention): ATTACH_MAX_MB (default 20) per file,
   ATTACH_MAX_TOTAL_MB (default 8192) for the whole corpus — the brake
   that keeps the nightly dump, the born-verify and the 30/12/12 backup
   estate bounded. The upload path's request-body cap is raised
   explicitly in Program.cs (a 20 MB file is ~27 MB as base64 JSON,
   uncomfortably close to Kestrel's 30,000,000-byte default). */
static class AttachmentsApi
{
    public static int MaxAttachMb   => EnvInt("ATTACH_MAX_MB", 20);
    public static int MaxTotalMb    => EnvInt("ATTACH_MAX_TOTAL_MB", 8192);
    public static long MaxAttachBytes => (long)MaxAttachMb * 1024 * 1024;
    public static long MaxTotalBytes  => (long)MaxTotalMb * 1024 * 1024;
    /** the raised request-body cap for the upload endpoint ONLY:
     *  base64 inflates 4/3, plus JSON envelope slack */
    public static long MaxUploadRequestBytes => MaxAttachBytes * 4 / 3 + 1024 * 1024;

    public const int MaxFileNameLength = 200;      // the #145 free-text rule: length cap, no style rules
    public const int MaxDescriptionLength = 2000;  // the shared free-text bound

    static int EnvInt(string name, int fallback) =>
        int.TryParse(Environment.GetEnvironmentVariable(name), out var v) && v > 0 ? v : fallback;

    /* persistence-aware ATT counter (the OrderLogic rule). 9700 block —
       disjoint from every other generated block; attachments have no seeds. */
    static int _seq = 9700;
    public static string NextId() => $"ATT-{System.Threading.Interlocked.Increment(ref _seq)}";
    public static void InitializeCounters(AuroraDb db)
    {
        static int SuffixOf(string id) =>
            int.TryParse(id[(id.IndexOf('-') + 1)..], out var n) ? n : 0;
        _seq = db.Attachments.AsNoTracking().Select(a => a.AttachmentId).AsEnumerable()
            .Select(SuffixOf).Where(n => n >= 9700).DefaultIfEmpty(9700).Max();
    }

    /* the three allowed types, magic-byte verified against the DECLARED
       mime (the logo rule extended with PDF). SVG/HTML are deliberately
       absent: script-capable formats served back into clinicians'
       browsers are a needless XSS surface. */
    static bool MagicMatches(string mime, byte[] b) => mime switch
    {
        "application/pdf" => b.Length > 5 && b[0] == 0x25 && b[1] == 0x50 && b[2] == 0x44 && b[3] == 0x46 && b[4] == 0x2D, // %PDF-
        "image/png"  => b.Length > 8 && b[0] == 0x89 && b[1] == 0x50 && b[2] == 0x4E && b[3] == 0x47,
        "image/jpeg" => b.Length > 3 && b[0] == 0xFF && b[1] == 0xD8 && b[2] == 0xFF,
        _ => false,
    };

    record AttachmentEvent(string Time, string Actor, string Action, string? Detail);

    static string Stamp() => DateTime.UtcNow.ToString("yyyy-MM-dd HH:mm");
    static string AnchorStamp() => DateTime.UtcNow.ToString("yyyy-MM-dd HH:mm:ss");

    static void Append(AttachmentRow a, string actor, string action, string? detail)
    {
        var events = JsonSerializer.Deserialize<List<AttachmentEvent>>(a.EventsJson, JsonOpts.Web)!;
        events.Add(new AttachmentEvent(Stamp(), actor, action, detail));
        a.EventsJson = JsonSerializer.Serialize(events, JsonOpts.Web);
    }

    static AttachmentDto ToDto(AttachmentRow a) => new(
        a.AttachmentId, a.PatientId, a.EncounterId, a.FileName, a.Mime,
        a.SizeBytes, a.Sha256, a.Description, a.UploadedAt, a.UploadedBy,
        a.UploadedRole, a.Retracted, a.RetractedAt, a.RetractedBy,
        a.RetractReason,
        JsonSerializer.Deserialize<List<AttachmentEventDto>>(a.EventsJson, JsonOpts.Web)!);

    /* Tier-1 self-retract: the UPLOADER, inside the flat 5-minute window
       from upload (the ResultsLogic.SelfCorrectWindowMinutes convention) */
    static bool IsSelfTier(AttachmentRow a, string actor, DateTime utcNow) =>
        a.UploadedBy == actor
        && DateTime.TryParseExact(a.UploadedAt, "yyyy-MM-dd HH:mm:ss",
               System.Globalization.CultureInfo.InvariantCulture,
               System.Globalization.DateTimeStyles.None, out var uploaded)
        && (utcNow - uploaded) <= TimeSpan.FromMinutes(Aurora.Core.LabImaging.ResultsLogic.SelfCorrectWindowMinutes);

    public static void Map(WebApplication app)
    {
        /* ---- list (metadata only, NEVER bytes) — attachments.view ---- */
        app.MapGet("/api/icu/patients/{patientId}/attachments",
            (string patientId, ClaimsPrincipal user, AuroraDb db) =>
        {
            if (Rbac.Deny(user, "attachments.view") is IResult denied) return denied;
            if (!db.AdtPatients.AsNoTracking().Any(p => p.PatientId == patientId))
                return ApiError.NotFound();
            var rows = db.Attachments.AsNoTracking()
                .Where(a => a.PatientId == patientId).AsEnumerable()
                .OrderByDescending(a => a.UploadedAt).Select(ToDto).ToList();
            return Results.Json(rows, JsonOpts.Web);
        }).RequireAuthorization();

        /* ---- upload — attachments.add (a clinical write, audited).
           Deliberately NOT EncounterGuard'ed: outside documents arrive
           after discharge (the note-addendum exemption category); the
           open encounter is stamped when one exists. ---- */
        app.MapPost("/api/icu/patients/{patientId}/attachments",
            (string patientId, UploadAttachmentRequest req, ClaimsPrincipal user, AuroraDb db) =>
        {
            if (Rbac.Deny(user, "attachments.add") is IResult denied) return denied;
            if (!db.AdtPatients.AsNoTracking().Any(p => p.PatientId == patientId))
                return ApiError.NotFound();

            var fileName = (req.FileName ?? "").Trim();
            if (fileName.Length == 0) return ApiError.BadRequest("fileName is required");
            if (fileName.Length > MaxFileNameLength)
                return ApiError.BadRequest($"fileName exceeds {MaxFileNameLength} characters");
            var description = (req.Description ?? "").Trim();
            if (description.Length > MaxDescriptionLength)
                return ApiError.BadRequest($"description exceeds {MaxDescriptionLength} characters");

            var mime = (req.Mime ?? "").Trim().ToLowerInvariant();
            if (mime is not ("application/pdf" or "image/png" or "image/jpeg"))
                return ApiError.BadRequest("attachments must be application/pdf, image/png or image/jpeg");
            if (string.IsNullOrWhiteSpace(req.DataBase64))
                return ApiError.BadRequest("dataBase64 is required (the file content, base64-encoded)");
            byte[] bytes;
            try { bytes = Convert.FromBase64String(req.DataBase64); }
            catch (FormatException) { return ApiError.BadRequest("dataBase64 is not valid base64"); }
            if (bytes.Length == 0) return ApiError.BadRequest("the file is empty");
            if (bytes.Length > MaxAttachBytes)
                return ApiError.BadRequest(
                    $"the file is {bytes.Length / (1024 * 1024)} MB - the attachment limit is {MaxAttachMb} MB (ATTACH_MAX_MB)");
            if (!MagicMatches(mime, bytes))
                return ApiError.BadRequest($"the file bytes are not {mime} - the declared type must match the actual content");

            /* the corpus brake: every byte here lands in the nightly dump
               and in ~54 retained backup copies. 409 (state, not
               permission): the same request succeeds after the operator
               raises ATTACH_MAX_TOTAL_MB or retires data. */
            var totalBytes = db.Attachments.AsNoTracking()
                .Sum(a => (long?)a.SizeBytes) ?? 0L;
            if (totalBytes + bytes.Length > MaxTotalBytes)
                return ApiError.StateConflict(
                    $"the attachment store is full ({totalBytes / (1024 * 1024)} of {MaxTotalMb} MB used). " +
                    "Every attachment is carried inside every database backup, so this cap protects the backup " +
                    "chain. Hospital IT can raise ATTACH_MAX_TOTAL_MB in aurora.env after checking backup disk space.");

            var actor = user.FindFirst("name")?.Value ?? "Unknown";
            var role  = Rbac.ProfileOf(user.FindFirst("jobTitle")?.Value ?? "") ?? "Unknown";
            var openEnc = db.Encounters.AsNoTracking()
                .FirstOrDefault(e => e.PatientId == patientId && e.Status == "open");

            var row = new AttachmentRow
            {
                AttachmentId = NextId(),
                PatientId = patientId,
                EncounterId = openEnc?.EncounterId ?? "",
                FileName = fileName,
                Mime = mime,
                SizeBytes = bytes.Length,
                Sha256 = Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant(),
                DataBase64 = Convert.ToBase64String(bytes),
                Description = description,
                UploadedAt = AnchorStamp(),
                UploadedBy = actor,
                UploadedRole = role,
            };
            Append(row, actor, "uploaded",
                $"{fileName} ({mime}, {Math.Max(1, bytes.Length / 1024)} KB, sha256 {row.Sha256[..8]}, role {role})");
            db.Attachments.Add(row);
            db.SaveChanges();
            return Results.Json(ToDto(row), JsonOpts.Web);
        }).RequireAuthorization();

        /* ---- bytes — attachments.view; ALWAYS authenticated (unlike the
           anonymous logo: this is PHI). Serves inline (images/PDF render
           in the browser tab); integrity re-checked against the stored
           sha256 on every serve; retracted bytes answer 409. ---- */
        app.MapGet("/api/icu/attachments/{attachmentId}/bytes",
            (string attachmentId, HttpContext ctx, ClaimsPrincipal user, AuroraDb db) =>
        {
            if (Rbac.Deny(user, "attachments.view") is IResult denied) return denied;
            var a = db.Attachments.AsNoTracking().FirstOrDefault(x => x.AttachmentId == attachmentId);
            if (a is null) return ApiError.NotFound();
            if (a.Retracted)
                return ApiError.StateConflict("this attachment was retracted - its content is no longer served (the audit trail remains on the chart's hidden list)");
            var bytes = Convert.FromBase64String(a.DataBase64);
            var sha = Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();
            if (sha != a.Sha256)
                return ApiError.StateConflict("integrity check failed - the stored bytes no longer match their recorded sha256; do NOT trust this file, and check the database (a restore drill verifies attachments end-to-end)");
            ctx.Response.Headers["X-Content-Type-Options"] = "nosniff";
            ctx.Response.Headers["Content-Disposition"] =
                $"inline; filename=\"{Uri.EscapeDataString(a.FileName)}\"";
            return Results.File(bytes, a.Mime);
        }).RequireAuthorization();

        /* ---- retract — the audited soft-hide (no delete exists).
           Tier-1: the uploader, within the 5-minute window (reason
           optional). Tier-2: results.correct (Consultant tier), reason
           REQUIRED — the labs correction convention verbatim. ---- */
        app.MapPost("/api/icu/attachments/{attachmentId}/retract",
            (string attachmentId, RetractAttachmentRequest req, ClaimsPrincipal user, AuroraDb db) =>
        {
            var a = db.Attachments.FirstOrDefault(x => x.AttachmentId == attachmentId);
            if (a is null) return ApiError.NotFound();
            if (a.Retracted)
                return ApiError.StateConflict("this attachment is already retracted");

            var actor = user.FindFirst("name")?.Value ?? "Unknown";
            var reason = (req.Reason ?? "").Trim();
            if (reason.Length > MaxDescriptionLength)
                return ApiError.BadRequest($"reason exceeds {MaxDescriptionLength} characters");
            string tier;
            if (IsSelfTier(a, actor, DateTime.UtcNow))
            {
                if (Rbac.Deny(user, "attachments.add") is IResult deniedSelf) return deniedSelf;
                tier = "self";
            }
            else
            {
                if (Rbac.Deny(user, "results.correct") is IResult deniedTier) return deniedTier;
                if (reason.Length == 0)
                    return ApiError.BadRequest("reason is required for a Consultant-tier retraction (outside the 5-minute self-retract window or on another clinician's upload)");
                tier = "consultant";
            }

            a.Retracted = true;
            a.RetractedAt = Stamp();
            a.RetractedBy = actor;
            a.RetractReason = reason;
            Append(a, actor, "retracted",
                reason.Length > 0 ? $"tier {tier}: {reason}" : $"tier {tier}");
            db.SaveChanges();
            return Results.Json(ToDto(a), JsonOpts.Web);
        }).RequireAuthorization();
    }
}

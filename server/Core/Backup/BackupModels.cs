using System.Text.Json.Serialization;

namespace Aurora.Core.Backup;

/* Backup & Disaster Recovery (BACKUP_DR_DESIGN.md) — the hard go-live
   gate. These are the persistence + wire shapes for the backup engine:
   the immutable audit row every backup/DR operation MUST write (design
   §5 — no backup or restore operation without an audit trail), and the
   UNENCRYPTED manifest that rides beside every encrypted backup file
   (design §3 — TZ and the source record counts travel outside the
   ciphertext so a restore can verify itself and the restored machine
   keeps the hospital clock). */

/** Immutable audit of every backup/DR operation (design §5). APPEND-ONLY
 *  by construction: no update or delete endpoint exists anywhere, and the
 *  API surface only ever inserts + reads. Lives in the SAME database as
 *  the clinical record, so the backup audit trail is itself captured by
 *  every backup. */
public class BackupEventRow
{
    public int Id { get; set; }
    /** "yyyy-MM-dd HH:mm:ss" UTC — the storage convention every stamp uses */
    public string At { get; set; } = "";
    /** backup | verify | test-restore | restore | prune | key-rotation |
     *  usb-copy | failure | cancel */
    public string Kind { get; set; } = "";
    /** success | failed */
    public string Outcome { get; set; } = "";
    /** the authenticated username, or "scheduled-task" / "cli" for
     *  unattended runs — "who restored, when" is legally required */
    public string Actor { get; set; } = "";
    /** the backup file this event concerns ("" for prune/key events) */
    public string File { get; set; } = "";
    /** free-form JSON detail: sizes, counts, reasons, keyIds, pruned lists */
    public string DetailJson { get; set; } = "{}";
}

/** The UNENCRYPTED sidecar manifest (aurora-<stamp>.manifest.json).
 *  Deliberately outside the ciphertext: it carries NO clinical data —
 *  only structural facts a restore needs BEFORE decryption (which key,
 *  what to expect) and the hospital TZ (design §3: not a secret; the
 *  restored machine shows the same clock). The SOURCE record counts and
 *  per-table content digests recorded here at dump time are what the
 *  restore acceptance test compares against (design §8). */
public class BackupManifest
{
    public int FormatVersion { get; set; } = 1;
    public string File { get; set; } = "";
    public string CreatedAtUtc { get; set; } = "";
    /** IANA zone of the source machine (TZ env) — #140's hospital clock */
    public string TimeZone { get; set; } = "";
    public string AppBuild { get; set; } = "";
    public string DbName { get; set; } = "";
    /** first 8 hex of SHA256(key) — names WHICH recorded key this backup
     *  needs without revealing anything about it */
    public string KeyId { get; set; } = "";
    public long EncryptedSizeBytes { get; set; }
    public long PlaintextSizeBytes { get; set; }
    /** sha256 of the encrypted file — transport integrity WITHOUT the key
     *  (USB bit-rot check); GCM's tag authenticates WITH the key */
    public string EncryptedSha256 { get; set; } = "";
    /** sha256 of the plaintext dump — proves decrypt reproduced the exact
     *  bytes pg_dump wrote */
    public string PlaintextSha256 { get; set; } = "";
    /** per-table row counts at dump time — the source side of the
     *  source-vs-restored comparison */
    public Dictionary<string, long> TableCounts { get; set; } = [];
    /** per-table deterministic content digests (md5 over ordered row
     *  digests) — the integrity side of the comparison */
    public Dictionary<string, string> TableDigests { get; set; } = [];
    /** the hospital logo's sha256 at dump time ("" when no logo) — the
     *  named binary-asset integrity check (design §8: images/attachments) */
    public string LogoSha256 { get; set; } = "";
}

/* ---------------- wire DTOs (the Backup area) ---------------- */

public record BackupStatusDto(
    string Health,               // ok | stale | failed | none
    string HealthDetail,         // the loud message when not ok
    string? LastSuccessAt,       // UTC stamp of the newest successful backup
    string? LastOutcome,         // success | failed (newest attempt)
    string? NextScheduled,       // computed from BACKUP_SCHEDULE in hospital TZ
    string Schedule,             // the configured cadence string
    int BackupCount,             // files currently in the primary target
    long TotalBytes,             // their total size
    RetentionDto Retention,
    ExternalDiskDto ExternalDisk,
    string KeyId,                // the CURRENT key's id ("" = no key yet)
    string BackupDir);

public record RetentionDto(int DailyKeep, int WeeklyKeep, int MonthlyKeep,
    int DailyHeld, int WeeklyHeld, int MonthlyHeld);

/** the external USB target is a HOST-side path the container cannot see —
 *  its status is reported honestly from the audit trail (the scheduled
 *  task records every usb-copy outcome), never fabricated from a probe
 *  this process cannot make */
public record ExternalDiskDto(string? LastCopyAt, string? LastOutcome, string? Detail);

public record BackupHistoryRow(string File, string CreatedAtUtc, long SizeBytes,
    string KeyId, string TimeZone, int TableCount, long RowTotal,
    string? LastVerifiedAt, string? LastVerifyKind);

public record BackupEventDto(int Id, string At, string Kind, string Outcome,
    string Actor, string File, string DetailJson);

public record VerifyRequest(string File, [property: JsonIgnore(Condition = JsonIgnoreCondition.Never)] string? Key);
public record TestRestoreRequest(string File);

public record CheckResult(string Check, bool Ok, string Detail);

public record VerifyResultDto(string File, bool Ok, List<CheckResult> Checks);

public record TableComparison(string Table, long SourceCount, long RestoredCount,
    bool CountMatch, bool DigestMatch);

public record TestRestoreResultDto(string File, bool Ok, string ScratchDb,
    List<TableComparison> Tables, List<CheckResult> Checks, string Summary);

public record RotateKeyResultDto(string NewKeyId, string OldKeyId,
    /** shown EXACTLY ONCE — the caller displays it for the operator to
     *  record into the envelope/password-manager/management copies; it is
     *  never retrievable again through any endpoint */
    string KeyHexShownOnce);

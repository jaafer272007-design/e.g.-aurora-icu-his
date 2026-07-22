using System.Diagnostics;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Aurora.Core.Persistence;
using Aurora.Core.Shared;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace Aurora.Core.Backup;

/* The backup engine (BACKUP_DR_DESIGN.md) — ONE implementation shared by
   the nightly scheduled task (CLI verbs via `docker exec`), the
   System-Administrator Backup area (API), and the bare-machine
   restore.ps1 (decrypt/verify verbs via `docker run`).

   THE CENTERPIECE (design §, and PR #62's rule carried forward): a backup
   that has never been restored is a hope. Every backup this engine
   produces is BORN RESTORE-VERIFIED — the dump is restored into a scratch
   database before the backup is declared successful, and the manifest's
   source record counts + per-table digests are taken FROM THAT RESTORED
   COPY, so they are exactly what the dump contains (immune to live-write
   drift between dump and count) and restorability is proven on every
   single run, not just at go-live.

   MECHANISM (design §2, verified): pg_dump --format=custom over the
   compose network — MVCC-consistent while Aurora keeps running, and the
   logical custom-format dump restores on ANY fresh machine. pg_dump/
   pg_restore 16 are installed in this image (PGDG client tools), so the
   Windows host needs no Postgres install and the scheduled task is just
   `docker exec`.

   ENCRYPTION (design §1/§4): AES-256-GCM — authenticated encryption; a
   tampered, truncated, or wrong-key backup fails the 16-byte tag with a
   loud CryptographicException, structurally incapable of silent garbage.
   File format: "AURBK1\0" magic · 8-hex keyId · 12-byte nonce · 16-byte
   tag · ciphertext. The keyId (first 8 hex of SHA256(key)) names WHICH
   recorded key a backup needs without revealing anything about the key.

   POSTGRES-ONLY by design: backups protect the durable hospital record.
   The ephemeral SQLite demo mode has nothing durable to protect — every
   verb refuses loudly there instead of pretending. */
public static class BackupService
{
    static readonly byte[] Magic = "AURBK1\0"u8.ToArray();
    const int NonceSize = 12, TagSize = 16, KeyIdLen = 8;

    public static string BackupDir =>
        Environment.GetEnvironmentVariable("BACKUP_DIR") ?? "/backups";
    public static string KeyFile =>
        Environment.GetEnvironmentVariable("BACKUP_KEY_FILE") ?? "/secrets/backup.key";
    public static string Schedule =>
        Environment.GetEnvironmentVariable("BACKUP_SCHEDULE") ?? "daily 02:00";
    public static int KeepDaily => EnvInt("BACKUP_KEEP_DAILY", 30);
    public static int KeepWeekly => EnvInt("BACKUP_KEEP_WEEKLY", 12);
    public static int KeepMonthly => EnvInt("BACKUP_KEEP_MONTHLY", 12);
    static int EnvInt(string name, int fallback) =>
        int.TryParse(Environment.GetEnvironmentVariable(name), out var v) && v > 0 ? v : fallback;

    static string DatabaseUrl => Environment.GetEnvironmentVariable("DATABASE_URL")
        ?? throw new InvalidOperationException(
            "DATABASE_URL is not set — backups protect the durable Postgres record; " +
            "the ephemeral SQLite demo mode has nothing durable to back up.");

    static string NowStamp() => DateTime.UtcNow.ToString("yyyy-MM-dd HH:mm:ss");

    /* ---------------- key handling (design §4) ---------------- */

    public static bool KeyExists() => File.Exists(KeyFile);

    public static byte[] LoadKey(string? suppliedHex = null)
    {
        var hex = suppliedHex ?? (KeyExists()
            ? File.ReadAllText(KeyFile).Trim()
            : throw new InvalidOperationException(
                $"No backup key at {KeyFile} — run init-key first. An encrypted backup " +
                "without its key is NO backup; the key must exist before the first backup."));
        if (hex.Length != 64 || !hex.All(Uri.IsHexDigit))
            throw new InvalidOperationException(
                "The key must be exactly 64 hex characters (AES-256). Check for missing " +
                "characters or line breaks from the recorded copy.");
        return Convert.FromHexString(hex);
    }

    public static string KeyIdOf(byte[] key) =>
        Convert.ToHexString(SHA256.HashData(key))[..KeyIdLen].ToLowerInvariant();

    public static string CurrentKeyId() =>
        KeyExists() ? KeyIdOf(LoadKey()) : "";

    /** Generates the key. The RETURNED hex is displayed EXACTLY ONCE by the
     *  caller for the operator to record into the sealed envelope +
     *  password manager + hospital-management copies (design §4: never
     *  only on-server — the server's death loses this file's copy). */
    public static (string keyHex, string keyId) InitKey(bool force = false)
    {
        if (KeyExists() && !force)
            throw new InvalidOperationException(
                $"A backup key already exists at {KeyFile}. Use rotate-key to replace it " +
                "(old backups still need the OLD key — keep every recorded envelope).");
        var key = RandomNumberGenerator.GetBytes(32);
        var hex = Convert.ToHexString(key).ToLowerInvariant();
        Directory.CreateDirectory(Path.GetDirectoryName(KeyFile)!);
        File.WriteAllText(KeyFile, hex + "\n");
        return (hex, KeyIdOf(key));
    }

    /** Rotation replaces the SERVER key for FUTURE backups; every backup
     *  already on disk still needs the key it was encrypted with (its
     *  manifest + header name that keyId) — the audit note says so out
     *  loud because destroying an old envelope after rotation is how
     *  hospitals silently lose their old backups. */
    public static RotateKeyResultDto RotateKey(string actor)
    {
        var oldId = CurrentKeyId();
        var (hex, id) = InitKey(force: true);
        Audit("key-rotation", "success", actor, "", new
        {
            oldKeyId = oldId, newKeyId = id,
            note = "backups made before this moment still need the OLD key — keep every recorded envelope",
        });
        return new RotateKeyResultDto(id, oldId, hex);
    }

    /* ---------------- AES-256-GCM (design §1: authenticated) ------------- */

    static void EncryptFile(string plainPath, string encPath, byte[] key)
    {
        var plaintext = File.ReadAllBytes(plainPath);
        var nonce = RandomNumberGenerator.GetBytes(NonceSize);
        var cipher = new byte[plaintext.Length];
        var tag = new byte[TagSize];
        using var gcm = new AesGcm(key, TagSize);
        gcm.Encrypt(nonce, plaintext, cipher, tag);
        using var f = File.Create(encPath);
        f.Write(Magic);
        f.Write(Encoding.ASCII.GetBytes(KeyIdOf(key)));
        f.Write(nonce);
        f.Write(tag);
        f.Write(cipher);
    }

    /** Loud on every failure mode: not-a-backup, key-id mismatch (names the
     *  needed key), and GCM tag failure (corrupt or wrong key) — never
     *  silent garbage (design §4). */
    public static void DecryptFile(string encPath, string plainPath, byte[] key)
    {
        var raw = File.ReadAllBytes(encPath);
        if (raw.Length < Magic.Length + KeyIdLen + NonceSize + TagSize
            || !raw.AsSpan(0, Magic.Length).SequenceEqual(Magic))
            throw new InvalidOperationException(
                $"{Path.GetFileName(encPath)} is not an Aurora backup file (bad header).");
        var fileKeyId = Encoding.ASCII.GetString(raw, Magic.Length, KeyIdLen);
        var haveKeyId = KeyIdOf(key);
        if (fileKeyId != haveKeyId)
            throw new InvalidOperationException(
                $"WRONG KEY: this backup was encrypted with key {fileKeyId}, but the supplied " +
                $"key is {haveKeyId}. Find the recorded copy of key {fileKeyId} " +
                "(sealed envelope / password manager / hospital management).");
        var off = Magic.Length + KeyIdLen;
        var nonce = raw.AsSpan(off, NonceSize).ToArray();
        var tag = raw.AsSpan(off + NonceSize, TagSize).ToArray();
        var cipher = raw.AsSpan(off + NonceSize + TagSize).ToArray();
        var plain = new byte[cipher.Length];
        using var gcm = new AesGcm(key, TagSize);
        try { gcm.Decrypt(nonce, cipher, tag, plain); }
        catch (CryptographicException)
        {
            throw new InvalidOperationException(
                "AUTHENTICATION FAILED: the backup is corrupt or the key is wrong. " +
                "Nothing was restored — an unauthenticated backup is never used.");
        }
        File.WriteAllBytes(plainPath, plain);
    }

    public static string HeaderKeyId(string encPath)
    {
        using var f = File.OpenRead(encPath);
        var head = new byte[Magic.Length + KeyIdLen];
        return f.Read(head, 0, head.Length) == head.Length
               && head.AsSpan(0, Magic.Length).SequenceEqual(Magic)
            ? Encoding.ASCII.GetString(head, Magic.Length, KeyIdLen) : "";
    }

    /* ---------------- pg tooling + table inspection ---------------- */

    static void RunPg(string exe, string args, string? stdErrTo = null)
    {
        var psi = new ProcessStartInfo(exe, args)
        { RedirectStandardError = true, RedirectStandardOutput = true };
        using var p = Process.Start(psi)!;
        var err = p.StandardError.ReadToEnd();
        p.WaitForExit();
        if (p.ExitCode != 0)
            throw new InvalidOperationException($"{exe} failed (exit {p.ExitCode}): {err.Trim()}");
        if (stdErrTo != null && err.Length > 0) File.AppendAllText(stdErrTo, err);
    }

    static string ScratchUrl(string scratchDb)
    {
        var uri = new UriBuilder(DatabaseUrl) { Path = "/" + scratchDb };
        return uri.Uri.ToString();
    }

    static NpgsqlConnection Open(string? url = null)
    {
        var c = new NpgsqlConnection(Db.NpgsqlConnectionString(url ?? DatabaseUrl));
        c.Open();
        return c;
    }

    static List<string> Tables(NpgsqlConnection c)
    {
        var list = new List<string>();
        using var cmd = new NpgsqlCommand(
            "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename", c);
        using var r = cmd.ExecuteReader();
        while (r.Read()) list.Add(r.GetString(0));
        return list;
    }

    static long CountOf(NpgsqlConnection c, string table)
    {
        using var cmd = new NpgsqlCommand($"SELECT count(*) FROM \"{table}\"", c);
        return (long)cmd.ExecuteScalar()!;
    }

    /** deterministic per-table content digest — PR #62's V5 mechanism:
     *  md5 over ordered row digests; identical content ⇒ identical digest */
    static string DigestOf(NpgsqlConnection c, string table)
    {
        using var cmd = new NpgsqlCommand(
            $"SELECT coalesce(md5(string_agg(h, '' ORDER BY h)), 'empty') " +
            $"FROM (SELECT md5(t.*::text) AS h FROM \"{table}\" t) s", c);
        return (string)cmd.ExecuteScalar()!;
    }

    static string LogoShaOf(NpgsqlConnection c)
    {
        using var cmd = new NpgsqlCommand("SELECT \"LogoBase64\" FROM \"HospitalIdentity\" LIMIT 1", c);
        var b64 = cmd.ExecuteScalar() as string ?? "";
        return b64.Length == 0 ? ""
            : Convert.ToHexString(SHA256.HashData(Convert.FromBase64String(b64))).ToLowerInvariant();
    }

    static (Dictionary<string, long> counts, Dictionary<string, string> digests, string logoSha)
        Inspect(string url)
    {
        using var c = Open(url);
        var counts = new Dictionary<string, long>();
        var digests = new Dictionary<string, string>();
        foreach (var t in Tables(c)) { counts[t] = CountOf(c, t); digests[t] = DigestOf(c, t); }
        return (counts, digests, Tables(c).Contains("HospitalIdentity") ? LogoShaOf(c) : "");
    }

    /* ---------------- immutable audit (design §5) ---------------- */

    static AuroraDb Ctx() => new(new DbContextOptionsBuilder<AuroraDb>()
        .UseNpgsql(Db.NpgsqlConnectionString(DatabaseUrl)).Options);

    /** Every backup/DR operation writes one of these — the design's hard
     *  rule. Insert failure never silently vanishes: it surfaces on
     *  stderr AND flips the run's status file, because an unaudited
     *  operation is a rule violation someone must see. */
    public static void Audit(string kind, string outcome, string actor, string file, object detail)
    {
        try
        {
            using var db = Ctx();
            db.Set<BackupEventRow>().Add(new BackupEventRow
            {
                At = NowStamp(), Kind = kind, Outcome = outcome, Actor = actor,
                File = file, DetailJson = JsonSerializer.Serialize(detail, JsonOpts.Web),
            });
            db.SaveChanges();
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine(
                $"[backup-audit] FAILED to record {kind}/{outcome} for '{file}': {ex.Message} — " +
                "the operation itself completed, but the audit rule was violated; investigate.");
        }
    }

    /* ---------------- the backup run ---------------- */

    static string TzName => Environment.GetEnvironmentVariable("TZ") ?? "UTC";
    static string BuildStamp => Environment.GetEnvironmentVariable("RENDER_GIT_COMMIT") ?? "dev";

    static string Sha256File(string path) =>
        Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(path))).ToLowerInvariant();

    public static void WriteStatus(string status, string file, string reason = "")
    {
        Directory.CreateDirectory(BackupDir);
        File.WriteAllText(Path.Combine(BackupDir, "LAST_BACKUP_STATUS"),
            JsonSerializer.Serialize(new { status, file, reason, at = NowStamp() }, JsonOpts.Web));
    }

    public static BackupManifest RunBackup(string actor)
    {
        var key = LoadKey(); // fail-fast BEFORE dumping: no key file = no backup
        Directory.CreateDirectory(BackupDir);
        var tmpDir = Path.Combine(BackupDir, ".tmp");
        Directory.CreateDirectory(tmpDir);
        var stamp = DateTime.UtcNow.ToString("yyyyMMdd'T'HHmmss'Z'");
        var name = $"aurora-{stamp}.aurbk";
        var plain = Path.Combine(tmpDir, $"aurora-{stamp}.dump");
        var scratch = $"aurora_rv_{stamp}".ToLowerInvariant();
        try
        {
            // 1 — the consistent portable dump (MVCC snapshot; Aurora keeps running)
            RunPg("pg_dump", $"--format=custom --no-owner --no-acl --file=\"{plain}\" \"{DatabaseUrl}\"");

            // 2 — BORN RESTORE-VERIFIED: restore the dump into a scratch DB
            //     and take the manifest's counts/digests FROM THE RESTORED
            //     COPY (exactly what the dump contains; proves restorability
            //     on every run — the PR #62 centerpiece, kept)
            using (var admin = Open())
            using (var create = new NpgsqlCommand($"CREATE DATABASE {scratch}", admin))
                create.ExecuteNonQuery();
            Dictionary<string, long> counts; Dictionary<string, string> digests; string logoSha;
            try
            {
                RunPg("pg_restore", $"--no-owner --no-acl --exit-on-error -d \"{ScratchUrl(scratch)}\" \"{plain}\"");
                (counts, digests, logoSha) = Inspect(ScratchUrl(scratch));
            }
            finally { DropScratch(scratch); }

            // 3 — encrypt (AES-256-GCM) + sidecars
            var enc = Path.Combine(BackupDir, name);
            EncryptFile(plain, enc, key);
            var manifest = new BackupManifest
            {
                File = name, CreatedAtUtc = NowStamp(), TimeZone = TzName, AppBuild = BuildStamp,
                DbName = new Uri(DatabaseUrl).AbsolutePath.TrimStart('/'), KeyId = KeyIdOf(key),
                EncryptedSizeBytes = new FileInfo(enc).Length,
                PlaintextSizeBytes = new FileInfo(plain).Length,
                EncryptedSha256 = Sha256File(enc), PlaintextSha256 = Sha256File(plain),
                TableCounts = counts, TableDigests = digests, LogoSha256 = logoSha,
            };
            File.WriteAllText(ManifestPath(name), JsonSerializer.Serialize(manifest, new JsonSerializerOptions(JsonOpts.Web) { WriteIndented = true }));
            File.WriteAllText(Path.Combine(BackupDir, name + ".sha256"),
                $"{manifest.EncryptedSha256}  {name}\n");

            // 4 — GFS retention (30/12/12, design §1) + audit + status
            var pruned = GfsPrune(actor);
            WriteStatus("success", name);
            Audit("backup", "success", actor, name, new
            {
                sizeBytes = manifest.EncryptedSizeBytes, tables = counts.Count,
                rows = counts.Values.Sum(), keyId = manifest.KeyId,
                restoreVerifiedAtCreation = true, pruned,
            });
            return manifest;
        }
        catch (Exception ex)
        {
            WriteStatus("failed", name, ex.Message);
            Audit("backup", "failed", actor, name, new { reason = ex.Message });
            throw;
        }
        finally
        {
            if (File.Exists(plain)) File.Delete(plain); // plaintext PHI never lingers
        }
    }

    static void DropScratch(string scratch)
    {
        try
        {
            using var admin = Open();
            using var drop = new NpgsqlCommand($"DROP DATABASE IF EXISTS {scratch} WITH (FORCE)", admin);
            drop.ExecuteNonQuery();
        }
        catch { /* scratch cleanup best-effort; next run uses a fresh name */ }
    }

    public static string ManifestPath(string file) =>
        Path.Combine(BackupDir, Path.GetFileNameWithoutExtension(file) + ".manifest.json");

    public static BackupManifest? ReadManifest(string file)
    {
        var p = ManifestPath(file);
        return File.Exists(p)
            ? JsonSerializer.Deserialize<BackupManifest>(File.ReadAllText(p), JsonOpts.Web) : null;
    }

    public static List<BackupManifest> AllManifests() =>
        !Directory.Exists(BackupDir) ? [] :
        Directory.GetFiles(BackupDir, "aurora-*.manifest.json")
            .Select(p => JsonSerializer.Deserialize<BackupManifest>(File.ReadAllText(p), JsonOpts.Web)!)
            .Where(m => m != null && File.Exists(Path.Combine(BackupDir, m.File)))
            .OrderByDescending(m => m.CreatedAtUtc).ToList();

    /* ---------------- GFS retention 30/12/12 (design §1) ---------------- */

    /** newest-per-day for the last KeepDaily days, newest-per-ISO-week for
     *  the last KeepWeekly weeks, newest-per-month for the last KeepMonthly
     *  months (UTC calendar); everything outside the union is pruned —
     *  audited with the exact list, because silent deletion of a backup is
     *  itself a disaster pattern. */
    public static List<string> GfsPrune(string actor)
    {
        var all = AllManifests();
        if (all.Count == 0) return [];
        var now = DateTime.UtcNow;
        var keep = new HashSet<string>();
        DateTime At(BackupManifest m) => DateTime.Parse(m.CreatedAtUtc + "Z",
            null, System.Globalization.DateTimeStyles.AdjustToUniversal);
        foreach (var g in all.GroupBy(m => At(m).Date))
            if ((now.Date - g.Key).TotalDays < KeepDaily)
                keep.Add(g.OrderByDescending(At).First().File);
        static (int y, int w) IsoWeek(DateTime d) =>
            (System.Globalization.ISOWeek.GetYear(d), System.Globalization.ISOWeek.GetWeekOfYear(d));
        foreach (var g in all.GroupBy(m => IsoWeek(At(m))))
            if ((now.Date - g.Max(m => At(m).Date)).TotalDays < KeepWeekly * 7)
                keep.Add(g.OrderByDescending(At).First().File);
        foreach (var g in all.GroupBy(m => (At(m).Year, At(m).Month)))
            if (((now.Year - g.Key.Year) * 12 + now.Month - g.Key.Month) < KeepMonthly)
                keep.Add(g.OrderByDescending(At).First().File);
        var pruned = new List<string>();
        foreach (var m in all.Where(m => !keep.Contains(m.File)))
        {
            File.Delete(Path.Combine(BackupDir, m.File));
            File.Delete(ManifestPath(m.File));
            var sha = Path.Combine(BackupDir, m.File + ".sha256");
            if (File.Exists(sha)) File.Delete(sha);
            pruned.Add(m.File);
        }
        if (pruned.Count > 0)
            Audit("prune", "success", actor, "", new { pruned, keepDaily = KeepDaily, keepWeekly = KeepWeekly, keepMonthly = KeepMonthly });
        return pruned;
    }

    public static RetentionDto RetentionSummary()
    {
        var all = AllManifests();
        DateTime At(BackupManifest m) => DateTime.Parse(m.CreatedAtUtc + "Z",
            null, System.Globalization.DateTimeStyles.AdjustToUniversal);
        var days = all.Select(m => At(m).Date).Distinct().Count();
        var weeks = all.Select(m => (System.Globalization.ISOWeek.GetYear(At(m)),
            System.Globalization.ISOWeek.GetWeekOfYear(At(m)))).Distinct().Count();
        var months = all.Select(m => (At(m).Year, At(m).Month)).Distinct().Count();
        return new RetentionDto(KeepDaily, KeepWeekly, KeepMonthly,
            Math.Min(days, KeepDaily), Math.Min(weeks, KeepWeekly), Math.Min(months, KeepMonthly));
    }

    /* ---------------- verify (integrity WITHOUT full restore) ------------ */

    public static VerifyResultDto Verify(string file, string? suppliedKeyHex, string actor)
    {
        var checks = new List<CheckResult>();
        void Add(string c, bool ok, string d) => checks.Add(new CheckResult(c, ok, d));
        var enc = Path.Combine(BackupDir, Path.GetFileName(file));
        string? plain = null;
        try
        {
            if (!File.Exists(enc))
            { Add("file", false, $"{file} not found in {BackupDir}"); return Done(); }
            var manifest = ReadManifest(file);
            Add("manifest", manifest != null, manifest != null
                ? $"manifest present ({manifest.TableCounts.Count} tables, {manifest.TableCounts.Values.Sum()} rows recorded)"
                : "manifest sidecar missing — counts cannot be compared");
            var sha = Sha256File(enc);
            if (manifest != null)
                Add("sha256", sha == manifest.EncryptedSha256,
                    sha == manifest.EncryptedSha256 ? "encrypted file matches its recorded sha256"
                    : "ENCRYPTED FILE DOES NOT MATCH its recorded sha256 — transport corruption (USB bit-rot?)");
            byte[] key;
            try { key = LoadKey(suppliedKeyHex); }
            catch (Exception ex) { Add("key", false, ex.Message); return Done(); }
            Add("key", true, suppliedKeyHex != null
                ? $"using the SUPPLIED key (id {KeyIdOf(key)}) — this proves the recorded off-server copy"
                : $"using the server key file (id {KeyIdOf(key)})");
            plain = Path.Combine(BackupDir, ".tmp", Path.GetFileName(file) + ".verify");
            Directory.CreateDirectory(Path.GetDirectoryName(plain)!);
            try { DecryptFile(enc, plain, key); Add("decrypt", true, "AES-256-GCM authentication PASSED — every byte verified"); }
            catch (Exception ex) { Add("decrypt", false, ex.Message); return Done(); }
            if (manifest != null)
            {
                var psha = Sha256File(plain);
                Add("plaintext", psha == manifest.PlaintextSha256,
                    psha == manifest.PlaintextSha256 ? "decrypted dump is byte-identical to the dump pg_dump wrote"
                    : "decrypted bytes differ from the recorded dump hash");
            }
            try
            {
                var psi = new ProcessStartInfo("pg_restore", $"--list \"{plain}\"")
                { RedirectStandardOutput = true, RedirectStandardError = true };
                using var p = Process.Start(psi)!;
                var toc = p.StandardOutput.ReadToEnd();
                p.WaitForExit();
                var tocTables = toc.Split('\n').Count(l => l.Contains(" TABLE public "));
                var ok = p.ExitCode == 0 && tocTables > 0;
                var expect = manifest?.TableCounts.Count;
                if (ok && expect is int e)
                    Add("archive", tocTables == e, $"valid pg_dump archive: {tocTables} tables listed (manifest records {e})");
                else Add("archive", ok, ok ? $"valid pg_dump archive: {tocTables} tables listed" : "pg_restore cannot read this archive");
            }
            catch (Exception ex) { Add("archive", false, ex.Message); }
            return Done();
        }
        finally
        {
            if (plain != null && File.Exists(plain)) File.Delete(plain);
        }
        VerifyResultDto Done()
        {
            var ok = checks.All(c => c.Ok);
            Audit("verify", ok ? "success" : "failed", actor, Path.GetFileName(file),
                new { checks = checks.Select(c => new { c.Check, c.Ok }) });
            return new VerifyResultDto(Path.GetFileName(file), ok, checks);
        }
    }

    /* -------- test restore (isolated scratch — live data untouched) ------ */

    public static TestRestoreResultDto TestRestore(string file, string actor)
    {
        var checks = new List<CheckResult>();
        var tables = new List<TableComparison>();
        var enc = Path.Combine(BackupDir, Path.GetFileName(file));
        var scratch = $"aurora_tr_{DateTime.UtcNow:yyyyMMddHHmmss}".ToLowerInvariant();
        string? plain = null;
        var ok = false; string summary;
        try
        {
            var manifest = ReadManifest(file) ?? throw new InvalidOperationException(
                $"No manifest for {file} — cannot compare counts without the recorded source state.");
            var key = LoadKey();
            plain = Path.Combine(BackupDir, ".tmp", Path.GetFileName(file) + ".tr");
            Directory.CreateDirectory(Path.GetDirectoryName(plain)!);
            DecryptFile(enc, plain, key);
            checks.Add(new CheckResult("decrypt", true, "GCM authentication passed"));
            using (var admin = Open())
            using (var create = new NpgsqlCommand($"CREATE DATABASE {scratch}", admin))
                create.ExecuteNonQuery();
            checks.Add(new CheckResult("scratch", true,
                $"restored into ISOLATED scratch database {scratch} — the live database is never touched"));
            try
            {
                RunPg("pg_restore", $"--no-owner --no-acl --exit-on-error -d \"{ScratchUrl(scratch)}\" \"{plain}\"");
                var (counts, digests, logoSha) = Inspect(ScratchUrl(scratch));
                foreach (var (t, srcCount) in manifest.TableCounts.OrderBy(kv => kv.Key))
                    tables.Add(new TableComparison(t, srcCount, counts.GetValueOrDefault(t, -1),
                        counts.GetValueOrDefault(t, -1) == srcCount,
                        digests.GetValueOrDefault(t, "?") == manifest.TableDigests.GetValueOrDefault(t, "!")));
                var missing = manifest.TableCounts.Keys.Except(counts.Keys).ToList();
                checks.Add(new CheckResult("tables", missing.Count == 0,
                    missing.Count == 0 ? $"all {manifest.TableCounts.Count} source tables present"
                    : $"MISSING tables in the restore: {string.Join(", ", missing)}"));
                checks.Add(new CheckResult("counts", tables.All(t => t.CountMatch),
                    tables.All(t => t.CountMatch)
                        ? $"source-vs-restored record counts MATCH on every table ({tables.Sum(t => t.RestoredCount)} rows)"
                        : "COUNT MISMATCH: " + string.Join("; ", tables.Where(t => !t.CountMatch)
                            .Select(t => $"{t.Table} source={t.SourceCount} restored={t.RestoredCount}"))));
                checks.Add(new CheckResult("integrity", tables.All(t => t.DigestMatch),
                    tables.All(t => t.DigestMatch)
                        ? "per-table content digests IDENTICAL — restored content is byte-equal to the backup"
                        : "DIGEST MISMATCH on: " + string.Join(", ", tables.Where(t => !t.DigestMatch).Select(t => t.Table))));
                checks.Add(new CheckResult("logo", logoSha == manifest.LogoSha256,
                    manifest.LogoSha256 == "" ? "no logo in this backup (none at source)"
                    : logoSha == manifest.LogoSha256 ? "hospital logo bytes survived intact (sha256 match)"
                    : "LOGO bytes differ from the source"));
            }
            finally { DropScratch(scratch); }
            ok = checks.All(c => c.Ok) && tables.All(t => t is { CountMatch: true, DigestMatch: true });
            summary = ok
                ? $"TEST RESTORE PASSED: {tables.Count} tables, {tables.Sum(t => t.RestoredCount)} rows reconstructed and verified — live data untouched."
                : "TEST RESTORE FAILED — treat this backup as suspect until a verified backup succeeds.";
        }
        catch (Exception ex)
        {
            checks.Add(new CheckResult("restore", false, ex.Message));
            summary = $"TEST RESTORE FAILED: {ex.Message}";
        }
        finally
        {
            if (plain != null && File.Exists(plain)) File.Delete(plain);
        }
        Audit("test-restore", ok ? "success" : "failed", actor, Path.GetFileName(file),
            new { tables = tables.Count, rows = tables.Sum(t => t.RestoredCount), scratch });
        return new TestRestoreResultDto(Path.GetFileName(file), ok, scratch, tables, checks, summary);
    }

    /* -------- post-restore verification (restore.ps1's final step) ------- */

    /** Compares the LIVE database against a manifest — run on the RESTORED
     *  machine after restore.ps1 brings Aurora up: the design §8 acceptance
     *  comparison, executed on the new box, and the 'restore' audit event
     *  recorded INTO the restored database ("who restored, when"). */
    public static TestRestoreResultDto VerifyRestoredLive(string manifestPath, string actor)
    {
        var manifest = JsonSerializer.Deserialize<BackupManifest>(
            File.ReadAllText(manifestPath), JsonOpts.Web)!;
        var tables = new List<TableComparison>();
        var checks = new List<CheckResult>();
        var (counts, digests, logoSha) = Inspect(DatabaseUrl);
        foreach (var (t, srcCount) in manifest.TableCounts.OrderBy(kv => kv.Key))
        {
            var restored = counts.GetValueOrDefault(t, -1);
            /* BackupEvents grows on the restored side the moment restore
               events are audited — count must be >= source, digest exempt */
            var growsByAudit = t == "BackupEvents";
            tables.Add(new TableComparison(t, srcCount, restored,
                growsByAudit ? restored >= srcCount : restored == srcCount,
                growsByAudit || digests.GetValueOrDefault(t, "?") == manifest.TableDigests.GetValueOrDefault(t, "!")));
        }
        checks.Add(new CheckResult("counts", tables.All(t => t.CountMatch),
            tables.All(t => t.CountMatch) ? "restored record counts match the backup manifest on every table"
            : "COUNT MISMATCH: " + string.Join("; ", tables.Where(t => !t.CountMatch)
                .Select(t => $"{t.Table} source={t.SourceCount} restored={t.RestoredCount}"))));
        checks.Add(new CheckResult("integrity", tables.All(t => t.DigestMatch),
            tables.All(t => t.DigestMatch) ? "per-table content digests identical"
            : "DIGEST MISMATCH on: " + string.Join(", ", tables.Where(t => !t.DigestMatch).Select(t => t.Table))));
        checks.Add(new CheckResult("logo", logoSha == manifest.LogoSha256,
            manifest.LogoSha256 == "" ? "no logo in this backup"
            : logoSha == manifest.LogoSha256 ? "hospital logo bytes intact" : "LOGO bytes differ"));
        var ok = checks.All(c => c.Ok);
        Audit("restore", ok ? "success" : "failed", actor, manifest.File,
            new { machineRestore = true, tables = tables.Count, rows = counts.Values.Sum() });
        return new TestRestoreResultDto(manifest.File, ok, "(live)", tables, checks,
            ok ? $"RESTORE VERIFIED on this machine: {tables.Count} tables match the backup taken on the source machine."
               : "RESTORE VERIFICATION FAILED — a restore that loses data is a FAILED restore. Do not go live on this data.");
    }

    /* ---------------- status / health (design §6) ---------------- */

    public static BackupStatusDto Status()
    {
        var manifests = AllManifests();
        var newest = manifests.FirstOrDefault();
        string? lastOutcome = null, lastSuccess = newest?.CreatedAtUtc;
        var statusPath = Path.Combine(BackupDir, "LAST_BACKUP_STATUS");
        if (File.Exists(statusPath))
        {
            var s = JsonSerializer.Deserialize<Dictionary<string, string>>(File.ReadAllText(statusPath), JsonOpts.Web)!;
            lastOutcome = s.GetValueOrDefault("status");
        }
        var health = "ok"; var detail = "";
        if (newest == null)
        { health = "none"; detail = "NO BACKUP EXISTS YET. Until the first verified backup succeeds, this hospital's record is one disk failure from gone."; }
        else
        {
            var age = DateTime.UtcNow - DateTime.Parse(newest.CreatedAtUtc + "Z",
                null, System.Globalization.DateTimeStyles.AdjustToUniversal);
            if (age > TimeSpan.FromHours(24))
            { health = "stale"; detail = $"NO SUCCESSFUL BACKUP IN {Math.Floor(age.TotalHours)} HOURS (RPO is 24h). A silently-stopped backup is the classic disaster — check the scheduled task NOW."; }
            else if (lastOutcome == "failed")
            { health = "failed"; detail = "The most recent backup attempt FAILED. The last good backup is intact, but the pipeline needs attention before the 24h RPO is breached."; }
        }
        // external disk status: honestly from the audit trail (see ExternalDiskDto)
        ExternalDiskDto usb;
        try
        {
            using var db = Ctx();
            var last = db.Set<BackupEventRow>().Where(e => e.Kind == "usb-copy")
                .OrderByDescending(e => e.Id).FirstOrDefault();
            usb = last == null ? new ExternalDiskDto(null, null, "no external-disk copy recorded yet")
                : new ExternalDiskDto(last.At, last.Outcome, last.DetailJson);
        }
        catch { usb = new ExternalDiskDto(null, null, "event store unavailable"); }
        return new BackupStatusDto(health, detail, lastSuccess, lastOutcome,
            NextScheduled(), Schedule, manifests.Count,
            manifests.Sum(m => m.EncryptedSizeBytes), RetentionSummary(), usb,
            CurrentKeyId(), BackupDir);
    }

    /** "daily HH:mm" → the next occurrence in the hospital TZ, rendered as
     *  a UTC storage stamp (the client displays it through the one
     *  conversion path like every other stamp) */
    static string? NextScheduled()
    {
        var m = System.Text.RegularExpressions.Regex.Match(Schedule, @"daily (\d{2}):(\d{2})");
        if (!m.Success) return null;
        try
        {
            var tz = TimeZoneInfo.FindSystemTimeZoneById(TzName);
            var nowLocal = TimeZoneInfo.ConvertTimeFromUtc(DateTime.UtcNow, tz);
            var todayRun = nowLocal.Date.AddHours(int.Parse(m.Groups[1].Value)).AddMinutes(int.Parse(m.Groups[2].Value));
            var nextLocal = nowLocal < todayRun ? todayRun : todayRun.AddDays(1);
            return TimeZoneInfo.ConvertTimeToUtc(nextLocal, tz).ToString("yyyy-MM-dd HH:mm:ss");
        }
        catch { return null; }
    }
}

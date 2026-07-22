using System.Text.Json;
using Aurora.Core.Shared;

namespace Aurora.Core.Backup;

/* The operator verbs (BACKUP_DR_DESIGN.md) — the SAME engine the Backup
   area's API uses, invoked as a one-shot process instead of the web
   server:

     docker exec aurora dotnet AuroraIcu.Api.dll backup
       — the nightly Windows Task Scheduler job (appliance/backup.ps1)
     ... verify <file> [--key HEX]        — integrity without a restore
     ... test-restore <file>              — scratch-DB restore proof
     ... decrypt <in> <out> --key HEX     — restore.ps1's bare-machine step
     ... verify-restored <manifest.json>  — restore.ps1's final acceptance
     ... init-key / rotate-key            — the show-once key ceremony
     ... prune / status / audit           — retention, health, usb-copy log

   Dispatched BEFORE the web host's boot gates (see Program.cs): these are
   operator commands, not the serving process — decrypt must work on a
   burned-down machine where APP_ENV/JWT_SECRET do not exist yet. Each
   verb enforces its OWN requirements (DATABASE_URL where a database is
   involved, a key where cryptography is involved) and exits 0/1 loudly. */
public static class BackupCli
{
    static readonly string[] Verbs =
    [
        "backup", "verify", "test-restore", "verify-restored",
        "decrypt", "init-key", "rotate-key", "prune", "status", "audit",
    ];

    public static bool IsBackupVerb(string[] args) =>
        args.Length > 0 && Verbs.Contains(args[0]);

    static string Flag(string[] args, string name, string fallback = "")
    {
        var i = Array.IndexOf(args, name);
        return i >= 0 && i + 1 < args.Length ? args[i + 1] : fallback;
    }

    static string? FlagOrNull(string[] args, string name)
    {
        var v = Flag(args, name);
        return v == "" ? null : v;
    }

    /** positional args = everything after the verb that is not a --flag
     *  or a --flag's value */
    static List<string> Positionals(string[] args)
    {
        var list = new List<string>();
        for (var i = 1; i < args.Length; i++)
        {
            if (args[i].StartsWith("--")) { i++; continue; }
            list.Add(args[i]);
        }
        return list;
    }

    static void PrintChecks(IEnumerable<CheckResult> checks)
    {
        foreach (var c in checks)
            Console.WriteLine($"  [{(c.Ok ? "PASS" : "FAIL")}] {c.Check}: {c.Detail}");
    }

    static void PrintComparison(List<TableComparison> tables)
    {
        if (tables.Count == 0) return;
        Console.WriteLine($"  {"table",-24} {"source",10} {"restored",10}  counts  integrity");
        foreach (var t in tables)
            Console.WriteLine($"  {t.Table,-24} {t.SourceCount,10} {t.RestoredCount,10}  " +
                $"{(t.CountMatch ? "MATCH " : "DIFFER"),-6}  {(t.DigestMatch ? "MATCH" : "DIFFER")}");
    }

    /** The show-once ceremony (design §4). The key is printed HERE and never
     *  again — no endpoint, no log, no file except the ACL-restricted
     *  server copy — so the operator records it NOW or rotates. */
    static void ShowKeyOnce(string keyHex, string keyId)
    {
        Console.WriteLine();
        Console.WriteLine("================================================================");
        Console.WriteLine("  BACKUP ENCRYPTION KEY — SHOWN EXACTLY ONCE. RECORD IT NOW.");
        Console.WriteLine("================================================================");
        Console.WriteLine();
        Console.WriteLine($"  key id : {keyId}");
        Console.WriteLine($"  key    : {keyHex}");
        Console.WriteLine();
        Console.WriteLine("  Record this key in ALL THREE places BEFORE walking away:");
        Console.WriteLine("    1. a SEALED ENVELOPE in the hospital safe");
        Console.WriteLine("    2. the enterprise PASSWORD MANAGER");
        Console.WriteLine("    3. the hospital-management copy");
        Console.WriteLine();
        Console.WriteLine("  The server keeps its own copy for unattended nightly backups —");
        Console.WriteLine("  but the server's death LOSES that copy. If this key exists only");
        Console.WriteLine("  on the server, the backups die with the server. The key is the");
        Console.WriteLine("  second most important thing in the hospital after the patients.");
        Console.WriteLine("================================================================");
        Console.WriteLine();
    }

    public static int Run(string[] args)
    {
        var verb = args[0];
        var actor = Flag(args, "--actor", "cli");
        var pos = Positionals(args);
        try
        {
            switch (verb)
            {
                case "backup":
                {
                    var m = BackupService.RunBackup(actor);
                    Console.WriteLine($"BACKUP OK: {m.File}");
                    Console.WriteLine($"  {m.TableCounts.Count} tables, {m.TableCounts.Values.Sum()} rows — " +
                        "restore-verified at creation (counts and digests taken from a scratch restore of this exact dump)");
                    Console.WriteLine($"  encrypted {m.EncryptedSizeBytes} bytes with key {m.KeyId} (AES-256-GCM)");
                    Console.WriteLine($"  manifest: {BackupService.ManifestPath(m.File)}");
                    return 0;
                }
                case "verify":
                {
                    if (pos.Count < 1) return Usage("verify <file> [--key HEX] [--actor NAME]");
                    var r = BackupService.Verify(pos[0], FlagOrNull(args, "--key"), actor);
                    Console.WriteLine($"VERIFY {(r.Ok ? "PASSED" : "FAILED")}: {r.File}");
                    PrintChecks(r.Checks);
                    return r.Ok ? 0 : 1;
                }
                case "test-restore":
                {
                    if (pos.Count < 1) return Usage("test-restore <file> [--actor NAME]");
                    var r = BackupService.TestRestore(pos[0], actor);
                    Console.WriteLine(r.Summary);
                    PrintChecks(r.Checks);
                    PrintComparison(r.Tables);
                    return r.Ok ? 0 : 1;
                }
                case "verify-restored":
                {
                    if (pos.Count < 1) return Usage("verify-restored <manifest.json> [--actor NAME]");
                    var r = BackupService.VerifyRestoredLive(pos[0], actor);
                    Console.WriteLine(r.Summary);
                    PrintChecks(r.Checks);
                    PrintComparison(r.Tables);
                    return r.Ok ? 0 : 1;
                }
                case "decrypt":
                {
                    if (pos.Count < 2) return Usage("decrypt <in.aurbk> <out.dump> [--key HEX]");
                    var key = BackupService.LoadKey(FlagOrNull(args, "--key"));
                    BackupService.DecryptFile(pos[0], pos[1], key);
                    Console.WriteLine($"DECRYPT OK: AES-256-GCM authentication passed — every byte of " +
                        $"{Path.GetFileName(pos[0])} verified against key {BackupService.KeyIdOf(key)}.");
                    return 0;
                }
                case "init-key":
                {
                    var (hex, id) = BackupService.InitKey(force: args.Contains("--force"));
                    ShowKeyOnce(hex, id);
                    BackupService.Audit("key-rotation", "success", actor, "",
                        new { newKeyId = id, initial = true });
                    return 0;
                }
                case "rotate-key":
                {
                    var r = BackupService.RotateKey(actor);
                    Console.WriteLine($"Key ROTATED: {r.OldKeyId} -> {r.NewKeyId}. Backups made before this " +
                        "moment still need the OLD key — keep every recorded envelope.");
                    ShowKeyOnce(r.KeyHexShownOnce, r.NewKeyId);
                    return 0;
                }
                case "prune":
                {
                    var pruned = BackupService.GfsPrune(actor);
                    Console.WriteLine(pruned.Count == 0
                        ? "PRUNE: nothing outside the 30/12/12 retention — nothing deleted."
                        : $"PRUNE: deleted {pruned.Count} backup(s) outside 30/12/12 retention: {string.Join(", ", pruned)}");
                    return 0;
                }
                case "status":
                {
                    Console.WriteLine(JsonSerializer.Serialize(BackupService.Status(),
                        new JsonSerializerOptions(JsonOpts.Web) { WriteIndented = true }));
                    return 0;
                }
                case "audit":
                {
                    /* the host-side scheduled task records outcomes the container
                       cannot observe itself — the USB robocopy above all
                       (design §1: the off-site disk's status must be REAL) */
                    if (pos.Count < 2) return Usage("audit <kind> <outcome> [--file F] [--detail JSON] [--actor NAME]");
                    BackupService.Audit(pos[0], pos[1], actor, Flag(args, "--file"),
                        JsonSerializer.Deserialize<object>(Flag(args, "--detail", "{}"))!);
                    Console.WriteLine($"AUDIT RECORDED: {pos[0]}/{pos[1]}");
                    return 0;
                }
                default: return Usage(string.Join(" | ", Verbs));
            }
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"{verb} FAILED: {ex.Message}");
            return 1;
        }
    }

    static int Usage(string usage)
    {
        Console.Error.WriteLine($"usage: {usage}");
        return 1;
    }
}

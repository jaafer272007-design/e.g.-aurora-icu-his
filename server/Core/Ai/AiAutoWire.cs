using System.Diagnostics;
using Microsoft.Extensions.Hosting.WindowsServices;

namespace Aurora.Core.Ai;

/* ---------------- ON-BOOT AI SELF-WIRING (the "just works" path) ----------------
   The validator's requirement: a hospital fits an NVIDIA GPU into their Aurora
   server, powers it on, and the AI just works — no commands, no scripts, nothing
   typed. On EVERY boot, before the config is read, this runs the installer's
   aurora-autowire.ps1, which probes the machine (NVIDIA GPU + on-disk AI payload)
   and reconciles the AuroraAI service + aurora.env to match the hardware:
   registering + turning the AI on when a GPU appears, turning it honestly off
   when a GPU is removed, doing nothing when the state already matches. The script
   prints the managed AI_* environment it wants this boot to use; we apply it to
   the process so THIS boot's AiConfig (which latches at AiApi.Map, after
   builder.Build()) sees the freshly-wired state — no restart needed.

   🔴 ZERO DATABASE STATE. The script only registers/removes the AuroraAI service
      and surgically edits the AI_* lines of aurora.env (the execution-proven pure
      transforms). No initdb, no role change, no re-seed, no secret rotation, no
      forced logout. Patient data cannot be affected.

   🔴 FAIL SAFE — this can NEVER stop the HIS from booting. It runs ONLY under the
      Windows Service Control Manager (inert on Docker/Render/dev/CI), the entire
      body is wrapped so nothing propagates, the child process is time-bounded and
      killed if it hangs, and any failure leaves the AI in its previous state while
      Aurora boots normally. "The AI turning itself on must never be able to stop
      the hospital system from running" — so every path here swallows.

   CONTRACT with aurora-autowire.ps1: it prints the managed AI_* set as
   `AUTOWIRE-ENV: KEY=VALUE` lines. If it prints ≥1 line we reconcile ALL managed
   keys (set the emitted ones, clear any managed key it did not emit). If it prints
   0 lines we touch nothing — silence means "no change; leave aurora.env's env".
   See installer/aurora-autowire.ps1. */
public static class AiAutoWire
{
    // The AI_* keys the autowire owns. On an apply, emitted keys are set and the
    // rest are cleared — the same surgical set the .ps1 helpers manage.
    private static readonly string[] ManagedKeys =
        { "AI_PROVIDER", "AI_ENDPOINT", "AI_MODEL", "AI_TIMEOUT_SECONDS", "AI_UNAVAILABLE_REASON" };

    public static void RunAtBoot()
    {
        try
        {
            // Native Windows service ONLY. Everywhere else this is a no-op: Docker,
            // Render, dev and CI never touch a GPU or the SCM.
            if (!OperatingSystem.IsWindows() || !WindowsServiceHelpers.IsWindowsService())
                return;

            var script = Path.Combine(AppContext.BaseDirectory, "scripts", "aurora-autowire.ps1");
            if (!File.Exists(script))
                return;   // no autowire engine shipped → nothing to do

            // AppContext.BaseDirectory is {app}\server\ ; the install root is its parent.
            var installDir = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, ".."));

            var psi = new ProcessStartInfo
            {
                FileName = "powershell.exe",
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardOutput = true,   // stdout only — the AUTOWIRE-ENV lines. Avoids the
                                                 // two-stream fill deadlock; stderr flows to the host.
            };
            psi.ArgumentList.Add("-NoProfile");
            psi.ArgumentList.Add("-ExecutionPolicy");
            psi.ArgumentList.Add("Bypass");
            psi.ArgumentList.Add("-File");
            psi.ArgumentList.Add(script);
            psi.ArgumentList.Add("-InstallDir");
            psi.ArgumentList.Add(installDir);

            using var proc = Process.Start(psi);
            if (proc is null)
                return;

            var stdoutTask = proc.StandardOutput.ReadToEndAsync();
            if (!proc.WaitForExit(90_000))
            {
                // Hung probe/registration must not hold up the hospital system.
                try { proc.Kill(entireProcessTree: true); } catch { /* best effort */ }
                return;   // no output consumed → no change applied → AI stays as aurora.env had it
            }
            var stdout = stdoutTask.GetAwaiter().GetResult();

            Apply(stdout);
        }
        catch
        {
            // Absolute backstop. The AI self-wiring can cost the AI, never the HIS.
        }
    }

    // Parse the AUTOWIRE-ENV lines and reconcile the managed keys onto THIS process.
    // ≥1 line → set emitted, clear the rest. 0 lines → leave the environment alone.
    private static void Apply(string stdout)
    {
        var emitted = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (var raw in stdout.Split('\n'))
        {
            var line = raw.Trim();
            const string marker = "AUTOWIRE-ENV:";
            if (!line.StartsWith(marker, StringComparison.Ordinal))
                continue;
            var kv = line.Substring(marker.Length).Trim();
            var eq = kv.IndexOf('=');
            if (eq <= 0)
                continue;
            var key = kv.Substring(0, eq).Trim();
            var val = kv.Substring(eq + 1);
            if (Array.IndexOf(ManagedKeys, key) >= 0)
                emitted[key] = val;
        }

        if (emitted.Count == 0)
            return;   // NO-OP decision — do not disturb the environment aurora.env loaded

        foreach (var key in ManagedKeys)
        {
            if (emitted.TryGetValue(key, out var val))
                Environment.SetEnvironmentVariable(key, val);
            else
                Environment.SetEnvironmentVariable(key, null);   // clear a managed key the script dropped
        }
    }
}

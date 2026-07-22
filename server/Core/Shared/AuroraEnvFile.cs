namespace Aurora.Core.Shared;

/// <summary>
/// Machine-config parity for the native Windows Service host (installer
/// Option B, HOSPITAL_INSTALLER_RUNTIME_DESIGN.md). In Docker/dev/CI the
/// process environment is populated by compose, the shell, or the CI job. A
/// native Windows Service has no compose to inject env vars, so the installer
/// writes the SAME settings to a machine config file and the service loads
/// them here — into the PROCESS ENVIRONMENT — BEFORE the backup CLI and the
/// boot gates, which read <see cref="System.Environment.GetEnvironmentVariable(string)"/>
/// directly. This is the ONE reader; nothing else changes.
///
/// DOCKER / DEV / CI ARE UNCHANGED: a variable already present in the real
/// environment is NEVER overwritten — the file only fills what the
/// environment does not already provide. A missing file is a silent no-op, so
/// every existing deployment (which sets env vars) behaves exactly as before.
///
/// Path: <c>AURORA_ENV_FILE</c> if set, else <c>aurora.env</c> beside the
/// executable. Format = the same KEY=VALUE `.env` the appliance already uses:
/// one pair per line; blank lines and lines starting with '#' are ignored;
/// the key is trimmed; everything after the FIRST '=' is the value (so a
/// value may itself contain '='); a value wrapped in matching single or
/// double quotes has them stripped.
/// </summary>
public static class AuroraEnvFile
{
    /// <summary>`aurora.env` next to the running binary (the installer's target).</summary>
    public static string DefaultPath => Path.Combine(AppContext.BaseDirectory, "aurora.env");

    /// <summary>The resolved config path: AURORA_ENV_FILE, else the default.</summary>
    public static string ResolvePath() =>
        Environment.GetEnvironmentVariable("AURORA_ENV_FILE") is { Length: > 0 } p ? p : DefaultPath;

    /// <summary>
    /// Load the machine config file (when present) into the process
    /// environment, filling only gaps (the real environment always wins).
    /// Returns the path loaded, or null when no file was found (a no-op).
    /// </summary>
    public static string? LoadIntoProcess()
    {
        var path = ResolvePath();
        if (!File.Exists(path)) return null;
        foreach (var raw in File.ReadAllLines(path))
        {
            var line = raw.Trim();
            if (line.Length == 0 || line[0] == '#') continue;
            var eq = line.IndexOf('=');
            if (eq <= 0) continue; // no key, or a leading '=' — skip
            var key = line[..eq].Trim();
            if (key.Length == 0) continue;
            // the real environment ALWAYS wins — compose/shell/CI are untouched
            if (Environment.GetEnvironmentVariable(key) is not null) continue;
            var value = line[(eq + 1)..].Trim();
            if (value.Length >= 2 &&
                ((value[0] == '"' && value[^1] == '"') || (value[0] == '\'' && value[^1] == '\'')))
                value = value[1..^1];
            Environment.SetEnvironmentVariable(key, value);
        }
        return path;
    }
}

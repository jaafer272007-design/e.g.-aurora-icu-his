namespace Aurora.Core.Shared;

/* ---- Install EDITION (owner's decision, 2026-09-06 — the ICU-only build) ----
   AURORA_EDITION names which screens this install SHOWS: "icu" — the ICU
   module alone — or "full" — the ICU plus the hospital-direction (module-2)
   screens built into this app in 2026-08: Inpatient Reception, the
   awaiting-bed worklist and the four reception vocabularies in
   Configuration. It is configuration, not code, like APP_ENV: the hospital
   installer writes AURORA_EDITION=icu into aurora.env; render.yaml and the
   appliance compose file set "full" for the validator's staging testbed.

   The DEFAULT is "icu" — the hospital-safe reading. aurora-update.ps1
   carries a hospital's aurora.env across UNCHANGED, so an install from
   before this key exists has no line for it and must still come up ICU-only;
   the only way to get the full edition is the exact word "full". An
   unrecognised value is reported as icu and logged once at boot.

   The server does NOT enforce the edition on its endpoints (the module-2
   API stays available to an authenticated caller, exactly as the AI 503
   stays available when the AI is off): the edition decides what the app
   ADVERTISES, and the frontend reads it at runtime from /healthz
   (src/lib/edition.ts) so one bundle serves both editions and a hospital
   can turn the ward screens on later by editing one line and restarting
   AuroraServer — no app update. */
public static class Edition
{
    public static readonly string[] Known = ["icu", "full"];

    /* read once at startup — a process's configuration does not change */
    public static readonly string Raw =
        (Environment.GetEnvironmentVariable("AURORA_EDITION") ?? "").Trim().ToLowerInvariant();

    /* what /healthz reports and what the frontend decides on */
    public static readonly string Name = Raw == "full" ? "full" : "icu";

    /* a value that is neither word — reported as icu, logged at boot */
    public static readonly bool IsUnrecognised = Raw.Length > 0 && !Known.Contains(Raw);
}

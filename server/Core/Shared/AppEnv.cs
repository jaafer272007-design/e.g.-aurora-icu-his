namespace Aurora.Core.Shared;

/* ---- Environment identity (environment-separation §11 step 1 + the
   aud-claim rider) ----
   APP_ENV names the environment this PROCESS is: development | staging |
   production. It is configuration, not code — render.yaml sets "staging"
   for the deployed cloud tier; a future production install sets
   "production" through the same variable; local dev sets "development"
   explicitly.

   Resolution is FAIL-CLOSED for authentication: a missing or UNKNOWN
   APP_ENV refuses to issue or validate ANY token (see AuthApi and the
   validation parameters in Program.cs). A service that cannot name its
   own environment must be loudly unusable — never quietly minting tokens
   whose audience it cannot vouch for. [This supersedes step 1's
   unset→"development" display default: /healthz now reports "unset"
   honestly. Step 2 escalates an unknown APP_ENV to refuse-boot; until
   then the blast surface that matters — token issuance/validation — is
   already closed here.] */
public static class AppEnv
{
    public static readonly string[] Known = ["development", "staging", "production"];

    /* read once at startup — a process's environment does not change */
    public static readonly string Raw =
        Environment.GetEnvironmentVariable("APP_ENV") ?? "";

    public static readonly bool IsKnown = Known.Contains(Raw);

    /* what /healthz reports — the honest configured value, or "unset" */
    public static string Name => Raw.Length == 0 ? "unset" : Raw;
}

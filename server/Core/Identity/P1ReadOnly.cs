using System.Security.Claims;
using Aurora.Core.Shared;

namespace Aurora.Core.Identity;

/* ---- ICU Integration P1 — SERVER-ENFORCED read-only mode ----

   THE POINT OF THIS FILE, stated plainly because the next reader will
   be tempted to delete it as redundant: hiding buttons is not a
   permission. A P1 bridge token is a real ICU bearer token; anything
   holding it can call any endpoint directly with curl. So the read-only
   promise has to live on the SERVER, in front of every route, or it is
   not a promise at all.

   MECHANISM: the bridge stamps `aurora_scope=p1-readonly` into the
   token it mints. This middleware runs AFTER authentication and BEFORE
   endpoint execution, and for any principal carrying that scope it
   allows ONLY:

     - safe HTTP methods (GET / HEAD / OPTIONS), and
     - the ONE verified-read-only POST: /api/icu/adt/patients/match.

   Everything else — every POST, PUT, DELETE — is refused 403 before the
   handler runs. That covers patient creation, admissions, bed
   operations, transfers, discharges, observations, orders, MAR,
   results, attachments, every settings/vocabulary mutation, user
   management and deletions, WITHOUT enumerating them: a write added
   next month is denied by default because the rule is about the method,
   not about a list somebody has to remember to update.

   WHY THE MATCH EXEMPTION IS SAFE: POST /api/icu/adt/patients/match is
   read-only despite the verb (the national ID rides in the body, never
   a URL). Proven on a disposable production-identity stack: the entire
   AdtPatients table's SHA-256 was byte-identical before and after
   confirmed, repeated, and near-miss matches. It is the ONE exemption,
   pinned by exact path so a future /match/... subpath cannot inherit it.

   TOKENS WITHOUT THE SCOPE ARE UNTOUCHED. A normal ICU session token
   (ICU's own login, which P1 does not expose through the proxy) carries
   no aurora_scope and passes through here unchanged — this middleware
   adds a restriction, it never widens anything. */
public static class P1ReadOnly
{
    /** the claim the bridge stamps, and the only value this gate acts on */
    public const string ScopeClaim = "aurora_scope";
    public const string ReadOnlyScope = "p1-readonly";

    /** the ONE non-safe method allowed under the read-only scope —
        exact-match, never a prefix (see the file header) */
    public const string MatchPath = "/api/icu/adt/patients/match";

    public static bool IsReadOnlyPrincipal(ClaimsPrincipal user) =>
        user.FindAll(ScopeClaim).Any(c => c.Value == ReadOnlyScope);

    /** true when a read-only principal may proceed with this request */
    public static bool Allows(string method, PathString path) =>
        HttpMethods.IsGet(method) || HttpMethods.IsHead(method) || HttpMethods.IsOptions(method)
        || (HttpMethods.IsPost(method)
            && path.Equals(MatchPath, StringComparison.OrdinalIgnoreCase));

    public static void UseP1ReadOnlyGate(this WebApplication app) =>
        app.Use(async (ctx, next) =>
        {
            if (ctx.User?.Identity?.IsAuthenticated == true
                && IsReadOnlyPrincipal(ctx.User)
                && !Allows(ctx.Request.Method, ctx.Request.Path))
            {
                /* the same generic shape every other ICU refusal uses —
                   it never explains which permission was missing, and it
                   never hints that a different token would succeed */
                ctx.Response.StatusCode = 403;
                await ctx.Response.WriteAsJsonAsync(new
                {
                    error = "This ICU session is read-only. Clinical changes are enabled in a later phase.",
                }, JsonOpts.Web);
                return;
            }
            await next();
        });
}

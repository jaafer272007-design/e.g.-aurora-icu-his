using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using Aurora.Core.Shared;
using Microsoft.IdentityModel.Tokens;

namespace Aurora.Core.Identity;

/* ---- ICU Integration P1 — the Aurora/Bahmni session bridge ----

   ONE hospital login. A clinician signs in to Aurora/Bahmni once; this
   endpoint turns that existing, already-authenticated OpenMRS session
   into a short-lived, READ-ONLY ICU token. ICU never asks for a
   password and never issues a second staff credential.

   WHY IT LIVES INSIDE THE ICU API. The signing secret (JWT_SECRET) is
   already held by this process and by nothing else. A separate bridge
   service would mean COPYING that secret into a second process, which
   is strictly worse. Aurora HIS is a static SPA with no server side at
   all, so it cannot host this, and minting in the browser would ship
   the key to every client. This is the only place the secret does not
   have to travel.

   THE PUBLIC PATH IS NOT THIS PATH. The proxy publishes
   `POST /openmrs/aurora-icu-bridge/session` and maps it EXACTLY onto
   this endpoint. That prefix is not decoration: OpenMRS runs at Tomcat
   context /openmrs, so its session cookie is Path=/openmrs and a
   browser will NOT send it to /api/icu/*. The bridge has to sit inside
   the cookie's path or it never sees the session at all.

   WHAT THE COOKIE IS USED FOR — and nothing else. The inbound Cookie
   header is forwarded to exactly one place: the configured internal
   OpenMRS /ws/rest/v1/session. It is never logged, never stored, never
   put in a URL, never returned, and never sent anywhere else. The same
   applies in the other direction: the minted token goes into the
   response BODY only.

   FAIL CLOSED AT EVERY STEP, in this order:
     1. anti-CSRF   — custom header + strict same-origin checks
     2. environment — an unknown APP_ENV mints nothing (AuthApi's rule)
     3. config      — no OpenMRS base configured mints nothing
     4. session     — not authenticated upstream → 401
     5. role map    — unmapped / ambiguous → 403, never a default title
   Only past all five does a token exist. */
static class BridgeApi
{
    /* the custom header a caller must send. Its value is irrelevant —
       its PRESENCE is the point: a custom header cannot be attached by
       a cross-site form or img/script, so the browser is forced into a
       CORS preflight that our origin checks then refuse. This is the
       anti-CSRF layer that does NOT depend on SameSite, which Bahmni
       never sets and browsers default differently (Chrome: Lax;
       Firefox: None). */
    public const string BridgeHeader = "X-Aurora-Bridge";

    /** P1 tokens are deliberately short. There is no refresh endpoint in
        ICU, and the frontend re-bridges on demand — so a stale tab
        cannot keep clinical reads alive after the hospital session ends. */
    public static readonly TimeSpan TokenLifetime = TimeSpan.FromMinutes(30);

    public static void Map(WebApplication app, SymmetricSecurityKey jwtKey, IHttpClientFactory http)
    {
        /* NOT .RequireAuthorization(): the caller has no ICU token yet —
           obtaining one is the entire purpose. Authentication here is
           the OpenMRS session, verified upstream in step 4. */
        app.MapPost("/api/icu/auth/bridge", async (HttpContext ctx) =>
        {
            /* the response must never be cached anywhere: it carries a
               credential, and a shared cache holding it would hand one
               clinician's ICU session to the next request */
            ctx.Response.Headers.CacheControl = "no-store";

            /* ---- 1. anti-CSRF ---------------------------------------- */
            if (CsrfRefusal(ctx.Request) is string csrf)
                return Results.Json(new { error = csrf }, JsonOpts.Web, statusCode: 403);

            /* ---- 2. environment (the aud rider's fail-closed rule) ---- */
            if (!AppEnv.IsKnown)
                return Results.Json(new { error = "ICU is not available — this service cannot name its environment (fail-closed)." },
                    JsonOpts.Web, statusCode: 503);

            /* ---- 3. configuration ------------------------------------ */
            var openmrsBase = (Environment.GetEnvironmentVariable("OPENMRS_INTERNAL_BASE") ?? "").TrimEnd('/');
            if (openmrsBase.Length == 0)
                return Results.Json(new { error = "ICU is not connected to the hospital system yet (OPENMRS_INTERNAL_BASE is not configured)." },
                    JsonOpts.Web, statusCode: 503);

            /* ---- 4. validate the hospital session, server-side -------- */
            var cookie = ctx.Request.Headers.Cookie.ToString();
            if (string.IsNullOrWhiteSpace(cookie))
                return Unauthenticated();

            OpenmrsSession? session;
            try
            {
                session = await OpenmrsSessionReader.Read(http.CreateClient("openmrs"), openmrsBase, cookie, ctx.RequestAborted);
            }
            catch (Exception)
            {
                /* the hospital system was unreachable or answered
                   something we cannot read. That is NOT "denied" and not
                   "allowed" — it is unavailable, and it says so without
                   echoing anything the upstream returned. */
                return Results.Json(new { error = "The hospital system could not be reached to confirm your session. Nothing was changed; try again." },
                    JsonOpts.Web, statusCode: 503);
            }
            if (session is null || !session.Authenticated || string.IsNullOrWhiteSpace(session.Username))
                return Unauthenticated();

            /* ---- 5. the explicit role map, deny by default ------------ */
            var resolved = IcuRoleMap.Resolve(session.Roles);
            if (!resolved.Ok)
                return Results.Json(new { error = $"Your hospital account does not have ICU access — {resolved.Reason}." },
                    JsonOpts.Web, statusCode: 403);

            var now = DateTime.UtcNow;
            var token = new JwtSecurityTokenHandler().WriteToken(new JwtSecurityToken(
                issuer: Jwt.Issuer,
                audience: AppEnv.Name,           // the aud environment rider, unchanged
                claims:
                [
                    new Claim(JwtRegisteredClaimNames.Sub, session.Username),
                    new Claim(JwtRegisteredClaimNames.Jti, Guid.NewGuid().ToString()),
                    new Claim("name", string.IsNullOrWhiteSpace(session.DisplayName) ? session.Username : session.DisplayName),
                    new Claim("jobTitle", resolved.JobTitle!),
                    /* the P1 promise, carried IN the token so the server
                       can enforce it on every later request without
                       consulting anything else (see P1ReadOnly) */
                    new Claim(P1ReadOnly.ScopeClaim, P1ReadOnly.ReadOnlyScope),
                ],
                notBefore: now,
                expires: now.Add(TokenLifetime),
                signingCredentials: new SigningCredentials(jwtKey, SecurityAlgorithms.HmacSha256)));

            return Results.Json(new
            {
                token,
                name = string.IsNullOrWhiteSpace(session.DisplayName) ? session.Username : session.DisplayName,
                jobTitle = resolved.JobTitle,
                readOnly = true,
                expiresInSeconds = (int)TokenLifetime.TotalSeconds,
            }, JsonOpts.Web);
        });
    }

    /* ONE generic answer for "no usable hospital session", whatever the
       reason — no session, expired session, unreadable body. The login
       surface must not become an account-state oracle (AuthApi's rule,
       applied here). */
    static IResult Unauthenticated() =>
        Results.Json(new { error = "You are not signed in to the hospital system." }, JsonOpts.Web, statusCode: 401);

    /** null when the request may proceed; the refusal text otherwise.

        THE PROXY PROBLEM, found by the P1 end-to-end proof and fixed here:
        an earlier version compared Origin against `req.Host`. Behind a
        reverse proxy that is WRONG — Apache's ProxyPreserveHost is Off by
        default, so this process sees the UPSTREAM host
        (aurora-icu-api:8080), never the browser's origin, and every
        legitimate request was refused. Host is therefore not consulted at
        all. The expected origin is either DECLARED
        (ICU_BRIDGE_ALLOWED_ORIGIN — a hospital naming its own address) or,
        when it is not declared, established from Fetch metadata, which the
        browser computes and no cross-site caller can forge.

        Three independent conditions, and at least one POSITIVE proof of
        same-origin is always required — an absent Origin AND absent
        Sec-Fetch-Site is refused, never assumed friendly. */
    static string? CsrfRefusal(HttpRequest req)
    {
        /* (1) the custom header. Its VALUE is irrelevant; its presence is
           the point — a cross-site form, img or script cannot attach one,
           so the browser is forced into a preflight this endpoint never
           answers. */
        if (!req.Headers.ContainsKey(BridgeHeader))
            return $"This request is missing the {BridgeHeader} header and was refused.";

        /* (2) Fetch metadata. Every current browser sends it and none lets
           a page forge it. Anything other than same-origin is refused
           outright: cross-site, same-site (a sibling subdomain) and none
           (a typed URL or bookmark) are all wrong for this endpoint. */
        var fetchSite = req.Headers["Sec-Fetch-Site"].ToString();
        var metadataSaysSameOrigin = fetchSite == "same-origin";
        if (fetchSite.Length > 0 && !metadataSaysSameOrigin)
            return "This request did not come from the hospital system's own page and was refused.";

        /* (3) Origin, checked ONLY against a declared value. */
        var declared = (Environment.GetEnvironmentVariable("ICU_BRIDGE_ALLOWED_ORIGIN") ?? "").TrimEnd('/');
        var origin = req.Headers.Origin.ToString().TrimEnd('/');
        if (declared.Length > 0)
        {
            if (origin.Length == 0)
                return "This request carried no Origin and was refused.";
            if (!string.Equals(origin, declared, StringComparison.OrdinalIgnoreCase))
                return "This request came from a different origin and was refused.";
            return null;
        }

        /* No declared origin: the only remaining positive proof is the
           browser's own metadata. Absent that, refuse — this is the
           fail-closed branch, and the deployment fixes it by declaring
           ICU_BRIDGE_ALLOWED_ORIGIN. */
        return metadataSaysSameOrigin
            ? null
            : "This request could not be proven to come from the hospital system's own page "
              + "(no Sec-Fetch-Site, and ICU_BRIDGE_ALLOWED_ORIGIN is not configured) and was refused.";
    }
}

/** the only fields the bridge reads from the hospital session */
record OpenmrsSession(bool Authenticated, string? Username, string? DisplayName, IReadOnlyList<string> Roles);

static class OpenmrsSessionReader
{
    /** GET {base}/ws/rest/v1/session with the caller's cookie. Returns
        null when the body is not a session document — never a guess. */
    public static async Task<OpenmrsSession?> Read(HttpClient client, string openmrsBase, string cookie, CancellationToken ct)
    {
        using var req = new HttpRequestMessage(HttpMethod.Get, $"{openmrsBase}/ws/rest/v1/session");
        /* the ONLY forward of the caller's credential, to the ONE
           configured internal address */
        req.Headers.TryAddWithoutValidation("Cookie", cookie);
        req.Headers.TryAddWithoutValidation("Accept", "application/json");
        using var res = await client.SendAsync(req, ct);
        if (!res.IsSuccessStatusCode) return null;
        using var stream = await res.Content.ReadAsStreamAsync(ct);
        using var doc = await System.Text.Json.JsonDocument.ParseAsync(stream, cancellationToken: ct);
        var root = doc.RootElement;
        if (root.ValueKind != System.Text.Json.JsonValueKind.Object) return null;
        if (!root.TryGetProperty("authenticated", out var auth) ||
            auth.ValueKind is not (System.Text.Json.JsonValueKind.True or System.Text.Json.JsonValueKind.False))
            return null;
        if (!auth.GetBoolean()) return new OpenmrsSession(false, null, null, []);
        if (!root.TryGetProperty("user", out var user) || user.ValueKind != System.Text.Json.JsonValueKind.Object)
            return null;

        var username = user.TryGetProperty("username", out var u) ? u.GetString() : null;
        var display = user.TryGetProperty("display", out var d) ? d.GetString() : null;
        var roles = new List<string>();
        if (user.TryGetProperty("roles", out var rs) && rs.ValueKind == System.Text.Json.JsonValueKind.Array)
            foreach (var r in rs.EnumerateArray())
                if (r.ValueKind == System.Text.Json.JsonValueKind.Object
                    && r.TryGetProperty("name", out var n) && n.GetString() is string name && name.Length > 0)
                    roles.Add(name);
        return new OpenmrsSession(true, username, display, roles);
    }
}

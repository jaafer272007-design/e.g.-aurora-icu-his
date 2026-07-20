using System.Security.Claims;
using Aurora.Core.Identity;
using Aurora.Core.Persistence;
using Aurora.Core.Shared;
using Microsoft.EntityFrameworkCore;

namespace Aurora.Core.MasterData;

/* ------------- Hospital Identity API (Configuration, Aurora Core) -------------
   MANAGING HOSPITAL IDENTITY IS ADMINISTRATIVE, NOT CLINICAL — the new
   hospital.configure permission sits on the OFFICE ADMINISTRATOR
   profile (the identity.correct precedent: the hospital's name and
   letterhead are the administrative face of the institution and carry
   NO clinical data, so the locked office-Administrator clinical
   exclusion is untouched — this is finally a configuration surface that
   IS theirs). The counterpart split, stated: clinical vocabularies
   (code status) stay SeniorDoctor-gated; administrative configuration
   is the office profile's.

   FLAGGED: the public read is ANONYMOUS — the login screen renders the
   hospital's identity BEFORE any authentication exists, and a
   hospital's name is its public face (it is on the building). Only the
   identity FIELDS are anonymous; the audit history (which names staff
   actors) requires hospital.configure.

   Every edit is AUDITED on the record's append-only event history with
   a per-field prior→next diff (amend-never-erase). Four-code rule:
   403 permission · 409 state conflict (n/a here — single record, no
   lifecycle) · 400 malformed / no-change. */
static class HospitalIdentityApi
{
    public const string RowId = "hospital";

    public static void Map(WebApplication app)
    {
        /* GET /api/icu/hospital-identity — the PUBLIC identity, no
           history. ANONYMOUS (flagged above): the login screen renders
           this pre-auth. An unconfigured install returns empty fields +
           configured:false — the client renders the neutral
           placeholder, never a fabricated default. */
        app.MapGet("/api/icu/hospital-identity", (HttpContext ctx, AuroraDb db) =>
        {
            foreach (var key in ctx.Request.Query.Keys)
                return ApiError.BadRequest($"unknown query parameter '{key}'");
            var row = db.HospitalIdentity.AsNoTracking().FirstOrDefault(r => r.Id == RowId);
            /* the machine clock (Locale/Timezone §1.3): the server's OWN
               zone, read from the OS at request time — an unset container
               TZ honestly reports UTC (staging on Render does exactly
               that), never a guessed hospital zone */
            var tz = TimeZoneInfo.Local;
            var offset = (int)tz.GetUtcOffset(DateTimeOffset.UtcNow).TotalMinutes;
            return Results.Json((row?.ToDto() ?? new HospitalIdentityDto("", "", "", "", "", "", false, 0, false))
                with { ServerTimeZone = tz.Id, ServerUtcOffsetMinutes = offset }, JsonOpts.Web);
        });

        /* GET /api/icu/hospital-identity/logo — the letterhead logo BYTES.
           ANONYMOUS like the identity fields it belongs to (the logo is on
           the building too, and the login screen may carry it one day);
           serving bytes lets the letterhead <img> load cross-origin from
           the Pages client with no auth plumbing. 404 while unset — the
           letterhead falls back to its placeholder box. The client
           cache-busts with ?v=<logoVersion>; unknown OTHER params 400. */
        app.MapGet("/api/icu/hospital-identity/logo", (HttpContext ctx, AuroraDb db) =>
        {
            foreach (var key in ctx.Request.Query.Keys)
                if (key is not "v")
                    return ApiError.BadRequest($"unknown query parameter '{key}'");
            var row = db.HospitalIdentity.AsNoTracking().FirstOrDefault(r => r.Id == RowId);
            if (row is null || !row.HasLogo) return ApiError.NotFound();
            return Results.File(Convert.FromBase64String(row.LogoBase64), row.LogoMime);
        });

        /* GET /api/icu/hospital-identity/history — identity + the full
           audit history (actors by name → gated, never anonymous). */
        app.MapGet("/api/icu/hospital-identity/history", (ClaimsPrincipal user, AuroraDb db) =>
        {
            if (Rbac.Deny(user, "hospital.configure") is IResult denied) return denied;
            var row = db.HospitalIdentity.AsNoTracking().FirstOrDefault(r => r.Id == RowId);
            return Results.Json(row?.ToHistoryDto()
                ?? new HospitalIdentityWithHistoryDto("", "", "", "", "", "", false, 0, false, []), JsonOpts.Web);
        }).RequireAuthorization();

        /* PUT /api/icu/hospital-identity — edit the single record
           (creates it on first configuration). Office Administrator.
           The hospital NAME is required once identity is being set —
           an identity without a hospital name is not an identity; the
           other fields are optional. No-change → 400. Every changed
           field lands a prior→next diff on the audit history. */
        app.MapPut("/api/icu/hospital-identity", (EditHospitalIdentityRequest req, ClaimsPrincipal user, AuroraDb db) =>
        {
            if (Rbac.Deny(user, "hospital.configure") is IResult denied) return denied;

            var name = (req.Name ?? "").Trim();
            var unitName = (req.UnitName ?? "").Trim();
            var shortName = (req.ShortName ?? "").Trim();
            var address = (req.Address ?? "").Trim();
            var headerText = (req.HeaderText ?? "").Trim();
            var footerText = (req.FooterText ?? "").Trim();
            if (name.Length == 0) return ApiError.BadRequest("hospital name is required — identity cannot be saved without it");
            /* free-text correction: identity fields are what the hospital
               says they are — only the platform bound applies (the old
               120/80/20/400 caps were style rules). The branding lines
               are the same class of field — the hospital's own words. */
            foreach (var (v, fieldName) in new[] {
                (name, "hospital name"), (unitName, "unit name"),
                (shortName, "short name"), (address, "address"),
                (headerText, "header text"), (footerText, "footer text") })
                if (v.Length > FormularyLogic.MaxTextLength)
                    return ApiError.BadRequest($"{fieldName} exceeds {FormularyLogic.MaxTextLength} characters");

            var row = db.HospitalIdentity.FirstOrDefault(r => r.Id == RowId);
            var created = row is null;
            row ??= new HospitalIdentityRow { Id = RowId };

            /* per-field prior→next diff — "(unset)" marks a first set */
            string Show(string v) => v.Length == 0 ? "(unset)" : v;
            var changes = new List<string>();
            if (row.Name != name) changes.Add($"name: {Show(row.Name)} → {Show(name)}");
            if (row.UnitName != unitName) changes.Add($"unit: {Show(row.UnitName)} → {Show(unitName)}");
            if (row.ShortName != shortName) changes.Add($"short name: {Show(row.ShortName)} → {Show(shortName)}");
            if (row.Address != address) changes.Add($"address: {Show(row.Address)} → {Show(address)}");
            if (row.HeaderText != headerText) changes.Add($"header text: {Show(row.HeaderText)} → {Show(headerText)}");
            if (row.FooterText != footerText) changes.Add($"footer text: {Show(row.FooterText)} → {Show(footerText)}");
            if (changes.Count == 0)
                return ApiError.BadRequest("no field change — the provided identity matches the current record");

            var actor = user.FindFirst("name")?.Value ?? "Unknown";
            row.EventsJson = FormularyLogic.AppendEvents(row.EventsJson,
                [new(FormularyLogic.Now(), actor, created ? "identity configured" : "identity amended", string.Join("; ", changes))]);
            row.Name = name; row.UnitName = unitName; row.ShortName = shortName; row.Address = address;
            row.HeaderText = headerText; row.FooterText = footerText;
            if (created) db.HospitalIdentity.Add(row);
            db.SaveChanges();
            return Results.Json(row.ToHistoryDto(), JsonOpts.Web);
        }).RequireAuthorization();

        /* POST /api/icu/hospital-identity/logo — set the letterhead logo
           (office Administrator). The system's FIRST binary capability,
           deliberately bounded:
           - PNG or JPEG only (the two universal letterhead formats; SVG
             is excluded — a script-capable vector is a needless surface)
           - decoded size ≤ 512 KB (a letterhead logo, not an asset store)
           - MAGIC BYTES must match the declared mime — the content type
             can never lie about what the bytes are.
           Stored IN the identity row (on-prem, inside the appliance's own
           database — never an external service). Audited like every other
           identity change; replacing an existing logo is an amend. */
        app.MapPost("/api/icu/hospital-identity/logo", (SetHospitalLogoRequest req, ClaimsPrincipal user, AuroraDb db) =>
        {
            if (Rbac.Deny(user, "hospital.configure") is IResult denied) return denied;
            var mime = (req.Mime ?? "").Trim().ToLowerInvariant();
            if (mime is not ("image/png" or "image/jpeg"))
                return ApiError.BadRequest("logo must be image/png or image/jpeg");
            if (string.IsNullOrWhiteSpace(req.DataBase64))
                return ApiError.BadRequest("dataBase64 is required — the base64-encoded image bytes");
            byte[] bytes;
            try { bytes = Convert.FromBase64String(req.DataBase64); }
            catch (FormatException) { return ApiError.BadRequest("dataBase64 is not valid base64"); }
            if (bytes.Length == 0) return ApiError.BadRequest("the image is empty");
            if (bytes.Length > MaxLogoBytes)
                return ApiError.BadRequest($"the image is {bytes.Length / 1024} KB — the letterhead logo limit is {MaxLogoBytes / 1024} KB");
            var isPng = bytes.Length > 8 && bytes[0] == 0x89 && bytes[1] == 0x50 && bytes[2] == 0x4E && bytes[3] == 0x47;
            var isJpeg = bytes.Length > 3 && bytes[0] == 0xFF && bytes[1] == 0xD8 && bytes[2] == 0xFF;
            if ((mime == "image/png" && !isPng) || (mime == "image/jpeg" && !isJpeg))
                return ApiError.BadRequest($"the image bytes are not {mime} — the declared type must match the actual content");

            var row = db.HospitalIdentity.FirstOrDefault(r => r.Id == RowId);
            var created = row is null;
            row ??= new HospitalIdentityRow { Id = RowId };
            var actor = user.FindFirst("name")?.Value ?? "Unknown";
            var action = row.HasLogo ? "logo replaced" : "logo set";
            row.EventsJson = FormularyLogic.AppendEvents(row.EventsJson,
                [new(FormularyLogic.Now(), actor, action, $"{mime} · {Math.Max(1, bytes.Length / 1024)} KB")]);
            row.LogoMime = mime;
            row.LogoBase64 = Convert.ToBase64String(bytes);
            row.LogoVersion++;
            if (created) db.HospitalIdentity.Add(row);
            db.SaveChanges();
            return Results.Json(row.ToHistoryDto(), JsonOpts.Web);
        }).RequireAuthorization();

        /* POST /api/icu/hospital-identity/logo/clear — remove the logo
           (the letterhead returns to its placeholder). 409 when none is
           set — clearing nothing is a state conflict, not a no-op. */
        app.MapPost("/api/icu/hospital-identity/logo/clear", (ClaimsPrincipal user, AuroraDb db) =>
        {
            if (Rbac.Deny(user, "hospital.configure") is IResult denied) return denied;
            var row = db.HospitalIdentity.FirstOrDefault(r => r.Id == RowId);
            if (row is null || !row.HasLogo)
                return ApiError.StateConflict("no logo is set — there is nothing to clear");
            var actor = user.FindFirst("name")?.Value ?? "Unknown";
            row.EventsJson = FormularyLogic.AppendEvents(row.EventsJson,
                [new(FormularyLogic.Now(), actor, "logo cleared", $"was {row.LogoMime} · {Math.Max(1, Convert.FromBase64String(row.LogoBase64).Length / 1024)} KB")]);
            row.LogoMime = "";
            row.LogoBase64 = "";
            row.LogoVersion++;
            db.SaveChanges();
            return Results.Json(row.ToHistoryDto(), JsonOpts.Web);
        }).RequireAuthorization();
    }

    /* the stated limit: 512 KB decoded — a letterhead logo */
    public const int MaxLogoBytes = 512 * 1024;
}

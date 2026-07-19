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
            return Results.Json((row?.ToDto() ?? new HospitalIdentityDto("", "", "", "", false))
                with { ServerTimeZone = tz.Id, ServerUtcOffsetMinutes = offset }, JsonOpts.Web);
        });

        /* GET /api/icu/hospital-identity/history — identity + the full
           audit history (actors by name → gated, never anonymous). */
        app.MapGet("/api/icu/hospital-identity/history", (ClaimsPrincipal user, AuroraDb db) =>
        {
            if (Rbac.Deny(user, "hospital.configure") is IResult denied) return denied;
            var row = db.HospitalIdentity.AsNoTracking().FirstOrDefault(r => r.Id == RowId);
            return Results.Json(row?.ToHistoryDto()
                ?? new HospitalIdentityWithHistoryDto("", "", "", "", false, []), JsonOpts.Web);
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
            if (name.Length == 0) return ApiError.BadRequest("hospital name is required — identity cannot be saved without it");
            if (name.Length > 120) return ApiError.BadRequest("hospital name exceeds 120 characters");
            if (unitName.Length > 80) return ApiError.BadRequest("unit name exceeds 80 characters");
            if (shortName.Length > 20) return ApiError.BadRequest("short name exceeds 20 characters");
            if (address.Length > 400) return ApiError.BadRequest("address exceeds 400 characters");

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
            if (changes.Count == 0)
                return ApiError.BadRequest("no field change — the provided identity matches the current record");

            var actor = user.FindFirst("name")?.Value ?? "Unknown";
            row.EventsJson = FormularyLogic.AppendEvents(row.EventsJson,
                [new(FormularyLogic.Now(), actor, created ? "identity configured" : "identity amended", string.Join("; ", changes))]);
            row.Name = name; row.UnitName = unitName; row.ShortName = shortName; row.Address = address;
            if (created) db.HospitalIdentity.Add(row);
            db.SaveChanges();
            return Results.Json(row.ToHistoryDto(), JsonOpts.Web);
        }).RequireAuthorization();
    }
}

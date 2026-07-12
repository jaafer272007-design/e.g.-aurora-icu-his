using System.Security.Claims;
using Aurora.Core.Identity;
using Aurora.Core.Persistence;
using Aurora.Core.Shared;
using Microsoft.EntityFrameworkCore;
using System.Text.Json;

namespace Aurora.Core.Observations;

/* ---------------- Observations API — §12 step 1 surface ----------------
   The catalogue read + group enablement only. The Observation Service's
   write paths (manual charting, the two-tier corrections) are §12 step 2;
   the generic Observation TABLE ships now as the foundation.

   RBAC (design §4, decisions F1–F4):
   - the catalogue read is open to every authenticated profile (charting
     UIs filter on enabled; config UIs see everything)
   - group enable/disable is `observations.configure` — the
     Consultant-tier authority (the SeniorDoctor profile). HARD
     CONSTRAINT: never the office Administrator profile. */
static class ObservationsApi
{
    public static void Map(WebApplication app)
    {
        /* GET /api/icu/observations/catalog — groups in clinical order,
           each with its types; DISABLED groups included (config
           visibility) with their enabled flag honest. */
        app.MapGet("/api/icu/observations/catalog", (ClaimsPrincipal user, AuroraDb db) =>
        {
            var types = db.ObservationTypes.AsNoTracking().OrderBy(t => t.Seq).AsEnumerable()
                .Select(t => t.ToDto()).GroupBy(t => t.GroupCode).ToDictionary(g => g.Key, g => g.ToList());
            var groups = db.ObservationGroups.AsNoTracking().OrderBy(g => g.Seq).AsEnumerable()
                .Select(g => new CatalogGroupDto(g.GroupCode, g.DisplayName, g.Seq, g.Enabled,
                    types.GetValueOrDefault(g.GroupCode, [])));
            return Results.Json(groups, JsonOpts.Web);
        }).RequireAuthorization();

        /* POST /api/icu/observations/groups/{groupCode}/enable | /disable —
           the F3 configuration act: what does THIS deployment chart.
           observations.configure (Consultant-tier). FOUR-CODE: unknown
           group → 404; already in the requested state → 409 (replay is a
           state conflict, not a silent no-op); the toggle is stamped and
           its history append-only. */
        app.MapPost("/api/icu/observations/groups/{groupCode}/enable",
            (string groupCode, ClaimsPrincipal user, AuroraDb db) => Toggle(groupCode, true, user, db))
            .RequireAuthorization();
        app.MapPost("/api/icu/observations/groups/{groupCode}/disable",
            (string groupCode, ClaimsPrincipal user, AuroraDb db) => Toggle(groupCode, false, user, db))
            .RequireAuthorization();
    }

    static IResult Toggle(string groupCode, bool enable, ClaimsPrincipal user, AuroraDb db)
    {
        if (Rbac.Deny(user, "observations.configure") is IResult denied) return denied;
        var g = db.ObservationGroups.FirstOrDefault(x => x.GroupCode == groupCode);
        if (g is null) return ApiError.NotFound();
        if (g.Enabled == enable)
            return ApiError.StateConflict(
                $"observation group '{groupCode}' is already {(enable ? "enabled" : "disabled")}" +
                (g.ChangedBy is null ? "" : $" (last changed by {g.ChangedBy} at {g.ChangedAt})"));
        var actor = user.FindFirst("name")?.Value ?? "Unknown";
        var now = DateTime.UtcNow.ToString("yyyy-MM-dd HH:mm");
        g.Enabled = enable;
        g.ChangedBy = actor;
        g.ChangedAt = now;
        var events = JsonSerializer.Deserialize<List<GroupEventDto>>(g.EventsJson, JsonOpts.Web)!;
        events.Add(new(now, actor, enable ? "enabled" : "disabled"));
        g.EventsJson = JsonSerializer.Serialize(events, JsonOpts.Web);
        db.SaveChanges();
        return Results.Json(g.ToDto(), JsonOpts.Web);
    }
}

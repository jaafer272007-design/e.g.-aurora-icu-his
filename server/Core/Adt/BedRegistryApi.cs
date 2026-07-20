using System.Security.Claims;
using Aurora.Core.Identity;
using Aurora.Core.MasterData;
using Aurora.Core.Persistence;
using Aurora.Core.Shared;
using Microsoft.EntityFrameworkCore;

namespace Aurora.Core.Adt;

/* ------------- Bed Registry management (ADT, Aurora Core) -------------
   The fourth Configuration tenant (bed-registry design). Beds join the
   proven catalogue pattern (audited add / retire / reactivate,
   deactivate-never-delete) with the TWO rules that set beds apart from
   inert catalogues:

   1. A bed is OCCUPIED — occupancy derives from open encounters, never a
      stored flag — so RETIRING AN OCCUPIED BED IS REFUSED (409), guarded
      by the SAME live-occupancy computation the bed board and the
      admit/transfer paths use ("you cannot retire a bed a patient is in").
   2. Beds are NEVER RENAMED (locked decision 2 — a renamed occupied bed
      is a wrong-patient-location risk). There is deliberately NO edit
      endpoint; BedId is stable once created.

   NO DELETE either (flagged recommendation followed): historical bed
   references are FK-free BedId snapshot strings on encounters, orders,
   results — proving "never used" is impossible from the registry alone,
   so retire-only is the safe rule.

   RBAC — the VALIDATOR'S DECISION (design §8.1, asked and answered):
   a DISTINCT beds.manage atom held by BOTH the SeniorDoctor (unit
   command runs the unit's bed layout) AND the office Administrator
   (facility configuration). Beds are places, not patient data — the
   locked clinical exclusion is not touched. Every profile reads the
   registry (GET /adt/beds, patients.view) — the board, pickers and
   Settings all render from it.

   Four-code rule: 403 permission · 404 absent · 409 state conflict ·
   400 malformed. */
static class BedRegistryApi
{
    public static void Map(WebApplication app)
    {
        /* POST /api/icu/adt/beds — add a bed. BedId is a PERMANENT
           natural key (visible on charts and historical records);
           re-adding a retired BedId is refused DIRECTING REACTIVATE
           (flagged recommendation followed: old records reference that
           BedId string — reactivate-the-existing, never a duplicate). */
        app.MapPost("/api/icu/adt/beds", (CreateBedRequest req, ClaimsPrincipal user, AuroraDb db) =>
        {
            if (Rbac.Deny(user, "beds.manage") is IResult denied) return denied;
            /* free-text correction: the bed label IS the visible identity
               (it renders on charts), so it stays the typed key — but
               with NO format rule, only the platform bound; permanence
               and uniqueness (the 409s below) are what protect records */
            var bedId = (req.BedId ?? "").Trim();
            if (bedId.Length == 0) return ApiError.BadRequest("bedId is required");
            if (bedId.Length > AdtLogic.MaxTextLength)
                return ApiError.BadRequest($"bedId exceeds {AdtLogic.MaxTextLength} characters");
            var area = (req.Area ?? "").Trim();
            if (area.Length == 0) return ApiError.BadRequest("area is required (the board groups beds by area, e.g. 'Pod A')");
            if (area.Length > AdtLogic.MaxTextLength)
                return ApiError.BadRequest($"area exceeds {AdtLogic.MaxTextLength} characters");
            if (req.Seq is < 1 or > 9999) return ApiError.BadRequest("seq must be between 1 and 9999");
            if (db.Beds.FirstOrDefault(b => b.BedId == bedId) is BedRow existing)
                return existing.Active
                    ? ApiError.StateConflict($"bed '{bedId}' already exists (active, {existing.Area}) — bed ids are permanent")
                    : ApiError.StateConflict(
                        $"bed '{bedId}' already exists RETIRED ({existing.Area}) — historical records reference that bed id, so " +
                        "reactivate the existing bed instead of creating a duplicate");

            var actor = user.FindFirst("name")?.Value ?? "Unknown";
            var row = new BedRow
            {
                BedId = bedId, Area = area,
                Seq = req.Seq ?? (db.Beds.Max(b => (int?)b.Seq) ?? 0) + 1,
                Active = true,
                EventsJson = System.Text.Json.JsonSerializer.Serialize(
                    new List<FormularyEventDto> { new(FormularyLogic.Now(), actor, "added to registry", $"area {area}") }, JsonOpts.Web),
            };
            db.Beds.Add(row);
            db.SaveChanges();
            return Results.Json(new AdtBedDto(row.BedId, row.Area, row.Seq, row.Active, null, null, null, row.History()), JsonOpts.Web);
        }).RequireAuthorization();

        /* POST /api/icu/adt/beds/{bedId}/deactivate — RETIRE.
           🔴 THE CRITICAL RULE: refused while OCCUPIED — the SAME
           live-occupancy computation the bed board and admit/transfer
           use (an open encounter holding this BedId), never a stored
           flag. The refusal NAMES the occupancy. */
        app.MapPost("/api/icu/adt/beds/{bedId}/deactivate", (string bedId, ClaimsPrincipal user, AuroraDb db) =>
        {
            if (Rbac.Deny(user, "beds.manage") is IResult denied) return denied;
            var row = db.Beds.FirstOrDefault(b => b.BedId == bedId);
            if (row is null) return ApiError.NotFound();
            if (!row.Active)
                return ApiError.StateConflict($"bed '{bedId}' is already retired — there is nothing to deactivate");
            var occupant = db.Encounters.AsNoTracking()
                .FirstOrDefault(e => e.Status == "open" && e.BedId == bedId);
            if (occupant is not null)
            {
                var name = db.AdtPatients.AsNoTracking()
                    .FirstOrDefault(p => p.PatientId == occupant.PatientId)?.DisplayName ?? occupant.PatientId;
                return ApiError.StateConflict(
                    $"bed '{bedId}' is occupied by {occupant.PatientId} ({name}, encounter {occupant.EncounterId}) — " +
                    "you cannot retire a bed a patient is in; discharge or transfer them first");
            }
            var actor = user.FindFirst("name")?.Value ?? "Unknown";
            row.Active = false;
            row.EventsJson = FormularyLogic.AppendEvents(row.EventsJson,
                [new(FormularyLogic.Now(), actor, "retired", null)]);
            db.SaveChanges();
            return Results.Json(new AdtBedDto(row.BedId, row.Area, row.Seq, row.Active, null, null, null, row.History()), JsonOpts.Web);
        }).RequireAuthorization();

        /* POST /api/icu/adt/beds/{bedId}/reactivate — back into the
           board and the admit/transfer set. */
        app.MapPost("/api/icu/adt/beds/{bedId}/reactivate", (string bedId, ClaimsPrincipal user, AuroraDb db) =>
        {
            if (Rbac.Deny(user, "beds.manage") is IResult denied) return denied;
            var row = db.Beds.FirstOrDefault(b => b.BedId == bedId);
            if (row is null) return ApiError.NotFound();
            if (row.Active)
                return ApiError.StateConflict($"bed '{bedId}' is already active — there is nothing to reactivate");
            var actor = user.FindFirst("name")?.Value ?? "Unknown";
            row.Active = true;
            row.EventsJson = FormularyLogic.AppendEvents(row.EventsJson,
                [new(FormularyLogic.Now(), actor, "reactivated", null)]);
            db.SaveChanges();
            return Results.Json(new AdtBedDto(row.BedId, row.Area, row.Seq, row.Active, null, null, null, row.History()), JsonOpts.Web);
        }).RequireAuthorization();
    }
}

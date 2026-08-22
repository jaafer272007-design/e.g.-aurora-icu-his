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
      is a wrong-patient-location risk). BedId is stable once created.
      *Superseded in part (Ward B, ward.md A1): an EDIT endpoint now
      exists for the MUTABLE subset — the bed's ward (area) and board
      position — because a backfilled ward typo was otherwise unfixable.
      The rename prohibition stands untouched: the edit contract has no
      bedId field (EditBedRequest — identity cannot change by
      construction), and an occupied bed refuses an area change for the
      same location-integrity reason the rename rule names.*

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
    /** the registry's write-response DTO: no occupant (management responses
        never carry one) + the ward label resolved at read (Ward B) */
    static AdtBedDto BedDto(AuroraDb db, BedRow row) => new(
        row.BedId, row.Area, row.Seq, row.Active, null, null, null, row.History(),
        db.Wards.AsNoTracking().FirstOrDefault(w => w.Code == row.Area)?.Label);

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
            if (area.Length == 0) return ApiError.BadRequest("area is required — the ward this bed belongs to (a governed Wards vocabulary code)");
            if (area.Length > AdtLogic.MaxTextLength)
                return ApiError.BadRequest($"area exceeds {AdtLogic.MaxTextLength} characters");
            /* WARD B (ward.md A1): area is no longer free text — it is the
               WARD CODE, validated against the governed vocabulary exactly
               as an admission's departmentCode is: unknown → 400 naming the
               active wards (a payload reference resolving to nothing),
               RETIRED → 409 (state — reactivate it and the same request
               succeeds; the disposition precedent). The 409 is also the
               "retired Ward cannot be selected for new bed placement"
               guarantee, enforced where the placement happens. */
            var ward = db.Wards.AsNoTracking().FirstOrDefault(w => w.Code == area);
            if (ward is null)
                return ApiError.BadRequest(
                    $"area '{area}' does not match any ward — configure it first; active wards: "
                    + $"{string.Join(", ", db.Wards.AsNoTracking().Where(w => w.Active).OrderBy(w => w.Seq).Select(w => w.Code))}");
            if (!ward.Active)
                return ApiError.StateConflict(
                    $"ward '{area}' ({ward.Label}) is retired — a new bed cannot be placed in it; reactivate the ward or pick an active one");
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
            return Results.Json(BedDto(db, row), JsonOpts.Web);
        }).RequireAuthorization();

        /* PUT /api/icu/adt/beds/{bedId} — the BED EDIT PATH (Ward B; ward.md
           A1's ruling: "a bed's area cannot be changed today at all — without
           one, a backfilled typo is unfixable"). Edits the MUTABLE subset
           only: the ward (area) and the board position (seq). BedId stays
           permanent — the contract has no field for it (see EditBedRequest),
           so identity cannot change by construction.

           RE-PARENTING IS THE POINT of this path: a bed typed into "PodA"
           moves to "Pod A" here, and the typo ward is then retirable. The
           target ward is validated exactly as at creation — unknown 400
           naming the actives, retired 409 ("retired Ward cannot be selected
           for new bed placement", enforced at every placement site).

           AREA CHANGE IS REFUSED WHILE THE BED IS OCCUPIED — the registry's
           own live-occupancy principle (the retire guard's reason, applied
           to the same hazard): silently moving an admitted patient's
           displayed ward is a wrong-patient-location risk, the exact class
           locked decision 2 names for renames. Discharge or transfer the
           occupant first. A seq-only edit is display order and carries no
           such hazard — it is allowed while occupied.

           Audited into the bed's own append-only history with the prior
           value named ("ward 'PodA' → 'Pod A'") — a correction is visible
           forever, never a silent rewrite. Refusals write nothing: the
           only SaveChanges sits after the last guard. */
        app.MapPut("/api/icu/adt/beds/{bedId}", (string bedId, EditBedRequest req, ClaimsPrincipal user, AuroraDb db) =>
        {
            if (Rbac.Deny(user, "beds.manage") is IResult denied) return denied;
            var area = (req.Area ?? "").Trim();
            if (area.Length == 0) return ApiError.BadRequest("area is required — the ward this bed belongs to");
            if (area.Length > AdtLogic.MaxTextLength)
                return ApiError.BadRequest($"area exceeds {AdtLogic.MaxTextLength} characters");
            if (req.Seq is < 1 or > 9999) return ApiError.BadRequest("seq must be between 1 and 9999");
            var row = db.Beds.FirstOrDefault(b => b.BedId == bedId);
            if (row is null) return ApiError.NotFound();
            var areaChanged = area != row.Area;
            var seqChanged = req.Seq is int s && s != row.Seq;
            if (!areaChanged && !seqChanged)
                return ApiError.BadRequest("no field change — the provided values match the current bed");
            if (areaChanged)
            {
                var ward = db.Wards.AsNoTracking().FirstOrDefault(w => w.Code == area);
                if (ward is null)
                    return ApiError.BadRequest(
                        $"area '{area}' does not match any ward — configure it first; active wards: "
                        + $"{string.Join(", ", db.Wards.AsNoTracking().Where(w => w.Active).OrderBy(w => w.Seq).Select(w => w.Code))}");
                if (!ward.Active)
                    return ApiError.StateConflict(
                        $"ward '{area}' ({ward.Label}) is retired — a bed cannot be moved into it; reactivate the ward or pick an active one");
                var occupant = db.Encounters.AsNoTracking()
                    .FirstOrDefault(e => e.Status == "open" && e.BedId == bedId);
                if (occupant is not null)
                {
                    var name = db.AdtPatients.AsNoTracking()
                        .FirstOrDefault(p => p.PatientId == occupant.PatientId)?.DisplayName ?? occupant.PatientId;
                    return ApiError.StateConflict(
                        $"bed '{bedId}' is occupied by {occupant.PatientId} ({name}, encounter {occupant.EncounterId}) — "
                        + "you cannot change the ward of a bed a patient is in; discharge or transfer them first");
                }
            }
            var actor = user.FindFirst("name")?.Value ?? "Unknown";
            var changes = new List<string>();
            if (areaChanged) changes.Add($"ward '{row.Area}' → '{area}'");
            if (seqChanged) changes.Add($"position {row.Seq} → {req.Seq}");
            row.EventsJson = FormularyLogic.AppendEvents(row.EventsJson,
                [new(FormularyLogic.Now(), actor, "changed", string.Join(" · ", changes))]);
            if (areaChanged) row.Area = area;
            if (req.Seq is int newSeq) row.Seq = newSeq;
            db.SaveChanges();
            return Results.Json(BedDto(db, row), JsonOpts.Web);
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
            return Results.Json(BedDto(db, row), JsonOpts.Web);
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
            return Results.Json(BedDto(db, row), JsonOpts.Web);
        }).RequireAuthorization();
    }
}

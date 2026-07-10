using Aurora.Core.Persistence;
using Microsoft.EntityFrameworkCore;
using Aurora.Core.Shared;

namespace Aurora.Core.Adt;

/* ------------- THE clinical-initiation chokepoint (Aurora Core) -------------
   The aggregate root is Patient → Encounter → {Orders, MAR, …}: an order's
   lifecycle is bounded by its ENCOUNTER, and every path that INITIATES new
   care asserts the encounter is open HERE — create order, sign, modify,
   implement, administer, and lab/imaging RESULT creation (results audit
   PR); consult REQUEST writes join this chokepoint when that write path
   exists. One place, not scattered per-endpoint conditions.

   THE INVARIANT IS DELIBERATELY NARROW — a closed encounter is NOT
   immutable: you cannot initiate new care on a closed episode, but you must
   still be able to COMPLETE THE RECORD of care already given. Explicitly
   exempt (never route through this guard): result acknowledgment AND its
   audited reversal (un-acknowledge), note authoring and addenda, the
   discharge summary, audited amendments, and the manual discontinue of a
   stray order (closing out the record is not initiating care). A system
   that cannot attach a day-7 blood culture result to a day-3 draw loses
   clinical data — which is why acknowledge/un-acknowledge on a result
   CREATED while the encounter was open must keep working after discharge,
   even though creating a NEW result then requires an open encounter.

   Blocking here is RESOURCE STATE, not validation and not permission — a
   Consultant with full prescribing authority is equally blocked — so the
   answer is 409 Conflict with a precise {error}, never 400/403/404.

   Lifecycle and system writes (the discharge cascade, the one-time
   encounter-scope backfill) write to closed encounters BY DESIGN and go
   through their own explicitly-named paths with their own audit semantics
   (OrderLogic.DischargeCascade / OrderLogic.BackfillEncounterScope) — they
   never call this guard and there is no bypass flag on it. */
static class EncounterGuard
{
    /** 409 when the encounter is not open; null when initiation may proceed. */
    public static IResult? RequireOpen(AuroraDb db, string encounterId, string action)
    {
        if (db.Encounters.AsNoTracking().Any(e => e.EncounterId == encounterId && e.Status == "open"))
            return null;
        return Results.Json(new
        {
            error = $"encounter '{encounterId}' is not open — {action} is not permitted: new care cannot be initiated on a closed episode",
        }, JsonOpts.Web, statusCode: 409);
    }

    /** create-time form: the patient must have an OPEN encounter (the
        forward half of the invariant). Unknown patients are the caller's
        VALIDATION concern (400) — this guard only answers the state
        question, with the open encounter handed back for scoping. */
    public static IResult? RequireOpenForPatient(AuroraDb db, string patientId, string action, out Encounter? open)
    {
        open = db.Encounters.AsNoTracking()
            .FirstOrDefault(e => e.PatientId == patientId && e.Status == "open");
        if (open is not null) return null;
        return Results.Json(new
        {
            error = $"patient '{patientId}' has no open encounter — {action} is not permitted: new care cannot be initiated on a closed episode",
        }, JsonOpts.Web, statusCode: 409);
    }
}

using System.Security.Claims;
using System.Text.Json;
using Aurora.Core.Adt;
using Aurora.Core.Identity;
using Aurora.Core.Orders;
using Aurora.Core.Persistence;
using Aurora.Core.Shared;
using Microsoft.EntityFrameworkCore;

namespace Aurora.Core.Mar;

/* ---------------- Medication Administration Record (Stage 10 Phase 3, MAR) ----------------
   The MAR has NO table of its own: administrations live on the Orders
   table (the administrations JSON of signed medication orders), so these
   endpoints read from and mutate the REAL orders store — never a parallel
   copy (the dependency direction is deliberate: MAR derives from Orders).
   RBAC polarity FLIPS vs the prescriber mutations: administering a
   dose requires the NURSE's meds.administer, so a doctor token is 403'd
   here (mirroring implement). The administering actor is always the
   token's name claim. Given needs no reason; Held/Refused require one
   (validated like discontinue). */
static class MarApi
{
    public static void Map(WebApplication app)
    {
        /* GET /api/icu/mar — unit-wide MAR rows, DERIVED server-side at read time
           from the orders' administrations (derived state is never stored). The
           nurse-assignment narrowing stays a client-side derivation, same as the
           orders implement queue. */
        app.MapGet("/api/icu/mar", (System.Security.Claims.ClaimsPrincipal user, AuroraDb db) =>
        {
            if (Identity.Rbac.Deny(user, "orders.view") is IResult denied) return denied;
            /* ENCOUNTER SCOPE (defense in depth): MAR rows derive only from
               orders on OPEN encounters — a discharged admission's schedule
               must never surface as current doses (the ORD-113 class). On
               healthy data this changes nothing: discharge already
               discontinued those orders. */
            var open = db.Encounters.AsNoTracking()
                .Where(e => e.Status == "open").Select(e => e.EncounterId).ToHashSet();
            return Results.Json(db.Orders.AsNoTracking()
                .Where(o => o.MedicationJson != null && o.AdministrationsJson != null)
                .OrderBy(o => o.Seq)
                .AsEnumerable()
                .Where(o => open.Contains(o.EncounterId))
                .SelectMany(MarLogic.MarRowsFor), JsonOpts.Web);
        }).RequireAuthorization();

        /* POST /api/icu/mar/{orderId}/administrations/{adminId} — document a dose
           (Given/Held/Refused). Nurse RBAC (meds.administer); doctor → 403.
           Body: { action, reason? }; reason required for held/refused. */
        app.MapPost("/api/icu/mar/{orderId}/administrations/{adminId}",
            (string orderId, string adminId, AdministerRequest req, ClaimsPrincipal user, AuroraDb db) =>
        {
            if (Rbac.Deny(user, "meds.administer") is IResult denied) return denied;
            if (req.Action is not ("given" or "held" or "refused"))
                return ApiError.BadRequest("action must be one of: given, held, refused");
            var needsReason = req.Action is "held" or "refused";
            if (needsReason && string.IsNullOrWhiteSpace(req.Reason))
                return ApiError.BadRequest($"reason is required when a dose is {req.Action}");
            if (req.Reason is not null && req.Reason.Length > OrderLogic.MaxTextLength)
                return ApiError.BadRequest($"reason exceeds {OrderLogic.MaxTextLength} characters");

            var row = db.Orders.FirstOrDefault(x => x.OrderId == orderId);
            if (row is null || row.AdministrationsJson is null)
                return ApiError.NotFound();   // absent order, or no dose schedule exists on it — the adminId resolves to nothing
            /* THE CHOKEPOINT (409, resource state): the encounter must be
               OPEN — asserted independently of order status so the two can
               never diverge silently, and even a Consultant with full
               authority is equally blocked. */
            if (EncounterGuard.RequireOpen(db, row.EncounterId, "documenting a dose") is IResult conflict) return conflict;
            var admins = JsonSerializer.Deserialize<List<AdminDto>>(row.AdministrationsJson, JsonOpts.Web)!;
            var idx = admins.FindIndex(a => a.AdminId == adminId);
            if (idx < 0) return ApiError.NotFound();
            /* FOUR-CODE RULE (state-conflict PR — this DELIBERATELY
               REVERSES the codified "re-document of a non-scheduled dose
               → 404"): the dose EXISTS, it is simply already documented.
               Two nurses racing at the same bedside must see "already
               given by X at T", never "not found" — a 404 tells the
               second nurse the dose vanished; a 409 tells them their
               colleague documented it first. */
            if (admins[idx].Status != "scheduled")
                return ApiError.StateConflict(
                    $"dose '{adminId}' was already documented as {admins[idx].Status}"
                    + (admins[idx].DocumentedBy is null ? "" : $" by {admins[idx].DocumentedBy} at {admins[idx].DocumentedTime}")
                    + " — it is not awaiting documentation");

            var actor = user.FindFirst("name")?.Value ?? "Unknown";
            var time = DateTime.UtcNow.ToString("yyyy-MM-dd HH:mm");
            var reason = needsReason ? req.Reason!.Trim() : null;
            admins[idx] = admins[idx] with
            {
                Status = req.Action, DocumentedTime = time, DocumentedBy = actor, Reason = reason,
            };
            row.AdministrationsJson = JsonSerializer.Serialize(admins, JsonOpts.Web);
            var verb = req.Action == "given" ? "administered" : req.Action;
            var detail = $"{(admins[idx].ScheduledTime.Length > 0 ? admins[idx].ScheduledTime : "PRN")} dose {req.Action} at {time}"
                + (reason is not null ? $" — {reason}" : "");
            row.HistoryJson = OrderLogic.AppendHistory(row.HistoryJson, new(time, actor, verb, detail));
            db.SaveChanges();
            return Results.Json(row.ToDto(), JsonOpts.Web);
        }).RequireAuthorization();
    }
}

/* MAR derivation — relocated from OrderLogic (it is MAR logic that READS
   orders, not orders logic). */
static class MarLogic
{
    /** MAR rows for one order, DERIVED exactly as the mock deriveMarRows:
        a scheduled administration only appears while the order is active;
        documented ones stay for the shift record. */
    public static IEnumerable<MarRowDto> MarRowsFor(OrderRow o)
    {
        var m = JsonSerializer.Deserialize<MedicationDto>(o.MedicationJson!, JsonOpts.Web)!;
        var admins = JsonSerializer.Deserialize<List<AdminDto>>(o.AdministrationsJson!, JsonOpts.Web)!;
        var route = $"{m.Route} · {(m.Prn ? $"PRN — {m.PrnIndication ?? "as required"}" : m.Frequency)}";
        foreach (var a in admins)
        {
            if (o.Status != "active" && a.Status == "scheduled") continue;
            yield return new MarRowDto(o.OrderId, a.AdminId, o.PatientId, o.BedId, m.Drug,
                m.Dose, route, a.ScheduledTime, m.Prn, a.Status, a.DocumentedTime);
        }
    }
}

/* MAR row — mirrors MarRow in src/lib/api/types.ts; derived at read time
   from the orders' administrations, never stored. */
record MarRowDto(
    string OrderId, string AdminId, string PatientId, string BedId, string Medication,
    string Dose, string Route, string ScheduledTime, bool Prn, string Status,
    string? DocumentedTime);

/* MAR administration action request (Stage 10 Phase 3) — Disallow rejects
   any unrecognized field; action/reason validated explicitly in the
   endpoint (reason required for held/refused, like discontinue). */
[System.Text.Json.Serialization.JsonUnmappedMemberHandling(System.Text.Json.Serialization.JsonUnmappedMemberHandling.Disallow)]
record AdministerRequest(string? Action, string? Reason);

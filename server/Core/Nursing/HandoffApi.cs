using System.Security.Claims;
using Aurora.Core.Adt;
using Aurora.Core.Identity;
using Aurora.Core.Persistence;
using Aurora.Core.Shared;
using Microsoft.EntityFrameworkCore;

namespace Aurora.Core.Nursing;

/* ---------------- SBAR Handoff API ----------------
   Append-only, encounter-scoped (see HandoffModels.cs for the owner's
   2026-07-18 model decisions). Nurse-gated by PROFILE only
   (handoff.document) — the #114 assignment gate was DROPPED with the
   Assignment Simplification (owner's decision): any nurse posts on any
   patient, fully global like charting and administration.
   There is deliberately NO update and NO delete surface — an entry is
   what was communicated at that handover; the next entry is the only
   way forward. */
static class HandoffApi
{
    const int MaxFieldLength = 4000;

    public static void Map(WebApplication app)
    {
        /* GET /api/icu/nursing/handoff?patientId[&encounterId] — the
           series, NEWEST FIRST (the latest handover is what the next
           shift reads). Without encounterId the OPEN encounter's series
           answers (the workspace's question); an explicit encounterId
           reads that admission — including a closed one (history is
           readable forever; the lifecycle only closes WRITES). A patient
           with no open encounter and no encounterId answers [] — the
           honest empty, never an invented note. Read gate patients.view
           (every clinical viewer — the observations chart precedent). */
        app.MapGet("/api/icu/nursing/handoff", (HttpContext ctx, ClaimsPrincipal user, AuroraDb db) =>
        {
            if (Rbac.Deny(user, "patients.view") is IResult denied) return denied;
            foreach (var key in ctx.Request.Query.Keys)
                if (key is not ("patientId" or "encounterId"))
                    return ApiError.BadRequest($"unknown query parameter '{key}'");
            var patientId = ctx.Request.Query["patientId"].ToString();
            if (patientId.Length == 0) return ApiError.BadRequest("patientId is required");
            var encounterId = ctx.Request.Query["encounterId"].ToString();
            if (encounterId.Length == 0)
                encounterId = db.Encounters.AsNoTracking()
                    .FirstOrDefault(e => e.PatientId == patientId && e.DischargedAt == null)?.EncounterId ?? "";
            if (encounterId.Length == 0) return Results.Json(Array.Empty<HandoffDto>(), JsonOpts.Web);
            return Results.Json(db.Handoffs.AsNoTracking()
                .Where(h => h.PatientId == patientId && h.EncounterId == encounterId)
                .OrderByDescending(h => h.Seq)
                .AsEnumerable().Select(h => h.ToDto()), JsonOpts.Web);
        }).RequireAuthorization();

        /* POST /api/icu/nursing/handoff — write ONE new immutable entry.
           Gate order keeps the 403s honest:
           1. handoff.document — the Nurse-profile permission (owner's
              decision: nurse-only; the doctor handoff is a separate,
              undesigned record). This is the ONLY authority gate —
              coverage gates nothing (Assignment Simplification).
           2. shape: patient exists, ≥1 of the four fields non-empty,
              each ≤ 4000 chars.
           3. EncounterGuard — a handoff is care on the admission: 409 on
              a closed episode. */
        app.MapPost("/api/icu/nursing/handoff", (WriteHandoffRequest req, ClaimsPrincipal user, AuroraDb db) =>
        {
            if (Rbac.Deny(user, "handoff.document") is IResult denied) return denied;
            var patientId = req.PatientId?.Trim() ?? "";
            if (patientId == "") return ApiError.BadRequest("patientId is required");
            if (!db.AdtPatients.AsNoTracking().Any(p => p.PatientId == patientId))
                return ApiError.BadRequest($"patientId '{patientId}' does not match any patient");
            var s = req.S?.Trim() ?? ""; var b = req.B?.Trim() ?? "";
            var a = req.A?.Trim() ?? ""; var r = req.R?.Trim() ?? "";
            if (s == "" && b == "" && a == "" && r == "")
                return ApiError.BadRequest("an empty handoff cannot be recorded — write at least one SBAR field");
            foreach (var (label, value) in new[] { ("situation", s), ("background", b), ("assessment", a), ("recommendation", r) })
                if (value.Length > MaxFieldLength)
                    return ApiError.BadRequest($"{label} exceeds {MaxFieldLength} characters");
            if (EncounterGuard.RequireOpenForPatient(db, patientId, "recording a handoff", out var enc) is IResult conflict)
                return conflict;
            var username = user.FindFirst("sub")?.Value ?? "";
            /* the #114 assignment gate is DROPPED (Assignment
               Simplification, owner's decision): any nurse posts an SBAR
               handoff on ANY patient — fully global like charting and
               administration. Coverage gates NOTHING; worklist is never
               authority, with zero exceptions. */
            var row = new HandoffRow
            {
                HandoffId = HandoffLogic.NextId(),
                Seq = HandoffLogic.NextSeq(db),
                EncounterId = enc!.EncounterId,
                PatientId = patientId,
                S = s, B = b, A = a, R = r,
                RecordedByUser = username,
                RecordedBy = user.FindFirst("name")?.Value ?? "Unknown",
                RecordedRole = Rbac.ProfileOf(user.FindFirst("jobTitle")?.Value ?? "") ?? "Unknown",
                RecordedAt = DateTime.UtcNow.ToString("yyyy-MM-dd HH:mm"),
            };
            db.Handoffs.Add(row);
            db.SaveChanges();
            return Results.Json(row.ToDto(), JsonOpts.Web);
        }).RequireAuthorization();
    }
}

static class HandoffLogic
{
    static long _seq;

    /* counters resume from the highest persisted id — restart-safe
       against the durable DB (the OrderLogic lesson) */
    public static void InitializeCounters(AuroraDb db)
    {
        var max = db.Handoffs.AsNoTracking().AsEnumerable()
            .Select(h => long.TryParse(h.HandoffId.StartsWith("HDO-") ? h.HandoffId[4..] : "", out var n) ? n : 0)
            .DefaultIfEmpty(1000).Max();
        Interlocked.Exchange(ref _seq, Math.Max(max, 1000));
    }

    public static string NextId() => $"HDO-{Interlocked.Increment(ref _seq)}";

    public static int NextSeq(AuroraDb db) =>
        (db.Handoffs.AsNoTracking().Select(h => (int?)h.Seq).Max() ?? 0) + 1;
}

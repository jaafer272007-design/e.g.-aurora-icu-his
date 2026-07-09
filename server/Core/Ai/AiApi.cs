using Aurora.Core.Persistence;
using Aurora.Core.Shared;
using Microsoft.EntityFrameworkCore;

namespace Aurora.Core.Ai;

/* ---------------- AI Clinical Assistant (Stage 10 Phase 3, FINAL domain) ----------------
   THE canonical AI risk store. Everything is SIMULATED mock model output
   until Stage 11 — no real inference is added here. Read-only for every
   role (like Timeline): no mutations, no new RBAC surface; auth required,
   both doctor and nurse read. Risk TREND (rising/falling/stable) and the
   ~2 h DELTA are COMPUTED at read time from each risk's history — never
   stored (same locked rule as clock-computed states). Mission Control's
   AI panel + the alert-center integration keep deriving from this same
   store (the mock adapter path until getPatientDetail migrates — no
   parallel copy). */
static class AiApi
{
    public static void Map(WebApplication app)
    {
        /* GET /api/icu/ai/ranking — unit-wide ranking by highest current risk;
           top.trend/top.delta and alsoElevated all derived server-side at read. */
        app.MapGet("/api/icu/ai/ranking", (HttpContext ctx, AuroraDb db) =>
        {
            foreach (var key in ctx.Request.Query.Keys)
                return ApiError.BadRequest($"unknown query parameter '{key}'");
            return Results.Json(AiLogic.Ranking(db), JsonOpts.Web);
        }).RequireAuthorization();

        /* GET /api/icu/ai/risks?patientId — one patient's simulated risk profile
           (categories, probabilities, q15min history, factors, suggestions). */
        app.MapGet("/api/icu/ai/risks", (HttpContext ctx, AuroraDb db) =>
        {
            foreach (var key in ctx.Request.Query.Keys)
                if (key != "patientId") return ApiError.BadRequest($"unknown query parameter '{key}'");
            var patientId = ctx.Request.Query["patientId"].ToString();
            if (string.IsNullOrWhiteSpace(patientId)) return ApiError.BadRequest("patientId is required");
            var row = db.AiRisks.AsNoTracking().FirstOrDefault(a => a.PatientId == patientId);
            if (row is null)
            {
                /* distinguish "not an ICU patient" (400, like other domains) from
                   "a real patient with no AI profile yet" (200 null) */
                if (!db.Patients.AsNoTracking().Any(p => p.PatientId == patientId))
                    return ApiError.BadRequest($"patientId '{patientId}' does not match any roster patient");
                return Results.Json<AiProfileDto?>(null, JsonOpts.Web);
            }
            return Results.Json(row.ToDto(), JsonOpts.Web);
        }).RequireAuthorization();
    }
}

/* ---------- AI Clinical Assistant derivation (Stage 10 Phase 3, FINAL) ----------
   Ports the mock ai.ts derivations EXACTLY: riskTrendOf, isElevated, toRanked
   and deriveRiskRanking. The store keeps only each risk's history[] +
   probability; trend (rising/falling/stable) and the ~2 h delta are computed
   HERE at read time — never persisted (locked clock-computed-state rule).
   Everything is simulated mock model output until Stage 11. */
static class AiLogic
{
    /* trend from the q15min history — delta of last vs first sample */
    public static string RiskTrendOf(List<int> history)
    {
        var delta = history[^1] - history[0];
        return delta >= 4 ? "rising" : delta <= -4 ? "falling" : "stable";
    }

    /* elevated = high now, or moderate and climbing (gates ranking chips) */
    public static bool IsElevated(RiskPredictionDto r) =>
        r.Probability >= 60 || (r.Probability >= 45 && RiskTrendOf(r.History) == "rising");

    static RankedRiskDto ToRanked(RiskPredictionDto r) =>
        new(r.Category, r.Probability, RiskTrendOf(r.History), r.Probability - r.History[0]);

    /* Unit-wide ranking by highest current risk across any category —
       mirrors deriveRiskRanking() byte-for-byte (roster join for diagnosis,
       sort by top.probability desc, alsoElevated = the rest that are elevated).
       The db.Patients read is part of the sanctioned Core→Module seam. */
    public static List<RiskRankingRowDto> Ranking(AuroraDb db)
    {
        var patients = db.Patients.AsNoTracking().ToDictionary(p => p.PatientId, p => p.Diagnosis);
        return db.AiRisks.AsNoTracking().OrderBy(a => a.Seq).AsEnumerable()
            .Select(row =>
            {
                var profile = row.ToDto();
                var sorted = profile.Risks.OrderByDescending(r => r.Probability).ToList();
                var top = sorted[0];
                return new RiskRankingRowDto(
                    profile.PatientId, profile.BedId, profile.PatientName,
                    patients.TryGetValue(profile.PatientId, out var dx) ? dx : "",
                    ToRanked(top), top.History,
                    sorted.Skip(1).Where(IsElevated).Select(ToRanked).ToList(),
                    profile.UpdatedAt);
            })
            .OrderByDescending(r => r.Top.Probability)
            .ToList();
    }
}

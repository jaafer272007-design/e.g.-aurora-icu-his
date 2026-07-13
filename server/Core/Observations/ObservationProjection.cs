using System.Globalization;
using System.Text.Json;
using Aurora.Core.Persistence;
using Aurora.Core.Shared;
using Microsoft.EntityFrameworkCore;

namespace Aurora.Core.Observations;

/* ---------------- the §5 bedside READ PROJECTION (§12 step 4) ----------------
   Produces "the latest charted Observation per type" for a patient's
   encounter — the stable shape bedside displays consume. ENCOUNTER-scoped
   on purpose: a readmission never inherits a prior stay's vitals (the
   honest-data rule applied across episodes). Amend-not-erase means the
   EFFECTIVE value is the last amendment's newValue when amendments exist.
   Consumers today: the roster read (bed board + Mission Control values).
   The future Device Adapter feeds the same Observations, so the same
   projection lights the same tiles with no display change. */
static class ObservationProjection
{
    public record Latest(string Value, string ClinicalTime, string Source);

    /** latest effective observation per typeCode, per encounter, for a set
        of encounters — one query, grouped in memory (unit-roster scale) */
    public static Dictionary<string, Dictionary<string, Latest>> LatestForEncounters(
        AuroraDb db, IReadOnlyCollection<string> encounterIds)
    {
        var rows = db.Observations.AsNoTracking()
            .Where(o => encounterIds.Contains(o.EncounterId))
            .OrderBy(o => o.ClinicalTime).ThenBy(o => o.ObservationId)
            .ToList();
        return rows.GroupBy(o => o.EncounterId).ToDictionary(
            enc => enc.Key,
            enc => enc.GroupBy(o => o.TypeCode).ToDictionary(
                g => g.Key,
                g =>
                {
                    var o = g.Last();
                    var amendments = JsonSerializer.Deserialize<List<AmendmentDto>>(o.AmendmentsJson, JsonOpts.Web)!;
                    var value = amendments.Count > 0 ? amendments[^1].NewValue : o.Value;
                    return new Latest(value, o.ClinicalTime, o.Source);
                }));
    }

    /** a projected numeric value, invariant-parsed; null when the type has
        no charted observation (or a non-numeric stored value) */
    public static double? Number(this Dictionary<string, Latest>? latest, string typeCode) =>
        latest is not null
        && latest.TryGetValue(typeCode, out var l)
        && double.TryParse(l.Value, NumberStyles.Float, CultureInfo.InvariantCulture, out var n)
            ? n : null;

    /** a projected enum/string value; null when never charted */
    public static string? Text(this Dictionary<string, Latest>? latest, string typeCode) =>
        latest is not null && latest.TryGetValue(typeCode, out var l) ? l.Value : null;
}

using System.Globalization;
using System.Text.Json;
using Aurora.Core.Persistence;
using Aurora.Core.Shared;

namespace Aurora.Core.Observations;

/* ---------------- The Observation Service (design §5 — the single choke
   point) — §12 step 2: validation + the write rules.
   Every producer goes through here: MANUAL today; the Device Adapter is
   producer #2 later, calling the SAME validation and store. Validation is
   CATALOGUE-DRIVEN (Pillar 2): the rules come from the ObservationTypes
   rows, never from code — adding/adjusting a type is data. */
static class ObservationService
{
    public const int SelfCorrectWindowMinutes = 5;   // §8 tier-1, flat

    /** Validate one charted value against its catalogue row and return
        the NORMALIZED storage text, or set problem (400 material).
        numeric → invariant-parsed within the plausibility range;
        enum → one of allowedValues; compound → an object carrying
        EXACTLY the defined components, each validated by its kind. */
    public static string? Normalize(ObservationTypeRow t, JsonElement value, out string? problem)
    {
        problem = null;
        switch (t.ValueType)
        {
            case "numeric":
            {
                double n;
                if (value.ValueKind == JsonValueKind.Number) n = value.GetDouble();
                else if (value.ValueKind == JsonValueKind.String &&
                         double.TryParse(value.GetString(), NumberStyles.Float, CultureInfo.InvariantCulture, out var p)) n = p;
                else { problem = $"'{t.TypeCode}' must be numeric ({t.Unit})"; return null; }
                if (n < t.Min || n > t.Max)
                { problem = $"'{t.TypeCode}' {n.ToString(CultureInfo.InvariantCulture)} {t.Unit} is outside the plausible range {t.Min}–{t.Max}"; return null; }
                return n.ToString(CultureInfo.InvariantCulture);
            }
            case "enum":
            {
                var allowed = JsonSerializer.Deserialize<List<string>>(t.AllowedValuesJson!, JsonOpts.Web)!;
                var s = value.ValueKind == JsonValueKind.String ? value.GetString() : null;
                if (s is null || !allowed.Contains(s))
                { problem = $"'{t.TypeCode}' must be one of: {string.Join(", ", allowed)}"; return null; }
                return s;
            }
            case "compound":
            {
                if (value.ValueKind != JsonValueKind.Object)
                { problem = $"'{t.TypeCode}' is a compound observation — send an object with its components"; return null; }
                var comps = JsonSerializer.Deserialize<List<ComponentDto>>(t.ComponentsJson!, JsonOpts.Web)!;
                var given = value.EnumerateObject().ToDictionary(p => p.Name, p => p.Value);
                var extra = given.Keys.Except(comps.Select(c => c.Code)).ToList();
                if (extra.Count > 0)
                { problem = $"'{t.TypeCode}' has no component '{extra[0]}' — components are: {string.Join(", ", comps.Select(c => c.Code))}"; return null; }
                var normalized = new Dictionary<string, object>();
                foreach (var c in comps)
                {
                    if (!given.TryGetValue(c.Code, out var v))
                    { problem = $"'{t.TypeCode}' is missing component '{c.Code}'"; return null; }
                    if (c.Kind == "numeric")
                    {
                        double n;
                        if (v.ValueKind == JsonValueKind.Number) n = v.GetDouble();
                        else if (v.ValueKind == JsonValueKind.String &&
                                 double.TryParse(v.GetString(), NumberStyles.Float, CultureInfo.InvariantCulture, out var p)) n = p;
                        else { problem = $"'{t.TypeCode}.{c.Code}' must be numeric"; return null; }
                        if (n < c.Min || n > c.Max)
                        { problem = $"'{t.TypeCode}.{c.Code}' {n.ToString(CultureInfo.InvariantCulture)} is outside {c.Min}–{c.Max}"; return null; }
                        normalized[c.Code] = n;
                    }
                    else
                    {
                        var s = v.ValueKind == JsonValueKind.String ? v.GetString() : null;
                        if (s is null || !c.Values!.Contains(s))
                        { problem = $"'{t.TypeCode}.{c.Code}' must be one of: {string.Join(", ", c.Values!)}"; return null; }
                        normalized[c.Code] = s;
                    }
                }
                return JsonSerializer.Serialize(normalized, JsonOpts.Web);
            }
            default:
                problem = $"'{t.TypeCode}' has an unknown valueType '{t.ValueType}' in the catalogue";
                return null;
        }
    }

    /** the §8 tier decision for a correction attempt: tier-1 (self, inside
        the flat 5-minute window from ENTRY time) — otherwise tier-2 */
    public static bool IsSelfTier(ObservationRow o, string actor, DateTime utcNow) =>
        o.RecordedBy == actor
        && DateTime.TryParseExact(o.EnteredAt, "yyyy-MM-dd HH:mm:ss",
               CultureInfo.InvariantCulture, DateTimeStyles.None, out var entered)
        && (utcNow - entered) <= TimeSpan.FromMinutes(SelfCorrectWindowMinutes);
}

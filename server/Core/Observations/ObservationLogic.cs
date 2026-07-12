using System.Globalization;
using Aurora.Core.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Aurora.Core.Observations;

/* vocabulary + validation + persistence-aware id counter.
   The type vocabulary is a CLOSED server-side list (the frequency-
   vocabulary precedent, pre-master-data): exactly the bedside values the
   clinical validator required manual entry for — vitals, NIBP,
   hemodynamics incl. CVP, and ventilator settings. Adding a TYPE is a
   row here (and later a master-data table), never a model change.
   Ranges are wide PHYSIOLOGICAL PLAUSIBILITY bounds — they catch
   impossible entries (typos), never clinical judgement. */
static class ObservationLogic
{
    public sealed record TypeDef(
        string Type, string Label, string Unit, string Kind, string Group,
        double Min = 0, double Max = 0, string[]? Choices = null);

    public static readonly TypeDef[] Types =
    [
        // vitals
        new("hr",       "Heart rate",           "bpm",    "numeric", "Vitals", 0, 350),
        new("temp",     "Temperature",          "°C",     "numeric", "Vitals", 25, 45),
        new("rr",       "Respiratory rate",     "/min",   "numeric", "Vitals", 0, 80),
        new("spo2",     "SpO₂",                 "%",      "numeric", "Vitals", 0, 100),
        // NIBP
        new("nibp_sys", "NIBP systolic",        "mmHg",   "numeric", "NIBP", 0, 350),
        new("nibp_dia", "NIBP diastolic",       "mmHg",   "numeric", "NIBP", 0, 250),
        // hemodynamics (invasive)
        new("abp_sys",  "Arterial BP systolic", "mmHg",   "numeric", "Hemodynamics", 0, 350),
        new("abp_dia",  "Arterial BP diastolic","mmHg",   "numeric", "Hemodynamics", 0, 250),
        new("map",      "Mean arterial pressure","mmHg",  "numeric", "Hemodynamics", 0, 250),
        new("cvp",      "Central venous pressure","mmHg", "numeric", "Hemodynamics", -10, 50),
        // ventilator settings
        new("vent_mode","Ventilator mode",      "",       "choice",  "Ventilator",
            Choices: ["PC-AC", "VC-AC", "PRVC", "SIMV", "PSV", "CPAP", "BiPAP", "NIV", "HFNC", "T-piece"]),
        new("fio2",     "FiO₂",                 "%",      "numeric", "Ventilator", 21, 100),
        new("peep",     "PEEP",                 "cmH₂O",  "numeric", "Ventilator", 0, 30),
        new("vt",       "Tidal volume",         "mL",     "numeric", "Ventilator", 0, 1500),
        new("vent_rate","Set ventilator rate",  "/min",   "numeric", "Ventilator", 0, 60),
    ];

    public static TypeDef? Resolve(string? type) =>
        type is null ? null : Array.Find(Types, t => t.Type == type);

    /** null when valid; the precise problem otherwise (400 material) */
    public static string? ValidateValue(TypeDef def, string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
            return $"a value is required for '{def.Type}'";
        var v = value.Trim();
        if (def.Kind == "choice")
            return def.Choices!.Contains(v) ? null
                : $"'{def.Type}' must be one of: {string.Join(", ", def.Choices!)}";
        if (!double.TryParse(v, NumberStyles.Float, CultureInfo.InvariantCulture, out var n))
            return $"'{def.Type}' must be numeric ({def.Unit})";
        if (n < def.Min || n > def.Max)
            return $"'{def.Type}' {v} {def.Unit} is outside the plausible range {def.Min}–{def.Max}";
        return null;
    }

    /** capturedAt: dated UTC "yyyy-MM-dd HH:mm" (the audit-time
        convention — a flowsheet must order across days, unlike the ADT
        HH:mm display stamps); charting may lag the measurement, so any
        past time is honest, but a FUTURE time is an entry error */
    public static string? ValidateCapturedAt(string? capturedAt)
    {
        if (string.IsNullOrWhiteSpace(capturedAt))
            return "capturedAt is required (yyyy-MM-dd HH:mm, UTC)";
        if (!DateTime.TryParseExact(capturedAt.Trim(), "yyyy-MM-dd HH:mm",
                CultureInfo.InvariantCulture, DateTimeStyles.None, out var t))
            return "capturedAt must be formatted yyyy-MM-dd HH:mm (UTC)";
        if (t > DateTime.UtcNow.AddMinutes(10))
            return $"capturedAt '{capturedAt.Trim()}' is in the future — an observation cannot be measured after it is charted";
        return null;
    }

    /* PERSISTENCE-AWARE COUNTER (the OrderLogic rule): resume from the
       highest persisted id so a restart against a durable database never
       re-issues one. No seed block exists — the floor is 1000. */
    static int _seq = 1000;
    public static string NextId() => $"OBS-{Interlocked.Increment(ref _seq)}";

    public static void InitializeCounters(AuroraDb db)
    {
        static int SuffixOf(string id) =>
            int.TryParse(id[(id.IndexOf('-') + 1)..], out var n) ? n : 0;
        _seq = db.Observations.AsNoTracking().Select(o => o.ObservationId).AsEnumerable()
            .Select(SuffixOf).DefaultIfEmpty(1000).Max();
    }
}

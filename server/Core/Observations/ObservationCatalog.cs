using System.Text.Json;
using Aurora.Core.Persistence;
using Aurora.Core.Shared;
using Microsoft.EntityFrameworkCore;

namespace Aurora.Core.Observations;

/* The Observation Type Catalogue SEED — the §1 clinical taxonomy of
   docs/design/stage11-observation-model.md as DATA. All 8 groups; every
   type from the validator's list; derived values marked isDerived with
   their derivation inputs (computed at read, never charted); the
   taxonomy's set-vs-measured distinctions kept as separate types; the
   optional/conditional markers carried on the rows.

   Seeded in EVERY environment (non-hospital-specific clinical reference
   data — the lab-catalogue/frequency-vocabulary precedent), idempotent
   per table (seed-if-empty). v1 ships the catalogue READ-ONLY (the F3
   decision): no management endpoints exist; adding a type later is a
   catalogue row.

   HONESTY NOTE (flagged for the clinical validator in the PR): numeric
   PLAUSIBILITY ranges and the enum VALUE SETS (cardiac rhythm, pupil
   reaction, ventilation modes, I:E ratios, nursing-assessment scales)
   are build-authored from standard clinical practice — the design
   specifies the TYPES but not these member lists. They are data, not
   schema: the validator can amend any of them as catalogue edits. */
static class ObservationCatalog
{
    sealed record G(string Code, string Name, bool EnabledByDefault);
    sealed record T(
        string Code, string Group, string Name, string Unit, string Kind,
        double Min = 0, double Max = 0, string[]? Values = null,
        (string Code, string Label, string Kind, double Min, double Max, string[]? Values)[]? Components = null,
        string[]? DerivedFrom = null, bool Optional = false);

    /* the 8 clinical categories (§1) — groups are data. The Devices group
       ships DISABLED by default: its taxonomy entries are device-displayed
       or future (§1 group 7), so a fresh deployment does not offer them
       for manual charting; enabling it is a configuration act. */
    static readonly G[] Groups =
    [
        new("vitals",       "Vital Signs",                    true),
        new("neuro",        "Neurological Assessment",        true),
        new("ventilator",   "Respiratory / Ventilator",       true),
        new("hemodynamics", "Hemodynamics",                   true),
        new("fluid",        "Fluid Balance",                  true),
        new("poc_lab",      "Laboratory Point-of-Care",       true),
        new("devices",      "Devices",                        false),
        new("nursing",      "Nursing Clinical Assessment",    true),
    ];

    static readonly T[] Types =
    [
        // ---- 1. Vital Signs ----
        new("hr",       "vitals", "Heart Rate",               "bpm",   "numeric", 0, 350),
        new("sbp",      "vitals", "Systolic BP",              "mmHg",  "numeric", 0, 350),
        new("dbp",      "vitals", "Diastolic BP",             "mmHg",  "numeric", 0, 250),
        new("map",      "vitals", "Mean Arterial Pressure",   "mmHg",  "numeric", 0, 250),
        new("rr",       "vitals", "Respiratory Rate",         "/min",  "numeric", 0, 80),
        new("spo2",     "vitals", "Oxygen Saturation (SpO₂)", "%",     "numeric", 0, 100),
        new("temp",     "vitals", "Body Temperature",         "°C",    "numeric", 25, 45),
        new("cardiac_rhythm", "vitals", "Cardiac Rhythm",     "",      "enum",
            Values: ["Sinus Rhythm", "Sinus Tachycardia", "Sinus Bradycardia", "Atrial Fibrillation",
                     "Atrial Flutter", "SVT", "VT", "VF", "Paced", "Junctional", "Heart Block", "Asystole"],
            Optional: true),

        // ---- 2. Neurological Assessment ----
        new("gcs",      "neuro", "Glasgow Coma Scale",        "",      "compound",
            Components: [("eye", "Eye", "numeric", 1, 4, null),
                         ("verbal", "Verbal", "numeric", 1, 5, null),
                         ("motor", "Motor", "numeric", 1, 6, null)]),
        // GCS Total is DERIVED from the components (computed at read)
        new("gcs_total","neuro", "GCS Total",                 "",      "numeric", 3, 15,
            DerivedFrom: ["gcs"]),
        new("rass",     "neuro", "RASS Sedation Score",       "",      "numeric", -5, 4),
        new("pain",     "neuro", "Pain Score (NRS)",          "",      "numeric", 0, 10),
        new("pupils",   "neuro", "Pupils",                    "",      "compound",
            Components: [("leftSize", "Left size", "numeric", 1, 10, null),
                         ("leftReaction", "Left reaction", "enum", 0, 0, ["Brisk", "Sluggish", "Fixed"]),
                         ("rightSize", "Right size", "numeric", 1, 10, null),
                         ("rightReaction", "Right reaction", "enum", 0, 0, ["Brisk", "Sluggish", "Fixed"])]),

        // ---- 3. Respiratory / Ventilator (set-vs-measured kept separate) ----
        new("vent_mode","ventilator", "Ventilation Mode",     "",      "enum",
            Values: ["PC-AC", "VC-AC", "PRVC", "SIMV", "PSV", "CPAP", "BiPAP", "NIV", "HFNC", "T-piece"]),
        new("fio2",     "ventilator", "FiO₂",                 "%",     "numeric", 21, 100),
        new("peep",     "ventilator", "PEEP",                 "cmH₂O", "numeric", 0, 30),
        new("rr_set",   "ventilator", "Set Respiratory Rate", "/min",  "numeric", 0, 60),
        new("rr_measured","ventilator","Measured Respiratory Rate","/min","numeric", 0, 80),
        new("vt_set",   "ventilator", "Tidal Volume (Set)",   "mL",    "numeric", 0, 1500),
        new("vt_exhaled","ventilator","Tidal Volume (Exhaled)","mL",   "numeric", 0, 1500),
        new("ppeak",    "ventilator", "Peak Airway Pressure (Ppeak)", "cmH₂O", "numeric", 0, 80),
        new("pplat",    "ventilator", "Plateau Pressure (Pplat)",     "cmH₂O", "numeric", 0, 80),
        new("driving_pressure", "ventilator", "Driving Pressure", "cmH₂O", "numeric", 0, 60,
            DerivedFrom: ["pplat", "peep"]),
        new("minute_ventilation", "ventilator", "Minute Ventilation", "L/min", "numeric", 0, 40),
        new("ie_ratio", "ventilator", "I:E Ratio",            "",      "enum",
            Values: ["1:1", "1:1.5", "1:2", "1:3", "1:4", "2:1"]),

        // ---- 4. Hemodynamics ----
        new("cvp",      "hemodynamics", "CVP",                "mmHg",  "numeric", -10, 50),
        new("art_sbp",  "hemodynamics", "Arterial Line Systolic",  "mmHg", "numeric", 0, 350),
        new("art_dbp",  "hemodynamics", "Arterial Line Diastolic", "mmHg", "numeric", 0, 250),
        new("pap_sys",  "hemodynamics", "Pulmonary Artery Systolic",  "mmHg", "numeric", 0, 120, Optional: true),
        new("pap_dia",  "hemodynamics", "Pulmonary Artery Diastolic", "mmHg", "numeric", 0, 80,  Optional: true),
        new("cardiac_output", "hemodynamics", "Cardiac Output", "L/min",    "numeric", 0, 20, Optional: true),
        new("cardiac_index",  "hemodynamics", "Cardiac Index",  "L/min/m²", "numeric", 0, 10, Optional: true),
        new("svr",      "hemodynamics", "SVR",                "dyn·s/cm⁵", "numeric", 0, 4000, Optional: true),

        // ---- 5. Fluid Balance (per-interval amounts; totals DERIVED) ----
        new("urine_output",  "fluid", "Urine Output",     "mL", "numeric", 0, 5000),
        new("drain_output",  "fluid", "Drain Output",     "mL", "numeric", 0, 5000),
        new("ng_output",     "fluid", "NG Output",        "mL", "numeric", 0, 5000),
        new("stool_output",  "fluid", "Stool Output",     "mL", "numeric", 0, 5000, Optional: true),
        new("oral_intake",   "fluid", "Oral Intake",      "mL", "numeric", 0, 5000),
        new("iv_fluids",     "fluid", "IV Fluids",        "mL", "numeric", 0, 10000),
        new("blood_products","fluid", "Blood Products",   "mL", "numeric", 0, 5000),
        new("total_input",   "fluid", "Total Input",      "mL", "numeric", 0, 20000,
            DerivedFrom: ["oral_intake", "iv_fluids", "blood_products"]),
        new("total_output",  "fluid", "Total Output",     "mL", "numeric", 0, 20000,
            DerivedFrom: ["urine_output", "drain_output", "ng_output", "stool_output"]),
        new("net_balance",   "fluid", "Net Balance",      "mL", "numeric", -20000, 20000,
            DerivedFrom: ["total_input", "total_output"]),

        // ---- 6. Laboratory Point-of-Care (POC only — LIS labs stay in the Labs domain, §1 hard boundary) ----
        new("glucose_cap",  "poc_lab", "Capillary Blood Glucose", "mmol/L", "numeric", 0, 50),
        new("lactate_poc",  "poc_lab", "Lactate (POC)",           "mmol/L", "numeric", 0, 30, Optional: true),

        // ---- 7. Devices (group ships DISABLED: device-displayed later;
        //         ECMO/CRRT/ICP are FUTURE catalogue data per §1) ----
        new("pump_rate", "devices", "Infusion Pump Rate",  "mL/h", "numeric", 0, 1000, Optional: true),

        // ---- 8. Nursing Clinical Assessment ----
        new("skin_integrity", "nursing", "Skin Integrity / Pressure Injury", "", "enum",
            Values: ["Intact", "At risk", "Stage 1", "Stage 2", "Stage 3", "Stage 4",
                     "Unstageable", "Deep tissue injury"]),
        new("lines_assessment", "nursing", "Lines & Catheter Assessment", "", "enum",
            Values: ["All secure — no concerns", "Site redness", "Site swelling",
                     "Dressing reinforced/changed", "Concern escalated"]),
        new("ett_position", "nursing", "ETT Position (at lips)", "cm", "numeric", 10, 35, Optional: true),
        new("airway_secretions", "nursing", "Airway Secretions", "", "enum",
            Values: ["None", "Scant", "Moderate", "Copious"]),
        new("restraint_assessment", "nursing", "Restraint Assessment", "", "enum",
            Values: ["Not in use", "In use — circulation intact", "In use — concern escalated"],
            Optional: true),

        // ---- catalogue top-ups (data, no schema change) — APPENDED so the
        //      Seq a topped-up deployment assigns equals a fresh seed's.
        // F6 (step-4 decision): EtCO₂ is chartable — standard for
        // ventilated patients; Compliance and SVV stay deferred.
        new("etco2", "ventilator", "EtCO₂", "mmHg", "numeric", 0, 100),
    ];

    public static void Seed(AuroraDb db)
    {
        if (!db.ObservationGroups.Any())
        {
            db.ObservationGroups.AddRange(Groups.Select((g, i) => new ObservationGroupRow
            {
                GroupCode = g.Code, DisplayName = g.Name, Seq = i + 1,
                Enabled = g.EnabledByDefault,
            }));
            db.SaveChanges();
        }
        /* seed-if-missing per typeCode (append-only TOP-UP): an existing
           deployment picks up newly-authored catalogue entries as data —
           the F3 v1 catalogue stays read-only at runtime, its content
           ships with the build. Existing rows are never rewritten, and
           top-ups are APPENDED in the authored array so their Seq equals
           a fresh seed's (content equality across environments). */
        var known = db.ObservationTypes.AsNoTracking().Select(t => t.TypeCode).ToHashSet();
        var missing = Types.Select((t, i) => (t, i)).Where(x => !known.Contains(x.t.Code)).ToList();
        if (missing.Count > 0)
        {
            db.ObservationTypes.AddRange(missing.Select(x => new ObservationTypeRow
            {
                TypeCode = x.t.Code, GroupCode = x.t.Group, DisplayName = x.t.Name,
                Unit = x.t.Unit, ValueType = x.t.Kind,
                Min = x.t.Kind == "numeric" ? x.t.Min : null,
                Max = x.t.Kind == "numeric" ? x.t.Max : null,
                AllowedValuesJson = x.t.Values is null ? null : JsonSerializer.Serialize(x.t.Values, JsonOpts.Web),
                ComponentsJson = x.t.Components is null ? null : JsonSerializer.Serialize(
                    x.t.Components.Select(c => new ComponentDto(
                        c.Code, c.Label, c.Kind,
                        c.Kind == "numeric" ? c.Min : null,
                        c.Kind == "numeric" ? c.Max : null,
                        c.Values?.ToList())).ToList(), JsonOpts.Web),
                IsDerived = x.t.DerivedFrom is not null,
                DerivationInputsJson = x.t.DerivedFrom is null ? null : JsonSerializer.Serialize(x.t.DerivedFrom, JsonOpts.Web),
                Optional = x.t.Optional, Seq = x.i + 1,
            }));
            db.SaveChanges();
        }
    }

    /* PERSISTENCE-AWARE COUNTER (the OrderLogic rule) for observation ids —
       used from step 2 onward; initialized with the other counters now so
       the mechanism ships with the table. */
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

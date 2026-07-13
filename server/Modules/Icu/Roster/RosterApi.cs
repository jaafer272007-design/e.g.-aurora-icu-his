using System.ComponentModel.DataAnnotations;
using System.Text.Json;
using Aurora.Core.Observations;
using Aurora.Core.Persistence;
using Aurora.Core.Shared;
using Microsoft.EntityFrameworkCore;

namespace Aurora.Modules.Icu.Roster;

/* ---------------- ICU unit roster (Stage 10 Phase 1 → Layer 2 ADT) ----------------
   Layer 2 DISSOLVES the identity/location half of the old seam: the
   roster is now a DERIVED view — Core's OPEN Encounters ⋈ Core Patient
   identity ⋈ this module's bedside snapshot table. The module reads Core
   (the CORRECT dependency direction); Core no longer reads this table
   anywhere. Admissions appear here immediately, discharges drop off, and
   transfers move beds, because bed/diagnosis/attending come from the
   Encounter.

   WHAT REMAINS of the roster table (`Patients`): ONLY the ICU bedside
   snapshot columns are read (rhythm, SOFA, EWS, support flags,
   bedside/monitor vitals, MAP trend, organs, LOS, code status) — module
   scope, absorbed by the Stage 11 Observation model. Its identity/
   location columns are dead weight kept for schema stability until
   Stage 11 removes the table. A freshly admitted patient has no bedside
   row yet, so a DEFAULT snapshot is synthesized at read time (derived,
   never stored) until Stage 11 Observations arrive. */
static class RosterApi
{
    /* GET /api/icu/patients — the canonical unit roster. Matches the
       contract documented on the frontend mock adapter; note alertCount is
       NOT served: it is a DERIVED value (AI alerts + unacked results + bed
       alert) and those domains' alert derivations are still client-side —
       the frontend adapter derives it, same as before. */
    public static void Map(WebApplication app)
    {
        app.MapGet("/api/icu/patients", (AuroraDb db) =>
        {
            var bedside = db.Patients.AsNoTracking().AsEnumerable().ToDictionary(r => r.PatientId);
            var identity = db.AdtPatients.AsNoTracking().AsEnumerable().ToDictionary(p => p.PatientId);
            var open = db.Encounters.AsNoTracking()
                .Where(e => e.Status == "open")
                .OrderBy(e => e.PatientId)
                .ToList();
            /* §12 step 4 — the bedside READ-SWAP: the vitals/monitor
               numbers on every roster record project from the LATEST
               charted Observations of the OPEN encounter (real), falling
               back per-type to the demo-seeded snapshot row where one
               exists (staging demo — F9: clearly-labelled environment,
               overridden by real wherever charted), else honestly NULL.
               Production seeds no demo rows, so production is pure
               real-or-blank by construction. */
            var projected = ObservationProjection.LatestForEncounters(
                db, open.Select(e => e.EncounterId).ToList());
            var records = open.Select(e =>
                {
                    /* identity via THE canonical resolver (Patient.ToDto —
                       the no-fork rule): the same assembly GET
                       /adt/patients/{id} and the admissions response
                       serve; age arrives computed-at-read for DOB rows
                       and as the recorded value for legacy rows, so the
                       roster wire shape (int age) is unchanged. */
                    var p = identity[e.PatientId].ToDto();
                    var b = bedside.GetValueOrDefault(e.PatientId);
                    var latest = projected.GetValueOrDefault(e.EncounterId);
                    return PatientRow.ComposeDto(b, latest, e.PatientId, e.BedId,
                        p.Name, p.Mrn, p.Age, p.Sex, e.Diagnosis, p.Allergies,
                        e.Attending, e.AdmittedAt);
                });
            return Results.Json(records, JsonOpts.Web);
        }).RequireAuthorization();
    }
}

/* One row per patient. Scalar roster fields are real columns; nested
   value objects (vitals, alert, trend, organs, flags) are stored as JSON
   text — fine for SQLite now and portable to SQL Server later. */
class PatientRow
{
    [Key]
    public string PatientId { get; set; } = "";
    public string BedId { get; set; } = "";
    public string Name { get; set; } = "";
    public string Mrn { get; set; } = "";
    public int Age { get; set; }
    public string Sex { get; set; } = "";
    public string Diagnosis { get; set; } = "";
    public int Los { get; set; }
    public string Allergies { get; set; } = "";
    public string Attending { get; set; } = "";
    public string CodeStatus { get; set; } = "";
    public string Rhythm { get; set; } = "";
    public bool Isolation { get; set; }
    public string Severity { get; set; } = "";
    public int Sofa { get; set; }
    public int Ews { get; set; }
    public string FlagsJson { get; set; } = "[]";
    public string BedsideVitalsJson { get; set; } = "{}";
    public string BedAlertJson { get; set; } = "{}";
    public string MapTrendJson { get; set; } = "[]";
    public string MonitorVitalsJson { get; set; } = "{}";
    public string OrgansJson { get; set; } = "{}";

    public static PatientRow FromDto(RosterRecordDto d) => new()
    {
        PatientId = d.PatientId, BedId = d.BedId, Name = d.Name, Mrn = d.Mrn,
        Age = d.Age, Sex = d.Sex, Diagnosis = d.Diagnosis, Los = d.Los,
        Allergies = d.Allergies, Attending = d.Attending, CodeStatus = d.CodeStatus,
        Rhythm = d.Rhythm, Isolation = d.Isolation, Severity = d.Severity,
        Sofa = d.Sofa, Ews = d.Ews,
        FlagsJson = JsonSerializer.Serialize(d.Flags, JsonOpts.Web),
        BedsideVitalsJson = JsonSerializer.Serialize(d.BedsideVitals, JsonOpts.Web),
        BedAlertJson = JsonSerializer.Serialize(d.BedAlert, JsonOpts.Web),
        MapTrendJson = JsonSerializer.Serialize(d.MapTrend, JsonOpts.Web),
        MonitorVitalsJson = JsonSerializer.Serialize(d.MonitorVitals, JsonOpts.Web),
        OrgansJson = JsonSerializer.Serialize(d.Organs, JsonOpts.Web),
    };

    /* ---- §12 step 4 — the tile→observation MAP (F7, validator-confirmed):
       arterial sys/dia ← art_sbp/art_dbp (Hemodynamics — the arterial
       line); NIBP ← sbp/dbp (Vital Signs — the cuff); MAP ← the charted
       map, never recomputed; uo ← urine_output (latest per-interval
       amount); etco2 ← the F6 catalogue top-up. */
    static readonly (string Key, string TypeCode)[] BedCardMap =
        [("hr", "hr"), ("map", "map"), ("spo2", "spo2"), ("temp", "temp"), ("uo", "urine_output")];
    static readonly (string Key, string TypeCode)[] MonitorMap =
        [("hr", "hr"), ("sys", "art_sbp"), ("dia", "art_dbp"), ("map", "map"),
         ("nibpSys", "sbp"), ("nibpDia", "dbp"), ("spo2", "spo2"), ("rr", "rr"),
         ("temp", "temp"), ("etco2", "etco2"), ("cvp", "cvp")];

    /* One composition for BOTH the demo-seeded and the fresh patient
       (Layer 2 supplies identity/encounter fields; F8: the score/organ
       snapshot columns stay as-is — derived clinical scores are a later
       piece — while the VITALS are the step-4 read-swap):
       real observation → demo snapshot value (demo rows exist only in
       demo-seeded environments) → honest null. Rhythm is chartable
       (cardiac_rhythm) → real, else demo, else an honest "—" (the old
       fabricated "SR" default is gone). */
    public static RosterRecordDto ComposeDto(PatientRow? b,
        Dictionary<string, ObservationProjection.Latest>? latest,
        string patientId, string bedId, string name, string mrn, int age, string sex,
        string diagnosis, string allergies, string attending, string admittedAt)
    {
        var demoBedCard = ParseNumbers(b?.BedsideVitalsJson);
        var demoMonitor = ParseNumbers(b?.MonitorVitalsJson);
        var alert = b is not null
            ? JsonSerializer.Deserialize<JsonElement>(b.BedAlertJson, JsonOpts.Web)
            : JsonSerializer.Deserialize<JsonElement>(JsonSerializer.Serialize(new
            {
                severity = "info",
                message = latest is { Count: > 0 }
                    ? "Newly admitted — baseline observations charted"
                    : "Newly admitted — baseline observations pending",
                time = admittedAt,
            }, JsonOpts.Web), JsonOpts.Web);
        return new RosterRecordDto(
            patientId, bedId, name, mrn, age, sex, diagnosis, b?.Los ?? 0, allergies,
            attending, b?.CodeStatus ?? "Full Code",
            latest.Text("cardiac_rhythm") ?? b?.Rhythm ?? "—",
            b?.Isolation ?? false, b?.Severity ?? "stable", b?.Sofa ?? 0, b?.Ews ?? 0,
            b is null ? [] : JsonSerializer.Deserialize<List<string>>(b.FlagsJson, JsonOpts.Web)!,
            MergeVitals(BedCardMap, latest, demoBedCard),
            alert,
            b is null ? [] : JsonSerializer.Deserialize<List<double>>(b.MapTrendJson, JsonOpts.Web)!,
            MergeVitals(MonitorMap, latest, demoMonitor),
            b is not null
                ? JsonSerializer.Deserialize<JsonElement>(b.OrgansJson, JsonOpts.Web)
                : JsonSerializer.Deserialize<JsonElement>(
                    """{"Brain":"ok","Heart":"ok","Lungs":"ok","Kidneys":"ok","Liver":"ok","Circulation":"ok"}""", JsonOpts.Web));
    }

    static Dictionary<string, double>? ParseNumbers(string? json)
    {
        if (json is null) return null;
        return JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(json, JsonOpts.Web)!
            .Where(kv => kv.Value.ValueKind == JsonValueKind.Number)
            .ToDictionary(kv => kv.Key, kv => kv.Value.GetDouble());
    }

    /** per-type: real charted value → demo snapshot value → null (never a
        fabricated number — the §5 honest-data rule on the wire) */
    static JsonElement MergeVitals((string Key, string TypeCode)[] map,
        Dictionary<string, ObservationProjection.Latest>? latest,
        Dictionary<string, double>? demo)
    {
        var merged = new Dictionary<string, double?>();
        foreach (var (key, typeCode) in map)
            merged[key] = latest.Number(typeCode)
                ?? (demo is not null && demo.TryGetValue(key, out var d) ? d : null);
        return JsonSerializer.Deserialize<JsonElement>(
            JsonSerializer.Serialize(merged, VitalsJson), JsonOpts.Web);
    }

    /* vitals nulls are MEANINGFUL on this wire ("not charted") — they must
       serialize, so this one payload opts out of Web's when-writing-null
       omission */
    static readonly JsonSerializerOptions VitalsJson = new(JsonSerializerDefaults.Web);
}

/* ---------- wire contract (camelCase over the wire) ----------
   Mirrors the frontend RosterRecordDto in src/lib/api/types.ts. Nested
   objects are passed through as-is (JsonElement) so the wire shape is
   exactly the seeded shape. */
record RosterRecordDto(
    string PatientId, string BedId, string Name, string Mrn, int Age, string Sex,
    string Diagnosis, int Los, string Allergies, string Attending, string CodeStatus,
    string Rhythm, bool Isolation, string Severity, int Sofa, int Ews,
    List<string> Flags, JsonElement BedsideVitals, JsonElement BedAlert,
    List<double> MapTrend, JsonElement MonitorVitals, JsonElement Organs);

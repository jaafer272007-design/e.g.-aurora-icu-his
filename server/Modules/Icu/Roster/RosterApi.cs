using System.ComponentModel.DataAnnotations;
using System.Text.Json;
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
            var records = db.Encounters.AsNoTracking()
                .Where(e => e.Status == "open")
                .OrderBy(e => e.PatientId)
                .AsEnumerable()
                .Select(e =>
                {
                    var p = identity[e.PatientId];
                    var b = bedside.GetValueOrDefault(e.PatientId);
                    return b is not null
                        ? b.ToDto(e.BedId, p.Name, p.Mrn, p.Age, p.Sex, e.Diagnosis, p.Allergies, e.Attending)
                        : PatientRow.DefaultBedsideDto(e.PatientId, e.BedId, p.Name, p.Mrn, p.Age,
                            p.Sex, e.Diagnosis, p.Allergies, e.Attending, e.AdmittedAt);
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

    /* Layer 2: identity/encounter fields (bed, name, MRN, age, sex,
       diagnosis, allergies, attending) are supplied by CORE — only the
       bedside snapshot columns are read from this row. The row's own
       identity/location columns are historical dead weight until Stage 11
       removes the table. */
    public RosterRecordDto ToDto(string bedId, string name, string mrn, int age,
        string sex, string diagnosis, string allergies, string attending) => new(
        PatientId, bedId, name, mrn, age, sex, diagnosis, Los, allergies,
        attending, CodeStatus, Rhythm, Isolation, Severity, Sofa, Ews,
        JsonSerializer.Deserialize<List<string>>(FlagsJson, JsonOpts.Web)!,
        JsonSerializer.Deserialize<JsonElement>(BedsideVitalsJson, JsonOpts.Web),
        JsonSerializer.Deserialize<JsonElement>(BedAlertJson, JsonOpts.Web),
        JsonSerializer.Deserialize<List<double>>(MapTrendJson, JsonOpts.Web)!,
        JsonSerializer.Deserialize<JsonElement>(MonitorVitalsJson, JsonOpts.Web),
        JsonSerializer.Deserialize<JsonElement>(OrgansJson, JsonOpts.Web));

    /* A freshly admitted patient has no bedside row yet — synthesize a
       neutral snapshot at read time (derived, never stored): stable
       severity, zeroed scores/vitals, all organs ok, and an INFO bed note
       (info is excluded from the unit's high-priority alert derivation).
       Stage 11 Observations replace this. */
    public static RosterRecordDto DefaultBedsideDto(string patientId, string bedId,
        string name, string mrn, int age, string sex, string diagnosis,
        string allergies, string attending, string admittedAt)
    {
        static JsonElement J(string json) => JsonSerializer.Deserialize<JsonElement>(json, JsonOpts.Web);
        var alert = JsonSerializer.Serialize(new
        {
            severity = "info",
            message = "Newly admitted — baseline observations pending",
            time = admittedAt,
        }, JsonOpts.Web);
        return new RosterRecordDto(
            patientId, bedId, name, mrn, age, sex, diagnosis, 0, allergies,
            attending, "Full Code", "SR", false, "stable", 0, 0,
            [],
            J("""{"hr":0,"map":0,"spo2":0,"temp":0,"uo":0}"""),
            J(alert),
            [],
            J("""{"hr":0,"sys":0,"dia":0,"map":0,"nibpSys":0,"nibpDia":0,"spo2":0,"rr":0,"temp":0,"etco2":0,"cvp":0}"""),
            J("""{"Brain":"ok","Heart":"ok","Lungs":"ok","Kidneys":"ok","Liver":"ok","Circulation":"ok"}"""));
    }
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

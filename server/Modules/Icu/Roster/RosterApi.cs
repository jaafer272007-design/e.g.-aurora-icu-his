using System.ComponentModel.DataAnnotations;
using System.Text.Json;
using Aurora.Core.Persistence;
using Aurora.Core.Shared;
using Microsoft.EntityFrameworkCore;

namespace Aurora.Modules.Icu.Roster;

/* ---------------- ICU unit roster (Stage 10 Phase 1) ----------------
   DELIBERATELY EXCLUDED from the Core relocation. This record fuses three
   future domains into one: Patient identity (Core), Encounter/location
   (Core — Layer 2 ADT), and the ICU bedside snapshot (rhythm, SOFA, EWS,
   support flags, bedside/monitor vitals, MAP trend, organs — module scope,
   absorbed by the Stage 11 Observation model). Splitting it now would mean
   designing ADT prematurely; it stays here until ADT re-founds
   Patient/Encounter in Core and Stage 11 absorbs the bedside columns.
   Until then, Core logic reading this table (AuroraDb.Patients — order
   create's name/bed resolution, timeline/AI patientId validation, the AI
   ranking's diagnosis join, and the seeder) is the SANCTIONED, temporary
   Core→Module seam recorded in CLAUDE.md. */
static class RosterApi
{
    /* GET /api/icu/patients — the canonical unit roster (Phase 1's single real
       endpoint; Phase 2 puts it behind JWT bearer auth — future endpoints adopt
       the same middleware with just .RequireAuthorization()). Matches the
       contract documented on the frontend mock adapter; note alertCount is NOT
       served: it is a DERIVED value (AI alerts + unacked results + bed alert)
       and those domains' alert derivations are still client-side — the frontend
       adapter derives it, same as before (derived state is never stored). */
    public static void Map(WebApplication app)
    {
        app.MapGet("/api/icu/patients", (AuroraDb db) =>
            Results.Json(db.Patients.AsNoTracking()
                .OrderBy(p => p.PatientId)
                .AsEnumerable()
                .Select(p => p.ToDto()), JsonOpts.Web))
            .RequireAuthorization();
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

    public RosterRecordDto ToDto() => new(
        PatientId, BedId, Name, Mrn, Age, Sex, Diagnosis, Los, Allergies,
        Attending, CodeStatus, Rhythm, Isolation, Severity, Sofa, Ews,
        JsonSerializer.Deserialize<List<string>>(FlagsJson, JsonOpts.Web)!,
        JsonSerializer.Deserialize<JsonElement>(BedsideVitalsJson, JsonOpts.Web),
        JsonSerializer.Deserialize<JsonElement>(BedAlertJson, JsonOpts.Web),
        JsonSerializer.Deserialize<List<double>>(MapTrendJson, JsonOpts.Web)!,
        JsonSerializer.Deserialize<JsonElement>(MonitorVitalsJson, JsonOpts.Web),
        JsonSerializer.Deserialize<JsonElement>(OrgansJson, JsonOpts.Web));
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

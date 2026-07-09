using System.Security.Claims;
using System.Text.Json;
using Aurora.Core.Identity;
using Aurora.Core.Persistence;
using Aurora.Core.Shared;
using Microsoft.EntityFrameworkCore;

namespace Aurora.Core.Adt;

/* ---------------- ADT endpoints (Layer 2, Aurora Core) ----------------
   RBAC: admission + discharge are DOCTOR-level authority (adt.admit /
   adt.discharge); transfer within the unit is a NURSING action
   (adt.transfer — mirroring implement and MAR administration), so a
   DOCTOR token is 403'd on transfer and a NURSE token on admit/discharge.
   The acting actor is ALWAYS the token's name claim, never a request
   field. Validation per the codified rule: malformed payload → 400 with
   an {error} body naming the precise conflict — never a silent 200,
   never a 500. The /api/icu/ prefix is accepted historical cosmetics. */
static class AdtApi
{
    public static void Map(WebApplication app)
    {
        /* GET /api/icu/adt/beds — the bed registry with DERIVED occupancy
           (open encounters joined at read; occupancy is never stored).
           Both roles read: feeds the admission form's free-bed picker, the
           transfer target picker, and the bed board layout. */
        app.MapGet("/api/icu/adt/beds", (HttpContext ctx, AuroraDb db) =>
        {
            foreach (var key in ctx.Request.Query.Keys)
                return ApiError.BadRequest($"unknown query parameter '{key}'");
            var open = db.Encounters.AsNoTracking().Where(e => e.Status == "open").ToList();
            var patients = db.AdtPatients.AsNoTracking().ToDictionary(p => p.PatientId, p => p.Name);
            var beds = db.Beds.AsNoTracking().OrderBy(b => b.Seq).AsEnumerable().Select(b =>
            {
                var enc = open.FirstOrDefault(e => e.BedId == b.BedId);
                return new AdtBedDto(b.BedId, b.Area, enc?.PatientId,
                    enc is null ? null : patients.GetValueOrDefault(enc.PatientId),
                    enc?.EncounterId);
            });
            return Results.Json(beds, JsonOpts.Web);
        }).RequireAuthorization();

        /* GET /api/icu/adt/encounters?patientId&status — encounter list
           (open census, discharge history, per-patient lookup). Both roles. */
        app.MapGet("/api/icu/adt/encounters", (HttpContext ctx, AuroraDb db) =>
        {
            foreach (var key in ctx.Request.Query.Keys)
                if (key is not ("patientId" or "status"))
                    return ApiError.BadRequest($"unknown query parameter '{key}'");
            var patientId = ctx.Request.Query["patientId"].ToString();
            var status = ctx.Request.Query["status"].ToString();
            if (status.Length > 0 && status is not ("open" or "discharged"))
                return ApiError.BadRequest("status must be one of: open, discharged");
            var q = db.Encounters.AsNoTracking().AsQueryable();
            if (patientId.Length > 0) q = q.Where(e => e.PatientId == patientId);
            if (status.Length > 0) q = q.Where(e => e.Status == status);
            var names = db.AdtPatients.AsNoTracking().ToDictionary(p => p.PatientId, p => p.Name);
            return Results.Json(q.OrderBy(e => e.EncounterId).AsEnumerable()
                .Select(e => e.ToDto(names.GetValueOrDefault(e.PatientId, ""))), JsonOpts.Web);
        }).RequireAuthorization();

        /* POST /api/icu/adt/admissions — DOCTOR RBAC (adt.admit). Creates
           the Patient if the MRN is new, opens an Encounter, assigns the
           bed. Every draft field is validated BEFORE anything is written. */
        app.MapPost("/api/icu/adt/admissions", (AdmitRequest req, ClaimsPrincipal user, AuroraDb db) =>
        {
            if (Rbac.Deny(user, "adt.admit") is IResult denied) return denied;

            foreach (var (name, value) in new[] {
                ("mrn", req.Mrn), ("name", req.Name), ("sex", req.Sex), ("allergies", req.Allergies),
                ("diagnosis", req.Diagnosis), ("attending", req.Attending), ("bedId", req.BedId) })
            {
                if (string.IsNullOrWhiteSpace(value)) return ApiError.BadRequest($"{name} is required");
                if (value.Length > AdtLogic.MaxTextLength)
                    return ApiError.BadRequest($"{name} exceeds {AdtLogic.MaxTextLength} characters");
            }
            if (req.Age is null || req.Age is < 0 or > 130)
                return ApiError.BadRequest("age is required and must be between 0 and 130");
            if (req.Sex is not ("M" or "F"))
                return ApiError.BadRequest("sex must be one of: M, F");
            if (!db.Beds.AsNoTracking().Any(b => b.BedId == req.BedId))
                return ApiError.BadRequest($"bedId '{req.BedId}' does not match any bed");
            var occupant = db.Encounters.AsNoTracking()
                .FirstOrDefault(e => e.Status == "open" && e.BedId == req.BedId);
            if (occupant is not null)
                return ApiError.BadRequest($"bed '{req.BedId}' is already occupied by {occupant.PatientId}");

            var mrn = req.Mrn!.Trim();
            var patient = db.AdtPatients.FirstOrDefault(p => p.Mrn == mrn);
            if (patient is not null)
            {
                var openEnc = db.Encounters.AsNoTracking()
                    .FirstOrDefault(e => e.PatientId == patient.PatientId && e.Status == "open");
                if (openEnc is not null)
                    return ApiError.BadRequest(
                        $"patient '{patient.PatientId}' ({mrn}) already has an open encounter '{openEnc.EncounterId}'");
            }
            else
            {
                patient = new Patient
                {
                    PatientId = AdtLogic.NextPatientId(),
                    Mrn = mrn, Name = req.Name!.Trim(), Age = req.Age.Value,
                    Sex = req.Sex!, Allergies = req.Allergies!.Trim(),
                };
                db.AdtPatients.Add(patient);
            }

            var actor = user.FindFirst("name")?.Value ?? "Unknown";
            var time = DateTime.UtcNow.ToString("HH:mm");
            var enc = new Encounter
            {
                EncounterId = AdtLogic.NextEncounterId(),
                PatientId = patient.PatientId, BedId = req.BedId!,
                Diagnosis = req.Diagnosis!.Trim(), Attending = req.Attending!.Trim(),
                Status = "open", AdmittedAt = time, AdmittedBy = actor,
                EventsJson = JsonSerializer.Serialize(
                    new List<AdtEventDto> { new(time, actor, "admitted", $"to {req.BedId}") }, JsonOpts.Web),
            };
            db.Encounters.Add(enc);
            db.SaveChanges();
            return Results.Json(new { patient = patient.ToDto(), encounter = enc.ToDto(patient.Name) }, JsonOpts.Web);
        }).RequireAuthorization();

        /* POST /api/icu/adt/encounters/{encounterId}/discharge — DOCTOR RBAC
           (adt.discharge). Closes the encounter; the bed frees itself
           because occupancy is derived from OPEN encounters. */
        app.MapPost("/api/icu/adt/encounters/{encounterId}/discharge",
            (string encounterId, ClaimsPrincipal user, AuroraDb db) =>
        {
            if (Rbac.Deny(user, "adt.discharge") is IResult denied) return denied;
            var enc = db.Encounters.FirstOrDefault(e => e.EncounterId == encounterId);
            if (enc is null) return Results.Json(new { error = "Not found" }, JsonOpts.Web, statusCode: 404);
            if (enc.Status == "discharged")
                return ApiError.BadRequest($"encounter '{encounterId}' is already discharged");
            var actor = user.FindFirst("name")?.Value ?? "Unknown";
            var time = DateTime.UtcNow.ToString("HH:mm");
            enc.Status = "discharged";
            enc.DischargedAt = time;
            enc.DischargedBy = actor;
            enc.EventsJson = AdtLogic.AppendEvent(enc.EventsJson, new(time, actor, "discharged", $"from {enc.BedId}"));
            db.SaveChanges();
            var name = db.AdtPatients.AsNoTracking().First(p => p.PatientId == enc.PatientId).Name;
            return Results.Json(enc.ToDto(name), JsonOpts.Web);
        }).RequireAuthorization();

        /* POST /api/icu/adt/encounters/{encounterId}/transfer — NURSE RBAC
           (adt.transfer): moving a patient within the unit is a nursing
           action, so a DOCTOR token is 403'd here (mirroring implement and
           MAR administration). Body: { bedId }. */
        app.MapPost("/api/icu/adt/encounters/{encounterId}/transfer",
            (string encounterId, TransferRequest req, ClaimsPrincipal user, AuroraDb db) =>
        {
            if (Rbac.Deny(user, "adt.transfer") is IResult denied) return denied;
            if (string.IsNullOrWhiteSpace(req.BedId))
                return ApiError.BadRequest("bedId is required");
            var enc = db.Encounters.FirstOrDefault(e => e.EncounterId == encounterId);
            if (enc is null) return Results.Json(new { error = "Not found" }, JsonOpts.Web, statusCode: 404);
            if (enc.Status == "discharged")
                return ApiError.BadRequest($"cannot transfer encounter '{encounterId}' — it is discharged");
            if (!db.Beds.AsNoTracking().Any(b => b.BedId == req.BedId))
                return ApiError.BadRequest($"bedId '{req.BedId}' does not match any bed");
            if (enc.BedId == req.BedId)
                return ApiError.BadRequest($"encounter '{encounterId}' is already in bed '{req.BedId}'");
            var occupant = db.Encounters.AsNoTracking()
                .FirstOrDefault(e => e.Status == "open" && e.BedId == req.BedId);
            if (occupant is not null)
                return ApiError.BadRequest($"bed '{req.BedId}' is already occupied by {occupant.PatientId}");
            var actor = user.FindFirst("name")?.Value ?? "Unknown";
            var time = DateTime.UtcNow.ToString("HH:mm");
            var from = enc.BedId;
            enc.BedId = req.BedId!;
            enc.EventsJson = AdtLogic.AppendEvent(enc.EventsJson, new(time, actor, "transferred", $"{from} → {req.BedId}"));
            db.SaveChanges();
            var name = db.AdtPatients.AsNoTracking().First(p => p.PatientId == enc.PatientId).Name;
            return Results.Json(enc.ToDto(name), JsonOpts.Web);
        }).RequireAuthorization();
    }
}

static class AdtLogic
{
    /* same free-text bound as every other mutating endpoint */
    public const int MaxTextLength = 2000;

    static int _patientSeq;
    static int _encounterSeq;

    public static string NextPatientId() => $"P-{Interlocked.Increment(ref _patientSeq)}";
    public static string NextEncounterId() => $"ENC-{Interlocked.Increment(ref _encounterSeq)}";

    /** PERSISTENCE DISCIPLINE (designed for the durable DB from day one):
        id counters resume from the highest persisted id — never a fixed
        constant (the lesson OrderLogic.InitializeCounters codified). New
        ids CONTINUE the seed sequence (seeds P-1001…/ENC-1001…; first
        generated ids are P-1015/ENC-1015). Called once at startup. */
    public static void InitializeCounters(AuroraDb db)
    {
        static int SuffixOf(string id) =>
            int.TryParse(id[(id.IndexOf('-') + 1)..], out var n) ? n : 0;
        _patientSeq = db.AdtPatients.AsNoTracking().Select(p => p.PatientId).AsEnumerable()
            .Select(SuffixOf).DefaultIfEmpty(1000).Max();
        _encounterSeq = db.Encounters.AsNoTracking().Select(e => e.EncounterId).AsEnumerable()
            .Select(SuffixOf).DefaultIfEmpty(1000).Max();
    }

    public static string AppendEvent(string eventsJson, AdtEventDto evt)
    {
        var events = JsonSerializer.Deserialize<List<AdtEventDto>>(eventsJson, JsonOpts.Web)!;
        events.Add(evt);
        return JsonSerializer.Serialize(events, JsonOpts.Web);
    }
}

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

        /* GET /api/icu/adt/patients/{patientId} — the Core PATIENT-IDENTITY
           READ (closes the recorded discharged-patient identity gap):
           person-level identity from the persisted AdtPatients row,
           resolvable WHETHER OR NOT the patient has an open encounter.
           The roster stays what it is — the open-encounter census; this is
           "who is this patient" by id. Identity is served through the SAME
           resolver the roster and the admissions response use
           (Patient.ToDto — one source of truth, never a parallel
           assembly). Gated on patients.view — the permission that already
           means "may read who patients are"; every profile carries it.
           FOUR-CODE: absent id → 404; a DISCHARGED patient is 200 (the
           patient exists — they are just not admitted). RBAC answers
           before the lookup (the generic 403 is no existence oracle). */
        app.MapGet("/api/icu/adt/patients/{patientId}",
            (string patientId, HttpContext ctx, ClaimsPrincipal user, AuroraDb db) =>
        {
            if (Rbac.Deny(user, "patients.view") is IResult denied) return denied;
            foreach (var key in ctx.Request.Query.Keys)
                return ApiError.BadRequest($"unknown query parameter '{key}'");
            var patient = db.AdtPatients.AsNoTracking().FirstOrDefault(p => p.PatientId == patientId);
            return patient is null ? ApiError.NotFound() : Results.Json(patient.ToDto(), JsonOpts.Web);
        }).RequireAuthorization();

        /* PUT /api/icu/adt/encounters/{encounterId}/measurements — Patient
           Weight & Height Capture, ENCOUNTER-SCOPED (the project owner's
           decision): ADD when omitted at admission, CORRECT a wrong value
           (the 70-vs-07-kg typo) — always amend-not-erase (who/when/prior
           recorded on THIS encounter's measurement history; values are
           never cleared, only corrected). Each admission keeps its own
           values — this endpoint never touches another encounter's.
           Units fixed: kg/cm.
           RBAC patients.measure — BEDSIDE CLINICIAN authority (Doctor /
           SeniorDoctor / Nurse; the office Administrator and every
           non-bedside profile are 403). RBAC answers BEFORE the lookup
           (the generic 403 is no existence oracle).
           NO closed-encounter 409, deliberately: correcting the episode's
           recorded weight is completing/repairing the record of care —
           not initiating new care — so a DISCHARGED encounter's wrong
           weight stays fixable (the same asymmetry as result
           acknowledgment; the state machine only blocks transitions that
           initiate care).
           FOUR-CODE: absent encounter → 404; both fields absent, an
           out-of-bounds value, or values equal to the record → 400 (a
           no-change PUT is a malformed request against this resource,
           the formulary/catalogue "no field change" precedent). */
        app.MapPut("/api/icu/adt/encounters/{encounterId}/measurements",
            (string encounterId, MeasureRequest req, ClaimsPrincipal user, AuroraDb db) =>
        {
            if (Rbac.Deny(user, "patients.measure") is IResult denied) return denied;
            if (req.WeightKg is null && req.HeightCm is null)
                return ApiError.BadRequest("at least one of weightKg or heightCm is required");
            if (AdtLogic.MeasurementError(req.WeightKg, req.HeightCm) is string mErr)
                return ApiError.BadRequest(mErr);
            var enc = db.Encounters.FirstOrDefault(e => e.EncounterId == encounterId);
            if (enc is null) return ApiError.NotFound();
            var actor = user.FindFirst("name")?.Value ?? "Unknown";
            if (!AdtLogic.ApplyMeasurements(enc, req.WeightKg, req.HeightCm, actor, atAdmission: false))
                return ApiError.BadRequest("no change — the provided values match the encounter's recorded weight/height");
            db.SaveChanges();
            var name = db.AdtPatients.AsNoTracking().First(p => p.PatientId == enc.PatientId).Name;
            return Results.Json(enc.ToDto(name), JsonOpts.Web);
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
            /* IDENTITY REDESIGN: exactly ONE of dateOfBirth / age.
               dateOfBirth ("yyyy-MM-dd") is the correct capture — age then
               COMPUTES at read, never stored. age stays accepted for
               estimated-age admissions (DOB genuinely unknown at the
               bedside) and is served with its provenance. Both → 400
               (ambiguous — the pair can drift); neither → 400. */
            if (req.DateOfBirth is not null && req.Age is not null)
                return ApiError.BadRequest("provide dateOfBirth or age, not both");
            if (req.DateOfBirth is null && req.Age is null)
                return ApiError.BadRequest("one of dateOfBirth or age is required");
            if (req.Age is not null && req.Age is < 0 or > 130)
                return ApiError.BadRequest("age must be between 0 and 130");
            string? dob = null;
            if (req.DateOfBirth is not null)
            {
                if (!DateTime.TryParseExact(req.DateOfBirth, "yyyy-MM-dd",
                        null, System.Globalization.DateTimeStyles.None, out var parsed))
                    return ApiError.BadRequest("dateOfBirth must be a valid date formatted yyyy-MM-dd");
                /* RECORDED LIMITATION: DOB is a CIVIL date but the server
                   has only UTC (no facility-timezone concept yet). East
                   of UTC, between local and UTC midnight, a same-day
                   birth is rejected as "in the future" and a computed age
                   reads one year low for those hours. Fixing this needs a
                   facility timezone — recorded in 02 as future scope. */
                var today = DateTime.UtcNow.Date;
                if (parsed.Date > today)
                    return ApiError.BadRequest("dateOfBirth cannot be in the future");
                if (parsed.Date < today.AddYears(-130))
                    return ApiError.BadRequest("dateOfBirth implies an age above 130");
                dob = parsed.ToString("yyyy-MM-dd");
            }
            if (req.Sex is not ("M" or "F"))
                return ApiError.BadRequest("sex must be one of: M, F");
            /* Weight & Height capture — OPTIONAL admission fields (kg/cm);
               bounds-validated when provided, addable later when omitted */
            if (AdtLogic.MeasurementError(req.WeightKg, req.HeightCm) is string mErr)
                return ApiError.BadRequest(mErr);
            if (!db.Beds.AsNoTracking().Any(b => b.BedId == req.BedId))
                return ApiError.BadRequest($"bedId '{req.BedId}' does not match any bed");
            /* FOUR-CODE RULE (state-conflict PR): an occupied bed and a
               patient already admitted are RESOURCE STATE, not payload
               validation — the same request succeeds once the bed frees /
               the prior encounter closes → 409 (was 400, pre-convention).
               An unknown bedId stays 400: the payload references a bed
               that does not exist. */
            var occupant = db.Encounters.AsNoTracking()
                .FirstOrDefault(e => e.Status == "open" && e.BedId == req.BedId);
            if (occupant is not null)
                return ApiError.StateConflict($"bed '{req.BedId}' is already occupied by {occupant.PatientId}");

            var mrn = req.Mrn!.Trim();
            var patient = db.AdtPatients.FirstOrDefault(p => p.Mrn == mrn);
            if (patient is not null)
            {
                var openEnc = db.Encounters.AsNoTracking()
                    .FirstOrDefault(e => e.PatientId == patient.PatientId && e.Status == "open");
                if (openEnc is not null)
                    return ApiError.StateConflict(
                        $"patient '{patient.PatientId}' ({mrn}) already has an open encounter '{openEnc.EncounterId}'");
                /* RE-ADMISSION IDENTITY RULES (adversarial-review finding
                   — never a silent no-op):
                   - a submitted dateOfBirth COMPLETES a legacy row that
                     has none (the estimate becomes recorded truth; the
                     stored age clears — it derives from DOB from now on);
                   - a submitted dateOfBirth that CONTRADICTS the recorded
                     one is a 409: identity corrections are not an
                     admission side effect — they need their own audited
                     path (recorded future scope);
                   - a submitted AGE (an estimate) never downgrades the
                     recorded identity of a known patient — the stored
                     identity stands and the response returns it, so the
                     caller SEES what is recorded. */
                if (dob is not null)
                {
                    if (patient.DateOfBirth is null)
                    {
                        patient.DateOfBirth = dob;
                        patient.Age = null;
                    }
                    else if (patient.DateOfBirth != dob)
                        return ApiError.StateConflict(
                            $"patient '{patient.PatientId}' ({mrn}) has recorded date of birth {patient.DateOfBirth} — "
                            + $"the submitted {dob} differs; identity corrections are not part of admission");
                }
            }
            else
            {
                patient = new Patient
                {
                    PatientId = AdtLogic.NextPatientId(),
                    Mrn = mrn, Name = req.Name!.Trim(), Age = req.Age, DateOfBirth = dob,
                    Sex = req.Sex!, Allergies = req.Allergies!.Trim(),
                };
                db.AdtPatients.Add(patient);
            }

            var actor = user.FindFirst("name")?.Value ?? "Unknown";
            var time = DateTime.UtcNow.ToString("yyyy-MM-dd HH:mm");
            var enc = new Encounter
            {
                EncounterId = AdtLogic.NextEncounterId(),
                PatientId = patient.PatientId, BedId = req.BedId!,
                Diagnosis = req.Diagnosis!.Trim(), Attending = req.Attending!.Trim(),
                Status = "open", AdmittedAt = time, AdmittedBy = actor,
                EventsJson = JsonSerializer.Serialize(
                    new List<AdtEventDto> { new(time, actor, "admitted", $"to {req.BedId}") }, JsonOpts.Web),
            };
            /* Weight & Height at admission — ENCOUNTER-SCOPED (the project
               owner's decision on the flagged modelling choice): the values
               land on THIS admission's encounter. A re-admission therefore
               STARTS FRESH — it never inherits and never overwrites a prior
               admission's recorded weight/height (a patient re-admitted a
               year later may genuinely differ; each episode keeps its own).
               DateOfBirth above stays person-level identity — age already
               computes at read, correctly per-time. */
            AdtLogic.ApplyMeasurements(enc, req.WeightKg, req.HeightCm, actor, atAdmission: true);
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
            if (enc is null) return ApiError.NotFound();
            if (enc.Status == "discharged")
                return ApiError.StateConflict(
                    $"encounter '{encounterId}' is already discharged"
                    + (string.IsNullOrEmpty(enc.DischargedBy) ? "" : $" (by {enc.DischargedBy} at {enc.DischargedAt})")
                    + " — there is nothing to discharge");
            var actor = user.FindFirst("name")?.Value ?? "Unknown";
            var time = DateTime.UtcNow.ToString("yyyy-MM-dd HH:mm");
            enc.Status = "discharged";
            enc.DischargedAt = time;
            enc.DischargedBy = actor;
            enc.EventsJson = AdtLogic.AppendEvent(enc.EventsJson, new(time, actor, "discharged", $"from {enc.BedId}"));
            /* THE BACKWARD INVARIANT (one rule with the create-time
               chokepoint): an order's lifecycle is bounded by its
               encounter. Closing the encounter discontinues its
               active/pending orders in the SAME transaction via the
               explicitly-named LIFECYCLE path — audited with the
               discharging clinician as actor, never deleted; remaining
               scheduled administrations cancelled by the shared
               discontinue mechanics. (Adt calling into Orders is a
               deliberate Core-internal coupling; a future domain-event
               seam would decouple it.) */
            Aurora.Core.Orders.OrderLogic.DischargeCascade(db, enc.EncounterId, actor);
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
            if (enc is null) return ApiError.NotFound();
            if (enc.Status == "discharged")
                return ApiError.StateConflict(
                    $"encounter '{encounterId}' is discharged — a closed encounter cannot be transferred");
            if (!db.Beds.AsNoTracking().Any(b => b.BedId == req.BedId))
                return ApiError.BadRequest($"bedId '{req.BedId}' does not match any bed");
            if (enc.BedId == req.BedId)
                return ApiError.StateConflict($"encounter '{encounterId}' is already in bed '{req.BedId}'");
            var occupant = db.Encounters.AsNoTracking()
                .FirstOrDefault(e => e.Status == "open" && e.BedId == req.BedId);
            if (occupant is not null)
                return ApiError.StateConflict($"bed '{req.BedId}' is already occupied by {occupant.PatientId}");
            var actor = user.FindFirst("name")?.Value ?? "Unknown";
            var time = DateTime.UtcNow.ToString("yyyy-MM-dd HH:mm");
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

    /* ---- Weight & Height capture (kg/cm — fixed units) ---- */

    /** shared bounds for BOTH capture paths (admission + the later
        add/correct): weight 0.5–500 kg, height 30–260 cm — wide enough
        for any ICU patient, tight enough to reject unit mistakes (a
        weight in grams, a height in metres). null = not provided (valid:
        both fields are optional at admission; the PUT endpoint separately
        requires at least one). */
    public static string? MeasurementError(double? weightKg, double? heightCm)
    {
        if (weightKg is double w && (!double.IsFinite(w) || w is < 0.5 or > 500))
            return "weightKg must be a number between 0.5 and 500 (kg)";
        if (heightCm is double h && (!double.IsFinite(h) || h is < 30 or > 260))
            return "heightCm must be a number between 30 and 260 (cm)";
        return null;
    }

    /** applies provided values to the ENCOUNTER row, appending one
        amend-not-erase history event per CHANGED field (who / when /
        prior value — the design's traceability rule). An omitted field
        is untouched; an equal value appends nothing. Returns whether
        anything changed. Event times carry the date (UTC
        "yyyy-MM-dd HH:mm") — a correction can land days after admission,
        so the audit stamp is dated like the Layer-3 user audit, unlike
        the same-shift ADT bedside events. */
    public static bool ApplyMeasurements(Encounter enc, double? weightKg, double? heightCm,
        string actor, bool atAdmission)
    {
        var events = JsonSerializer.Deserialize<List<MeasurementEventDto>>(enc.MeasurementsJson, JsonOpts.Web)!;
        var time = DateTime.UtcNow.ToString("yyyy-MM-dd HH:mm");
        var changed = false;
        if (weightKg is double w && enc.WeightKg != w)
        {
            events.Add(new(time, actor, "weight",
                atAdmission ? "recorded at admission" : enc.WeightKg is null ? "added" : "corrected",
                enc.WeightKg, w));
            enc.WeightKg = w;
            changed = true;
        }
        if (heightCm is double h && enc.HeightCm != h)
        {
            events.Add(new(time, actor, "height",
                atAdmission ? "recorded at admission" : enc.HeightCm is null ? "added" : "corrected",
                enc.HeightCm, h));
            enc.HeightCm = h;
            changed = true;
        }
        if (changed) enc.MeasurementsJson = JsonSerializer.Serialize(events, JsonOpts.Web);
        return changed;
    }
}

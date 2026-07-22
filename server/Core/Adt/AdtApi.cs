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
        app.MapGet("/api/icu/adt/beds", (HttpContext ctx, System.Security.Claims.ClaimsPrincipal user, AuroraDb db) =>
        {
            if (Identity.Rbac.Deny(user, "patients.view") is IResult denied) return denied;
            foreach (var key in ctx.Request.Query.Keys)
                return ApiError.BadRequest($"unknown query parameter '{key}'");
            var open = db.Encounters.AsNoTracking().Where(e => e.Status == "open").ToList();
            var patients = db.AdtPatients.AsNoTracking().ToDictionary(p => p.PatientId, p => p.DisplayName);
            var beds = db.Beds.AsNoTracking().OrderBy(b => b.Seq).AsEnumerable().Select(b =>
            {
                var enc = open.FirstOrDefault(e => e.BedId == b.BedId);
                return new AdtBedDto(b.BedId, b.Area, b.Seq, b.Active, enc?.PatientId,
                    enc is null ? null : patients.GetValueOrDefault(enc.PatientId),
                    enc?.EncounterId, b.History());
            });
            return Results.Json(beds, JsonOpts.Web);
        }).RequireAuthorization();

        /* GET /api/icu/adt/attendings — the admission form's Attending
           picker: the ACTIVE accounts holding a SeniorDoctor-profile role
           (the consultants who attend), ordered by name. Gated on
           adt.admit — you read the list only to record an admission, and
           both Doctor and SeniorDoctor tokens hold that atom. This is the
           SAFETY FIX for the free-text attending: a typo used to write a
           ghost attending onto the encounter; the picker binds it to a
           real senior doctor. (The user directory /api/icu/users is
           System-Administrator-only by design and NEVER clinical, so it
           cannot feed a clinician's admission form — hence a dedicated
           clinician-readable read here, mirroring assignments/staff.) */
        app.MapGet("/api/icu/adt/attendings", (HttpContext ctx, System.Security.Claims.ClaimsPrincipal user, AuroraDb db) =>
        {
            if (Rbac.Deny(user, "adt.admit") is IResult denied) return denied;
            foreach (var key in ctx.Request.Query.Keys)
                return ApiError.BadRequest($"unknown query parameter '{key}'");
            var attendings = db.Users.AsNoTracking().Where(u => u.Active)
                .AsEnumerable()
                .Where(u => UserLogic.RolesOf(u).Any(t => Rbac.ProfileOf(t) == "SeniorDoctor"))
                .OrderBy(u => u.Name, StringComparer.OrdinalIgnoreCase)
                .Select(u => new AttendingDto(u.Username, u.Name, u.JobTitle));
            return Results.Json(attendings, JsonOpts.Web);
        }).RequireAuthorization();

        /* GET /api/icu/adt/encounters?patientId&status — encounter list
           (open census, discharge history, per-patient lookup). Both roles. */
        app.MapGet("/api/icu/adt/encounters", (HttpContext ctx, System.Security.Claims.ClaimsPrincipal user, AuroraDb db) =>
        {
            if (Identity.Rbac.Deny(user, "patients.view") is IResult denied) return denied;
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
            var names = db.AdtPatients.AsNoTracking().ToDictionary(p => p.PatientId, p => p.DisplayName);
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

        /* POST /api/icu/adt/patients/match — the on-submit identity match
           (match+overview design §1-2; see MatchPatientRequest for the
           three-tier rules). READ-ONLY despite the verb — POST carries
           the national ID in the body, never a URL. Gated on
           patients.view: the card is identity-only (the same class of
           data as the census), so the office Administrator — who
           registers patients — can run the check; clinical data never
           appears in this response. NEVER AUTO-MERGES, NEVER CREATES:
           the caller decides, a human confirms a Tier B suggestion.
           FOUR-CODE: nothing matchable / malformed dateOfBirth /
           unknown field → 400; there is no 404 (an empty match is a
           RESULT, not an error) and no 409 (nothing mutates). */
        app.MapPost("/api/icu/adt/patients/match",
            (MatchPatientRequest req, ClaimsPrincipal user, AuroraDb db) =>
        {
            if (Rbac.Deny(user, "patients.view") is IResult denied) return denied;
            foreach (var (field, value) in new[] {
                ("mrn", req.Mrn), ("nationalId", req.NationalId), ("fileNumber", req.FileNumber),
                ("nameFirst", req.NameFirst),
                ("nameSecond", req.NameSecond), ("nameFamily", req.NameFamily) })
                if (value is not null && value.Length > AdtLogic.MaxTextLength)
                    return ApiError.BadRequest($"{field} exceeds {AdtLogic.MaxTextLength} characters");
            string? Clean(string? v) => string.IsNullOrWhiteSpace(v) ? null : v.Trim();
            var (mrn, nid, fileNo, nf, ns, nl) =
                (Clean(req.Mrn), Clean(req.NationalId), Clean(req.FileNumber),
                 Clean(req.NameFirst), Clean(req.NameSecond), Clean(req.NameFamily));
            string? dob = null;
            if (Clean(req.DateOfBirth) is string rawDob)
            {
                if (!DateTime.TryParseExact(rawDob, "yyyy-MM-dd",
                        null, System.Globalization.DateTimeStyles.None, out _))
                    return ApiError.BadRequest("dateOfBirth must be a valid date formatted yyyy-MM-dd");
                dob = rawDob;
            }
            var nameDobComplete = nf is not null && ns is not null && nl is not null && dob is not null;
            if (mrn is null && nid is null && fileNo is null && !nameDobComplete)
                return ApiError.BadRequest(
                    "nothing to match on — provide mrn, nationalId, fileNumber, or the complete required name (nameFirst, nameSecond, nameFamily) with dateOfBirth");

            /* Tier A — unique identifiers, checked in the order the
               registration form supplies them (nationalId first; the
               file number is unique-when-present, so it confirms
               exactly like the other two) */
            var rows = db.AdtPatients.AsNoTracking().AsEnumerable().ToList();
            Patient? confirmed = null;
            if (nid is not null) confirmed = rows.FirstOrDefault(p => p.NationalId == nid);
            if (confirmed is null && fileNo is not null) confirmed = rows.FirstOrDefault(p => p.PatientFileNumber == fileNo);
            if (confirmed is null && mrn is not null) confirmed = rows.FirstOrDefault(p => p.Mrn == mrn);

            List<Patient> matches;
            string? tier;
            if (confirmed is not null) { matches = new() { confirmed }; tier = "confirmed"; }
            else if (nameDobComplete)
            {
                /* Tier B — exact three-part name (case-insensitive) +
                   exact STORED DateOfBirth. Rows without a real DOB
                   (estimated-age unknowns) and legacy single-name rows
                   never enter. ALL hits return — two identical name+DOB
                   patients are the design's own motivating case, and the
                   human sees both. */
                matches = rows.Where(p =>
                    p.DateOfBirth is not null && p.DateOfBirth == dob
                    && p.HasStructuredName
                    && string.Equals(p.NameFirst, nf, StringComparison.OrdinalIgnoreCase)
                    && string.Equals(p.NameSecond, ns, StringComparison.OrdinalIgnoreCase)
                    && string.Equals(p.NameFamily, nl, StringComparison.OrdinalIgnoreCase)).ToList();
                tier = matches.Count > 0 ? "probable" : null;
            }
            else { matches = new(); tier = null; }

            return Results.Json(new
            {
                tier,
                matches = matches.Select(p => AdtLogic.ToMatchCard(p, db)).ToList(),
            }, JsonOpts.Web);
        }).RequireAuthorization();

        /* GET /api/icu/adt/patients/search?q=&scope=all|discharged&limit=
           — PARTIAL patient lookup for RETRIEVAL (the discharged-record
           go-live gap: a hospital must be able to find ANY past patient).
           Unlike /patients/match (EXACT id or COMPLETE name+DOB, bound to
           admission de-duplication), this is case-insensitive SUBSTRING
           matching across the display name, the structured name parts,
           MRN, file number, national ID, and patientId — over ALL
           patients INCLUDING the discharged (a Patient row persists
           whatever its encounter state). Identity-class data only (the
           national ID rides MASKED to last-4 through the same ToMatchCard
           the match endpoint uses), so patients.view; the clinical record
           it leads to (/patients/:id/history) is separately results.view-
           gated. scope=discharged lists patients who have a closed
           encounter and NO open one (q optional = BROWSE all discharged —
           the fix for the Recently-Discharged 12-cap); scope=all requires
           q (never dumps the whole table). FOUR-CODE: unknown param /
           bad scope / missing-or-short q on scope=all → 400; an empty
           result is a 200 RESULT, never a 404. Results are capped and
           `truncated` names the overflow (03: no silent truncation). */
        app.MapGet("/api/icu/adt/patients/search",
            (HttpContext ctx, ClaimsPrincipal user, AuroraDb db) =>
        {
            if (Rbac.Deny(user, "patients.view") is IResult denied) return denied;
            foreach (var key in ctx.Request.Query.Keys)
                if (key is not ("q" or "scope" or "limit"))
                    return ApiError.BadRequest($"unknown query parameter '{key}'");
            var q = ctx.Request.Query["q"].ToString().Trim();
            var scope = ctx.Request.Query["scope"].ToString().Trim().ToLowerInvariant();
            if (scope.Length == 0) scope = "all";
            if (scope is not ("all" or "discharged"))
                return ApiError.BadRequest("scope must be one of: all, discharged");
            var limit = int.TryParse(ctx.Request.Query["limit"], out var n)
                ? Math.Clamp(n, 1, 100) : 50;
            if (scope == "all" && q.Length < 2)
                return ApiError.BadRequest("provide a search term of at least 2 characters (q)");

            var patients = db.AdtPatients.AsNoTracking().AsEnumerable().ToList();
            var encByPatient = db.Encounters.AsNoTracking().AsEnumerable()
                .GroupBy(e => e.PatientId).ToDictionary(g => g.Key, g => g.ToList());
            /* "discharged" = has ≥1 encounter and NONE open (currently-
               admitted excluded; a registered-but-never-admitted row is
               not a discharged patient, so it is excluded too) */
            bool NotAdmitted(Patient p) =>
                encByPatient.TryGetValue(p.PatientId, out var es)
                && es.Count > 0 && es.All(e => e.Status != "open");

            var ql = q.ToLowerInvariant();
            bool Matches(Patient p)
            {
                if (ql.Length == 0) return true;
                var dto = p.ToDto();
                bool Has(string? s) => s is not null && s.ToLowerInvariant().Contains(ql);
                return Has(dto.Name) || Has(dto.FullName)
                    || Has(p.NameFirst) || Has(p.NameSecond) || Has(p.NameThird)
                    || Has(p.NameFourth) || Has(p.NameFamily)
                    || Has(p.Mrn) || Has(p.PatientFileNumber) || Has(p.NationalId)
                    || Has(p.PatientId);
            }

            string LastDisch(Patient p) => encByPatient.TryGetValue(p.PatientId, out var es)
                ? es.Where(e => e.Status != "open").Select(e => e.DischargedAt ?? "")
                     .DefaultIfEmpty("").Max()! : "";
            string SortName(Patient p) { var d = p.ToDto(); return d.FullName ?? d.Name; }

            var pool = scope == "discharged" ? patients.Where(NotAdmitted) : patients;
            var hits = pool.Where(Matches).ToList();
            var total = hits.Count;
            var ordered = scope == "discharged"
                ? hits.OrderByDescending(LastDisch).ThenBy(SortName)
                : hits.OrderBy(SortName);
            var page = ordered.Take(limit).Select(p => AdtLogic.ToMatchCard(p, db)).ToList();

            return Results.Json(new
            {
                results = page,
                total,
                truncated = total > page.Count,
            }, JsonOpts.Web);
        }).RequireAuthorization();

        /* PUT /api/icu/adt/patients/{patientId}/identity — IDENTITY
           CORRECTION (the validator's design §3 — REQUIRED by the
           unknown-patient decision: the family arrives and the patient
           gets a name; typos must be fixable too). A SERIOUS, AUDITED
           identity event: actor + ACTIVE role (#104) + dated time +
           required reason, appended to the patient's append-only identity
           history. AMEND, NEVER ERASE — the previous identity is
           preserved and visible (the #80 lab / #107 imaging discipline).
           AUTHORITY (flagged choice, stated): identity.correct sits on the
           office ADMINISTRATOR profile — registration is theirs, and
           identity is NOT clinical data, so it fits their locked scope;
           clinical profiles are 403.
           Correcting the NAME requires the complete structured set
           (first/second/family — a legacy single-name patient is
           corrected INTO structured parts here; the stored legacy name is
           preserved in the history and on the row). nationalId and
           dateOfBirth correct independently — the DOB path deliberately
           SUPERSEDES the "identity corrections are not part of admission"
           409 for the corrected-through-this-path case: an unknown
           patient's DOB is a guess and MUST be correctable once known, or
           a wrong age propagates into every score and dose (attributed
           supersede note in 02).
           THE MRN CORRECTS HERE TOO (the #116 flag resolved by the
           owner) — safe only NOW because #116 retired the MRN as the
           re-admission linking key (re-admission keys on patientId), so
           the MRN is purely a display identifier and correcting one no
           longer changes who a future re-admission attaches to. A typed
           `mrn` must be canonical MRN-###### (flagged decision: free-form
           entry is the exact hole #116 closed, and every legitimate MRN
           is already canonical — the only non-canonical one in existence
           is the wrong value this path exists to fix); `regenerateMrn`
           has Aurora assign a fresh unique number via AdtLogic.NextMrn
           (the #116 generator — no fork). NEVER silent: previous→new in
           the audited history like every other identity field.
           FOUR-CODE: absent patient → 404; missing reason / partial name
           set / malformed DOB / non-canonical or blank mrn / mrn AND
           regenerateMrn together → 400; a nationalId OR an MRN already
           recorded for ANOTHER patient → 409 naming the conflict; a
           correction that changes nothing → 400 (the no-field-change
           precedent). */
        app.MapPut("/api/icu/adt/patients/{patientId}/identity",
            (string patientId, CorrectIdentityRequest req, ClaimsPrincipal user, AuroraDb db) =>
        {
            if (Rbac.Deny(user, "identity.correct") is IResult denied) return denied;
            if (string.IsNullOrWhiteSpace(req.Reason))
                return ApiError.BadRequest("reason is required — an identity correction is an audited event");
            foreach (var (field, value) in new[] {
                ("reason", req.Reason), ("nameFirst", req.NameFirst), ("nameSecond", req.NameSecond),
                ("nameThird", req.NameThird), ("nameFourth", req.NameFourth),
                ("nameFamily", req.NameFamily), ("nationalId", req.NationalId), ("mrn", req.Mrn),
                ("fileNumber", req.FileNumber) })
                if (value is not null && value.Length > AdtLogic.MaxTextLength)
                    return ApiError.BadRequest($"{field} exceeds {AdtLogic.MaxTextLength} characters");

            var anyName = req.NameFirst is not null || req.NameSecond is not null
                || req.NameThird is not null || req.NameFourth is not null || req.NameFamily is not null;
            if (anyName && (string.IsNullOrWhiteSpace(req.NameFirst)
                || string.IsNullOrWhiteSpace(req.NameSecond) || string.IsNullOrWhiteSpace(req.NameFamily)))
                return ApiError.BadRequest(
                    "correcting the name requires the complete structured set — nameFirst, nameSecond and nameFamily (nameThird/nameFourth optional)");
            string? dob = null;
            if (req.DateOfBirth is not null)
            {
                if (!DateTime.TryParseExact(req.DateOfBirth, "yyyy-MM-dd",
                        null, System.Globalization.DateTimeStyles.None, out var parsed))
                    return ApiError.BadRequest("dateOfBirth must be a valid date formatted yyyy-MM-dd");
                var today = DateTime.UtcNow.Date;
                if (parsed.Date > today) return ApiError.BadRequest("dateOfBirth cannot be in the future");
                if (parsed.Date < today.AddYears(-130)) return ApiError.BadRequest("dateOfBirth implies an age above 130");
                dob = parsed.ToString("yyyy-MM-dd");
            }
            var nationalId = req.NationalId is null ? null
                : string.IsNullOrWhiteSpace(req.NationalId)
                    ? "" /* explicit blank → 400 below: an ID is corrected to a value as on the card, never cleared here */
                    : req.NationalId.Trim();
            if (nationalId == "")
                return ApiError.BadRequest("nationalId must be the number as it appears on the identity card — clearing a recorded national ID is not an identity correction");
            /* the file number corrects on the same amend-never-erase rule */
            var fileNumber = req.FileNumber is null ? null
                : string.IsNullOrWhiteSpace(req.FileNumber) ? "" : req.FileNumber.Trim();
            if (fileNumber == "")
                return ApiError.BadRequest("fileNumber must be the number as the hospital records it — clearing a recorded file number is not an identity correction");

            /* MRN correction (the #116 flag resolved): typed value XOR
               regenerate; a typed value must be canonical MRN-###### —
               free-form entry is the exact hole #116 closed */
            var regenerateMrn = req.RegenerateMrn == true;
            string? mrn = null;
            if (req.Mrn is not null)
            {
                if (regenerateMrn)
                    return ApiError.BadRequest("provide either mrn or regenerateMrn, not both — a correction states the number, regeneration asks Aurora to assign one");
                mrn = req.Mrn.Trim();
                if (mrn == "")
                    return ApiError.BadRequest("clearing an MRN is not an identity correction — provide the corrected number, or regenerateMrn to have Aurora assign one");
                if (!System.Text.RegularExpressions.Regex.IsMatch(mrn, @"^MRN-\d{6}$"))
                    return ApiError.BadRequest("a corrected MRN must use the canonical MRN-###### format — free-form record numbers are the class of error this path removes; use regenerateMrn to have Aurora assign one");
            }
            if (!anyName && nationalId is null && fileNumber is null && dob is null && mrn is null && !regenerateMrn)
                return ApiError.BadRequest("nothing to correct — provide the structured name, nationalId, fileNumber, dateOfBirth, mrn, and/or regenerateMrn");

            var row = db.AdtPatients.FirstOrDefault(p => p.PatientId == patientId);
            if (row is null) return ApiError.NotFound();
            if (nationalId is not null)
            {
                var holder = db.AdtPatients.AsNoTracking().AsEnumerable()
                    .FirstOrDefault(p => p.NationalId == nationalId && p.PatientId != patientId);
                if (holder is not null)
                    return ApiError.StateConflict(
                        $"national identity number '{nationalId}' is already recorded for patient "
                        + $"'{holder.PatientId}' ({holder.DisplayName}, {holder.Mrn}) — national identity numbers are unique");
            }
            if (mrn is not null)
            {
                var mrnHolder = db.AdtPatients.AsNoTracking().AsEnumerable()
                    .FirstOrDefault(p => p.Mrn == mrn && p.PatientId != patientId);
                if (mrnHolder is not null)
                    return ApiError.StateConflict(
                        $"MRN '{mrn}' is already assigned to patient '{mrnHolder.PatientId}' "
                        + $"({mrnHolder.DisplayName}) — MRNs are unique");
            }
            if (fileNumber is not null)
            {
                var fnHolder = db.AdtPatients.AsNoTracking().AsEnumerable()
                    .FirstOrDefault(p => p.PatientFileNumber == fileNumber && p.PatientId != patientId);
                if (fnHolder is not null)
                    return ApiError.StateConflict(
                        $"file number '{fileNumber}' is already recorded for patient '{fnHolder.PatientId}' "
                        + $"({fnHolder.DisplayName}, {fnHolder.Mrn}) — file numbers are unique");
            }

            /* build the previous→new diff — the previous identity is the
               event's payload, preserved forever (amend never erase) */
            var parts = new List<string>();
            var was = row.FullLegalName;
            if (anyName)
            {
                string? Clean(string? v) => string.IsNullOrWhiteSpace(v) ? null : v.Trim();
                var (nf, ns, nt, n4, nl) = (Clean(req.NameFirst)!, Clean(req.NameSecond)!,
                    Clean(req.NameThird), Clean(req.NameFourth), Clean(req.NameFamily)!);
                if (nf != row.NameFirst || ns != row.NameSecond || nt != row.NameThird
                    || n4 != row.NameFourth || nl != row.NameFamily)
                {
                    (row.NameFirst, row.NameSecond, row.NameThird, row.NameFourth, row.NameFamily) =
                        (nf, ns, nt, n4, nl);
                    parts.Add($"name: {was} → {row.FullLegalName}");
                }
            }
            if (nationalId is not null && nationalId != row.NationalId)
            {
                parts.Add($"nationalId: {row.NationalId ?? "—"} → {nationalId}");
                row.NationalId = nationalId;
            }
            if (fileNumber is not null && fileNumber != row.PatientFileNumber)
            {
                parts.Add($"fileNumber: {row.PatientFileNumber ?? "—"} → {fileNumber}");
                row.PatientFileNumber = fileNumber;
            }
            if (dob is not null && dob != row.DateOfBirth)
            {
                parts.Add($"dateOfBirth: {row.DateOfBirth ?? (row.Age is int a ? $"— (estimated age {a})" : "—")} → {dob}");
                row.DateOfBirth = dob;
                row.Age = null;   /* age derives from DOB from now on */
            }
            /* NextMrn checks EVERY existing MRN including this row's, so a
               regenerated value can never equal the current one — the
               diff below always records regeneration */
            if (regenerateMrn) mrn = AdtLogic.NextMrn(db);
            if (mrn is not null && mrn != row.Mrn)
            {
                parts.Add($"mrn: {row.Mrn} → {mrn}");
                row.Mrn = mrn;
            }
            if (parts.Count == 0)
                return ApiError.BadRequest("no change — the provided identity matches the record");

            var history = JsonSerializer.Deserialize<List<IdentityEventDto>>(row.IdentityJson, JsonOpts.Web)!;
            history.Add(new(
                DateTime.UtcNow.ToString("yyyy-MM-dd HH:mm"),
                user.FindFirst("name")?.Value ?? "Unknown",
                user.FindFirst("jobTitle")?.Value ?? "Unknown",
                req.Reason!.Trim(),
                string.Join(" · ", parts)));
            row.IdentityJson = JsonSerializer.Serialize(history, JsonOpts.Web);
            db.SaveChanges();
            return Results.Json(row.ToDto(), JsonOpts.Web);
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
            var name = db.AdtPatients.AsNoTracking().First(p => p.PatientId == enc.PatientId).DisplayName;
            return Results.Json(enc.ToDto(name), JsonOpts.Web);
        }).RequireAuthorization();

        /* POST /api/icu/adt/encounters/{encounterId}/code-status — set /
           change THIS encounter's code status (the governed-vocabulary
           SAFETY FIX). SELECTED from the ACTIVE vocabulary, never typed.
           RBAC codestatus.set — PHYSICIAN authority (Doctor/SeniorDoctor;
           the goals-of-care decision is a physician act — nurses render
           and act on the value, never set it; the office Administrator
           profile never holds it). RBAC answers BEFORE the lookup.
           CLOSED-ENCOUNTER 409, deliberately (unlike weight/height):
           recording a resuscitation instruction on a closed episode is
           INITIATING a new instruction, not repairing the record of care
           given — there is nothing for it to govern. A correction within
           the open episode is the next set (append-only history, prior
           preserved — never silently changed, never erased).
           FOUR-CODE: absent encounter → 404 · closed encounter / retired
           code / same-code replay → 409 · unknown code → 400 (payload
           reference, the bedId precedent). */
        app.MapPost("/api/icu/adt/encounters/{encounterId}/code-status",
            (string encounterId, SetCodeStatusRequest req, ClaimsPrincipal user, AuroraDb db) =>
        {
            if (Rbac.Deny(user, "codestatus.set") is IResult denied) return denied;
            var code = (req.Code ?? "").Trim();
            if (code.Length == 0) return ApiError.BadRequest("code is required");
            var enc = db.Encounters.FirstOrDefault(e => e.EncounterId == encounterId);
            if (enc is null) return ApiError.NotFound();
            if (enc.Status != "open")
                return ApiError.StateConflict(
                    $"encounter '{encounterId}' is discharged — a code status is set on an open admission"
                    + " (a closed episode's record is not re-instructed)");
            var cs = db.CodeStatuses.AsNoTracking().FirstOrDefault(c => c.Code == code);
            if (cs is null)
                return ApiError.BadRequest($"code '{code}' does not match any code-status vocabulary entry");
            if (!cs.Active)
                return ApiError.StateConflict(
                    $"code status '{code}' ({cs.Label}) is retired — it cannot be newly assigned; reactivate it or select an active entry");
            if (enc.CodeStatusCode == code)
                return ApiError.StateConflict(
                    $"encounter '{encounterId}' already carries code status '{code}' — there is nothing to change");
            var actor = user.FindFirst("name")?.Value ?? "Unknown";
            var role = Rbac.ProfileOf(user.FindFirst("jobTitle")?.Value ?? "") ?? "Unknown";
            var time = DateTime.UtcNow.ToString("yyyy-MM-dd HH:mm");
            var events = JsonSerializer.Deserialize<List<CodeStatusEventDto>>(enc.CodeStatusEventsJson, JsonOpts.Web)!;
            events.Add(new(time, actor, role, code, cs.Label, enc.CodeStatusCode));
            enc.CodeStatusEventsJson = JsonSerializer.Serialize(events, JsonOpts.Web);
            enc.CodeStatusCode = code;
            db.SaveChanges();
            var name = db.AdtPatients.AsNoTracking().First(p => p.PatientId == enc.PatientId).DisplayName;
            return Results.Json(enc.ToDto(name), JsonOpts.Web);
        }).RequireAuthorization();

        /* POST /api/icu/adt/encounters/{encounterId}/isolation — ISOLATION
           PRECAUTIONS (Configuration Vocabularies design §2, the boolean's
           upgrade). BEDSIDE CLINICIAN authority (observations.record —
           any doctor or nurse; recording the patient's precaution state
           is bedside documentation, exactly the codestatus.set /
           codestatus.manage split: MANAGING the type vocabulary is the
           separate isolation.manage governance). Body: the REPLACEMENT
           set of vocabulary codes — multiple is clinically real (contact
           AND droplet); [] clears. Every submitted code must be ACTIVE:
           unknown → 400 (payload reference), retired → 409 (state).
           Audited into the encounter's event history with the PRIOR set
           named (labels, not codes — the print/history convention) and
           the actor's ACTIVE role. FOUR-CODE: absent encounter → 404 ·
           closed encounter / retired type / same-set replay → 409 ·
           unknown type / malformed list → 400. */
        app.MapPost("/api/icu/adt/encounters/{encounterId}/isolation",
            (string encounterId, SetIsolationRequest req, ClaimsPrincipal user, AuroraDb db) =>
        {
            if (Rbac.Deny(user, "observations.record") is IResult denied) return denied;
            if (req.Types is null)
                return ApiError.BadRequest("types is required (send [] to clear precautions)");
            var types = req.Types.Select(t => (t ?? "").Trim()).ToList();
            if (types.Any(t => t.Length == 0))
                return ApiError.BadRequest("types must not contain empty entries");
            if (types.Count > 8)
                return ApiError.BadRequest("types exceeds 8 entries");
            if (types.Distinct().Count() != types.Count)
                return ApiError.BadRequest("types must not contain duplicates");
            var enc = db.Encounters.FirstOrDefault(e => e.EncounterId == encounterId);
            if (enc is null) return ApiError.NotFound();
            if (enc.Status != "open")
                return ApiError.StateConflict(
                    $"encounter '{encounterId}' is discharged — isolation precautions are set on an open admission");
            var vocab = db.IsolationTypes.AsNoTracking().ToDictionary(t => t.Code);
            foreach (var t in types)
            {
                if (!vocab.TryGetValue(t, out var row))
                    return ApiError.BadRequest($"type '{t}' does not match any isolation-type vocabulary entry");
                if (!row.Active)
                    return ApiError.StateConflict(
                        $"isolation type '{t}' ({row.Label}) is retired — it cannot be newly assigned; reactivate it or select an active entry");
            }
            /* stable storage order = vocabulary Seq (display never depends
               on submission order) */
            var ordered = types.OrderBy(t => vocab[t].Seq).ToList();
            var prior = enc.IsolationTypes();
            if (prior.SequenceEqual(ordered))
                return ApiError.StateConflict(
                    $"encounter '{encounterId}' already carries exactly these isolation precautions — there is nothing to change");
            var actor = user.FindFirst("name")?.Value ?? "Unknown";
            var role = Rbac.ProfileOf(user.FindFirst("jobTitle")?.Value ?? "") ?? "Unknown";
            var time = DateTime.UtcNow.ToString("yyyy-MM-dd HH:mm");
            string Names(List<string> codes) => codes.Count == 0 ? "none"
                : string.Join(" + ", codes.Select(c => vocab.TryGetValue(c, out var r) ? r.Label : c));
            enc.IsolationJson = JsonSerializer.Serialize(ordered, JsonOpts.Web);
            enc.EventsJson = AdtLogic.AppendEvent(enc.EventsJson, new(time, actor, "isolation precautions",
                $"{Names(ordered)} (was: {Names(prior)}) · as {role}"));
            db.SaveChanges();
            var name = db.AdtPatients.AsNoTracking().First(p => p.PatientId == enc.PatientId).DisplayName;
            return Results.Json(enc.ToDto(name), JsonOpts.Web);
        }).RequireAuthorization();

        /* POST /api/icu/adt/admissions — DOCTOR RBAC (adt.admit). Opens an
           Encounter, assigns the bed; creates the Patient with an
           AURORA-GENERATED MRN, or RE-ADMITS an existing patient by
           patientId. Every draft field is validated BEFORE anything is
           written.
           STRUCTURED IDENTITY (the validator's design): the legal name
           arrives as five parts (first/second/family required on a NEW
           patient — unidentified patients use the same fields, named
           "unknown" by the admitting user, no special mode) plus the
           OPTIONAL national identity number, stored as on the card,
           unique when present.
           AUTO-GENERATED MRN (the #113 flag resolved by the owner): the
           MRN is the hospital's own record number — Aurora assigns it at
           patient creation (AdtLogic.NextMrn: the seeded MRN-######
           format, uniqueness-checked). The typed field is RETIRED
           (Disallow → automatic 400): a user-typed MRN is exactly how
           P-1191's national identity number landed in his MRN slot.
           RE-ADMISSION keys on the OPTIONAL patientId instead of the
           typed MRN: the stored identity (and MRN) stands, identity
           fields become optional on that path, and the recorded #113
           rules keep applying — provided names never overwrite; a
           provided dateOfBirth/nationalId completes an absent value or
           409s on contradiction (identity corrections are never an
           admission side effect). */
        app.MapPost("/api/icu/adt/admissions", (AdmitRequest req, ClaimsPrincipal user, AuroraDb db) =>
        {
            if (Rbac.Deny(user, "adt.admit") is IResult denied) return denied;

            var readmission = !string.IsNullOrWhiteSpace(req.PatientId);
            /* required on EVERY admission — the episode's own fields */
            foreach (var (name, value) in new[] {
                ("diagnosis", req.Diagnosis), ("attending", req.Attending), ("bedId", req.BedId) })
                if (string.IsNullOrWhiteSpace(value)) return ApiError.BadRequest($"{name} is required");
            /* required on a NEW patient only — a re-admission's stored
               identity stands (provided values validate below) */
            if (!readmission)
                foreach (var (name, value) in new[] {
                    ("nameFirst", req.NameFirst), ("nameSecond", req.NameSecond),
                    ("nameFamily", req.NameFamily), ("sex", req.Sex), ("allergies", req.Allergies) })
                    if (string.IsNullOrWhiteSpace(value)) return ApiError.BadRequest($"{name} is required");
            /* every provided text field is bounded regardless of path */
            foreach (var (name, value) in new[] {
                ("patientId", req.PatientId), ("nameFirst", req.NameFirst), ("nameSecond", req.NameSecond),
                ("nameThird", req.NameThird), ("nameFourth", req.NameFourth),
                ("nameFamily", req.NameFamily), ("nationalId", req.NationalId),
                ("fileNumber", req.FileNumber),
                ("allergies", req.Allergies), ("diagnosis", req.Diagnosis),
                ("attending", req.Attending), ("bedId", req.BedId) })
                if (value is not null && value.Length > AdtLogic.MaxTextLength)
                    return ApiError.BadRequest($"{name} exceeds {AdtLogic.MaxTextLength} characters");
            var nationalId = string.IsNullOrWhiteSpace(req.NationalId) ? null : req.NationalId.Trim();
            var fileNumber = string.IsNullOrWhiteSpace(req.FileNumber) ? null : req.FileNumber.Trim();
            /* IDENTITY REDESIGN: exactly ONE of dateOfBirth / age on a NEW
               patient. dateOfBirth ("yyyy-MM-dd") is the correct capture —
               age then COMPUTES at read, never stored. age stays accepted
               for estimated-age admissions (DOB genuinely unknown at the
               bedside) and is served with its provenance. Both → 400
               (ambiguous — the pair can drift); neither → 400 on a new
               patient (a re-admission's stored identity stands). */
            if (req.DateOfBirth is not null && req.Age is not null)
                return ApiError.BadRequest("provide dateOfBirth or age, not both");
            if (!readmission && req.DateOfBirth is null && req.Age is null)
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
            if (req.Sex is not null && req.Sex is not ("M" or "F"))
                return ApiError.BadRequest("sex must be one of: M, F");
            /* Weight & Height capture — OPTIONAL admission fields (kg/cm);
               bounds-validated when provided, addable later when omitted */
            if (AdtLogic.MeasurementError(req.WeightKg, req.HeightCm) is string mErr)
                return ApiError.BadRequest(mErr);
            /* Code status — OPTIONAL at admission, SELECTED from the
               vocabulary, never typed: an unknown code is a payload
               reference resolving to nothing → 400 (the bedId precedent);
               a RETIRED code is resource state → 409 (reactivate it and
               the same request succeeds). Omitted = honestly NOT
               RECORDED — never a default. */
            (string Code, string Label)? admitCodeStatus = null;
            if (!string.IsNullOrWhiteSpace(req.CodeStatusCode))
            {
                var csCode = req.CodeStatusCode.Trim();
                var cs = db.CodeStatuses.AsNoTracking().FirstOrDefault(c => c.Code == csCode);
                if (cs is null)
                    return ApiError.BadRequest($"codeStatusCode '{csCode}' does not match any code-status vocabulary entry");
                if (!cs.Active)
                    return ApiError.StateConflict(
                        $"code status '{csCode}' ({cs.Label}) is retired — it cannot be newly assigned; reactivate it or select an active entry");
                admitCodeStatus = (cs.Code, cs.Label);
            }
            /* resolve the patient: RE-ADMISSION by patientId — an unknown
               id is a payload reference that resolves to nothing → 400
               (the bedId precedent); otherwise a NEW patient whose MRN
               Aurora generates below. */
            Patient? patient = null;
            if (readmission)
            {
                var pid = req.PatientId!.Trim();
                patient = db.AdtPatients.FirstOrDefault(p => p.PatientId == pid);
                if (patient is null)
                    return ApiError.BadRequest($"patientId '{pid}' does not match any patient");
            }
            var bedRow = db.Beds.AsNoTracking().FirstOrDefault(b => b.BedId == req.BedId);
            if (bedRow is null)
                return ApiError.BadRequest($"bedId '{req.BedId}' does not match any bed");
            /* FOUR-CODE RULE (state-conflict PR): an occupied bed and a
               patient already admitted are RESOURCE STATE, not payload
               validation — the same request succeeds once the bed frees /
               the prior encounter closes → 409 (was 400, pre-convention).
               An unknown bedId stays 400: the payload references a bed
               that does not exist. A RETIRED bed is state too (the same
               request succeeds once it is reactivated) → 409. */
            if (!bedRow.Active)
                return ApiError.StateConflict(
                    $"bed '{req.BedId}' is retired — reactivate it in Configuration before admitting into it");
            var occupant = db.Encounters.AsNoTracking()
                .FirstOrDefault(e => e.Status == "open" && e.BedId == req.BedId);
            if (occupant is not null)
                return ApiError.StateConflict($"bed '{req.BedId}' is already occupied by {occupant.PatientId}");

            /* NATIONAL ID — UNIQUE WHEN PRESENT (locked decision 3): a
               duplicate at admission is refused NAMING the conflict; the
               unidentified (no ID) never collide — absent is not a value. */
            if (nationalId is not null)
            {
                var holder = db.AdtPatients.AsNoTracking().AsEnumerable()
                    .FirstOrDefault(p => p.NationalId == nationalId && p.PatientId != patient?.PatientId);
                if (holder is not null)
                    return ApiError.StateConflict(
                        $"national identity number '{nationalId}' is already recorded for patient "
                        + $"'{holder.PatientId}' ({holder.DisplayName}, {holder.Mrn}) — national identity numbers are unique; "
                        + "if this is the same person returning, re-admit them as the existing patient (patientId)");
            }
            /* PATIENT FILE NUMBER — the same unique-when-present rule
               (Locale/File-Number §2.3): one hospital, no two patients
               share a chart number; a duplicate is refused NAMING the
               conflict (it catches a mistyped number at entry). */
            if (fileNumber is not null)
            {
                var fnHolder = db.AdtPatients.AsNoTracking().AsEnumerable()
                    .FirstOrDefault(p => p.PatientFileNumber == fileNumber && p.PatientId != patient?.PatientId);
                if (fnHolder is not null)
                    return ApiError.StateConflict(
                        $"file number '{fileNumber}' is already recorded for patient "
                        + $"'{fnHolder.PatientId}' ({fnHolder.DisplayName}, {fnHolder.Mrn}) — file numbers are unique; "
                        + "if this is the same person returning, re-admit them as the existing patient (patientId)");
            }
            if (patient is not null)
            {
                var openEnc = db.Encounters.AsNoTracking()
                    .FirstOrDefault(e => e.PatientId == patient.PatientId && e.Status == "open");
                if (openEnc is not null)
                    return ApiError.StateConflict(
                        $"patient '{patient.PatientId}' ({patient.Mrn}) already has an open encounter '{openEnc.EncounterId}'");
                /* DECEASED GUARD (match+overview design §3.4 — the
                   SERVER half; the dialog hides its Readmit button, but
                   a UI-only guard is not a guard): a patient whose
                   latest encounter closed with a DEATH disposition is
                   never re-admitted. A wrong death record is corrected
                   through the audited record, not through admission.
                   Since the Configuration Vocabularies build the check
                   resolves the STORED code through the vocabulary's
                   IMMUTABLE IsDeath attribute (never the label): rows
                   are never deleted so resolution is total, the edit
                   contract cannot touch IsDeath, and a hospital-added
                   death disposition arms this guard exactly like the
                   reserved 'died' — no vocabulary edit can break it. */
                var latestEnc = db.Encounters.AsNoTracking()
                    .Where(e => e.PatientId == patient.PatientId).AsEnumerable()
                    .OrderByDescending(e => AdtLogic.EncounterSeq(e.EncounterId)).FirstOrDefault();
                if (latestEnc is not null && AdtLogic.IsDeathDisposition(db, latestEnc.Disposition))
                    return ApiError.StateConflict(
                        $"patient '{patient.PatientId}' ({patient.Mrn}) is recorded as deceased "
                        + $"(disposition '{latestEnc.Disposition}' on encounter '{latestEnc.EncounterId}') — a deceased patient cannot be re-admitted; "
                        + "a wrong death record is corrected through the audited record, never through admission");
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
                            $"patient '{patient.PatientId}' ({patient.Mrn}) has recorded date of birth {patient.DateOfBirth} — "
                            + $"the submitted {dob} differs; identity corrections are not part of admission");
                }
                /* the same rule for the national ID: a submitted ID
                   COMPLETES a row that has none; one that CONTRADICTS the
                   recorded ID is a 409 — identity corrections have their
                   own audited path, never an admission side effect. The
                   stored NAME of a known patient likewise stands: the
                   admission's name fields never overwrite it. */
                if (nationalId is not null)
                {
                    if (patient.NationalId is null)
                        patient.NationalId = nationalId;
                    else if (patient.NationalId != nationalId)
                        return ApiError.StateConflict(
                            $"patient '{patient.PatientId}' ({patient.Mrn}) has recorded national identity number {patient.NationalId} — "
                            + $"the submitted {nationalId} differs; identity corrections are not part of admission");
                }
                /* and for the file number — completes an absent value,
                   409s on contradiction (never an admission side effect) */
                if (fileNumber is not null)
                {
                    if (patient.PatientFileNumber is null)
                        patient.PatientFileNumber = fileNumber;
                    else if (patient.PatientFileNumber != fileNumber)
                        return ApiError.StateConflict(
                            $"patient '{patient.PatientId}' ({patient.Mrn}) has recorded file number {patient.PatientFileNumber} — "
                            + $"the submitted {fileNumber} differs; identity corrections are not part of admission");
                }
            }
            else
            {
                patient = new Patient
                {
                    PatientId = AdtLogic.NextPatientId(),
                    /* the hospital's own record number — AURORA-GENERATED
                       in the seeded MRN-###### format, uniqueness-checked;
                       never typed (the P-1191 hole, closed) */
                    Mrn = AdtLogic.NextMrn(db),
                    /* structured from birth — the legacy Name column stays
                       empty on new rows; the display name derives at read */
                    NameFirst = req.NameFirst!.Trim(), NameSecond = req.NameSecond!.Trim(),
                    NameThird = string.IsNullOrWhiteSpace(req.NameThird) ? null : req.NameThird.Trim(),
                    NameFourth = string.IsNullOrWhiteSpace(req.NameFourth) ? null : req.NameFourth.Trim(),
                    NameFamily = req.NameFamily!.Trim(),
                    NationalId = nationalId,
                    /* the hospital's own chart number — typed as recorded,
                       optional (absent is honest), unique-checked above */
                    PatientFileNumber = fileNumber,
                    Age = req.Age, DateOfBirth = dob,
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
            /* Code status at admission — ENCOUNTER-SCOPED on the same rule
               as weight/height: this admission's goals-of-care decision,
               never inherited by a future episode. Audited with actor +
               ACTIVE role (prior null — the first set). */
            if (admitCodeStatus is not null)
            {
                enc.CodeStatusCode = admitCodeStatus.Value.Code;
                enc.CodeStatusEventsJson = JsonSerializer.Serialize(
                    new List<CodeStatusEventDto> { new(time, actor,
                        Rbac.ProfileOf(user.FindFirst("jobTitle")?.Value ?? "") ?? "Unknown",
                        admitCodeStatus.Value.Code, admitCodeStatus.Value.Label, null) }, JsonOpts.Web);
            }
            db.Encounters.Add(enc);
            db.SaveChanges();
            return Results.Json(new { patient = patient.ToDto(), encounter = enc.ToDto(patient.DisplayName) }, JsonOpts.Web);
        }).RequireAuthorization();

        /* POST /api/icu/adt/encounters/{encounterId}/discharge — DOCTOR RBAC
           (adt.discharge). Closes the encounter; the bed frees itself
           because occupancy is derived from OPEN encounters. */
        app.MapPost("/api/icu/adt/encounters/{encounterId}/discharge",
            (string encounterId, DischargeRequest? req, ClaimsPrincipal user, AuroraDb db) =>
        {
            if (Rbac.Deny(user, "adt.discharge") is IResult denied) return denied;
            /* DISCHARGE DISPOSITION — validated WHEN PROVIDED against the
               MANAGED vocabulary (Configuration Vocabularies design §1):
               unknown code → 400 naming the active vocabulary (payload
               reference, the bedId precedent); RETIRED code → 409
               (resource state — reactivate it and the same request
               succeeds; the code-status precedent). The body itself
               stays optional (see DischargeRequest); the stored value is
               a SNAPSHOT — retiring a disposition later never rewrites
               this encounter's recorded outcome. */
            var disposition = req?.Disposition?.Trim();
            if (disposition is not null)
            {
                var dispo = db.Dispositions.AsNoTracking().FirstOrDefault(d => d.Code == disposition);
                if (dispo is null)
                    return ApiError.BadRequest(
                        $"disposition must be one of: {string.Join(", ", AdtLogic.ActiveDispositionCodes(db))}");
                if (!dispo.Active)
                    return ApiError.StateConflict(
                        $"disposition '{disposition}' ({dispo.Label}) is retired — it cannot be newly recorded; reactivate it or select an active entry");
            }
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
            enc.Disposition = disposition;
            enc.EventsJson = AdtLogic.AppendEvent(enc.EventsJson, new(time, actor, "discharged",
                $"from {enc.BedId}" + (disposition is null ? "" : $" · disposition {disposition}")));
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
            /* NO assignment cascade since the opt-out coverage model
               (Assignment Simplification): coverage is DERIVED over OPEN
               encounters, so closing the episode removes it from every
               worklist by construction; removal rows on the closed
               encounter simply become history (restored-never-deleted). */
            db.SaveChanges();
            var name = db.AdtPatients.AsNoTracking().First(p => p.PatientId == enc.PatientId).DisplayName;
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
            var targetBed = db.Beds.AsNoTracking().FirstOrDefault(b => b.BedId == req.BedId);
            if (targetBed is null)
                return ApiError.BadRequest($"bedId '{req.BedId}' does not match any bed");
            if (!targetBed.Active)
                return ApiError.StateConflict(
                    $"bed '{req.BedId}' is retired — reactivate it in Configuration before transferring into it");
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
            var name = db.AdtPatients.AsNoTracking().First(p => p.PatientId == enc.PatientId).DisplayName;
            return Results.Json(enc.ToDto(name), JsonOpts.Web);
        }).RequireAuthorization();
    }
}

static class AdtLogic
{
    /* same free-text bound as every other mutating endpoint */
    public const int MaxTextLength = 2000;

    /* DISCHARGE DISPOSITION vocabulary — the outcome of the ICU stay,
       MANAGED DATA since the Configuration Vocabularies build (the
       hardcoded array this replaces is seeded verbatim: home / ward /
       transfer_out / higher_care / died / other — labels included).
       Discharge stores the CODE as a snapshot; 'died' is reserved-
       unretireable and death semantics resolve through the immutable
       IsDeath attribute below, never the label. */
    public static List<string> ActiveDispositionCodes(AuroraDb db) =>
        db.Dispositions.AsNoTracking().Where(d => d.Active)
            .OrderBy(d => d.Seq).Select(d => d.Code).ToList();

    /** does this STORED disposition code count as death? Resolution is
        total (vocabulary rows are never deleted) and stable (IsDeath is
        immutable after creation) — the deceased guard, the patient-
        history status, and mortality statistics all key on this, so no
        vocabulary edit can rewrite a recorded outcome. Null (no
        recorded disposition) is never death. */
    public static bool IsDeathDisposition(AuroraDb db, string? code) =>
        code is not null
        && db.Dispositions.AsNoTracking().FirstOrDefault(d => d.Code == code)?.IsDeath == true;

    static int _patientSeq;
    static int _encounterSeq;

    public static string NextPatientId() => $"P-{Interlocked.Increment(ref _patientSeq)}";
    public static string NextEncounterId() => $"ENC-{Interlocked.Increment(ref _encounterSeq)}";

    /** AURORA-GENERATED MRN (auto-generated-MRN decision): the hospital's
        own record number in the SEEDED format — "MRN-" + six digits
        (MRN-482913 …). Random within the format (a sequential counter
        would leak admission order through a number that prints on
        documents), uniqueness-checked against every existing MRN —
        including legacy typed ones of any shape, which are NEVER
        rewritten. The 900k space against tens of patients makes retries
        vanishingly rare; the loop bound turns a pathological collision
        streak into a loud 500 rather than an infinite loop. */
    /* numeric sequence of an "ENC-{n}" id — ordinal string ordering
       would misplace ids across digit-count boundaries */
    public static long EncounterSeq(string encounterId) =>
        encounterId.StartsWith("ENC-") && long.TryParse(encounterId[4..], out var n) ? n : 0;

    /* the match dialog's identity summary card, derived at read: status
       and location come from the ENCOUNTERS (open → admitted + bed;
       else latest disposition resolving IsDeath → deceased; else
       discharged), age through the canonical Patient.ToDto resolver
       (no fork), and the national ID leaves here MASKED TO ITS LAST 4 —
       the full number is never in this DTO at all. */
    public static MatchCardDto ToMatchCard(Patient p, AuroraDb db)
    {
        var encs = db.Encounters.AsNoTracking()
            .Where(e => e.PatientId == p.PatientId).AsEnumerable().ToList();
        var open = encs.FirstOrDefault(e => e.Status == "open");
        var latest = encs.OrderByDescending(e => EncounterSeq(e.EncounterId)).FirstOrDefault();
        var status = open is not null ? "admitted"
            : latest is not null && IsDeathDisposition(db, latest.Disposition) ? "deceased" : "discharged";
        var dto = p.ToDto();
        /* masking must SURVIVE short values (adversarial-review finding):
           for a stored ID of 4 characters or fewer, "the last 4" IS the
           whole number — emit "" (recorded but unmaskable; the dialog
           says so) rather than ever letting the full value ride. Only a
           null (nothing recorded) stays null. */
        var last4 = p.NationalId is null ? null
            : p.NationalId is { Length: > 4 } full ? full[^4..] : "";
        var lastDischargedAt = encs
            .Where(e => e.Status != "open" && !string.IsNullOrEmpty(e.DischargedAt))
            .OrderByDescending(e => e.DischargedAt).Select(e => e.DischargedAt).FirstOrDefault() ?? "";
        return new MatchCardDto(
            p.PatientId, dto.FullName ?? dto.Name, p.Mrn, last4,
            dto.Age, dto.AgeSource, p.Sex,
            latest?.AdmittedAt ?? "", encs.Count, status,
            open?.BedId, open?.EncounterId,
            p.PatientFileNumber, lastDischargedAt);
    }

    public static string NextMrn(AuroraDb db)
    {
        for (var i = 0; i < 1000; i++)
        {
            var candidate = $"MRN-{Random.Shared.Next(100000, 1000000)}";
            if (!db.AdtPatients.AsNoTracking().Any(p => p.Mrn == candidate))
                return candidate;
        }
        throw new InvalidOperationException("could not generate a unique MRN after 1000 attempts");
    }

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

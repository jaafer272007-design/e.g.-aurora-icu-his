using System.Security.Claims;
using System.Text.Json;
using Aurora.Core.Adt;
using Aurora.Core.Identity;
using Aurora.Core.Orders;
using Aurora.Core.Persistence;
using Aurora.Core.Shared;
using Microsoft.EntityFrameworkCore;

namespace Aurora.Core.LabImaging;

/* ---------------- Laboratory & Imaging results (Stage 10 Phase 3) ----------------
   The canonical results service — same wire contract the mock adapter
   documents. All endpoints require a valid JWT; the acknowledge actions
   ADDITIONALLY require the results.acknowledge permission, derived
   server-side from the token's jobTitle claim via the same three-layer
   RBAC lookup the frontend uses (User → JobTitle → Profile → Permissions,
   computed at read time, never stored). A nurse token is rejected with a
   403 here regardless of what the UI shows — the first real server-side
   RBAC enforcement. The acknowledging actor is taken from the TOKEN's
   name claim, never from the request body (server-verified identity).

   RESULTS AUDIT PR — creation + un-acknowledgment. THE ENCOUNTER RULE IS
   ASYMMETRIC HERE, deliberately:
   - CREATING a result is initiating care → requires the patient's OPEN
     encounter (EncounterGuard, 409 on a closed episode) and is scoped to
     it (encounterId server-derived, never client-supplied).
   - ACKNOWLEDGING and UN-ACKNOWLEDGING are completing the record of care
     already given → they MUST succeed on a closed encounter. A blood
     culture drawn on day 3 that results on day 7, after discharge, must
     be acknowledgeable. EncounterGuard is NEVER called on these paths.
   Creation authority is the PRODUCING SERVICE's: results.create belongs
   to the Ancillary profile (lab/radiology technicians) — a doctor or
   nurse token gets 403 on create, mirroring how implement/administer flip
   polarity. Un-acknowledge mirrors acknowledge (results.acknowledge,
   doctor-only) and is NEVER a deletion: the original acknowledgment
   survives in the append-only event history; the reversal is its own
   audited event with a REQUIRED reason (the never-destroy principle from
   the Stage 11 override rule and Layer 3 deactivation). */
static class ResultsApi
{
    public static void Map(WebApplication app)
    {
        /* GET /api/icu/results/labs?patientId — all lab draws for a patient, oldest first. */
        app.MapGet("/api/icu/results/labs", (string patientId, AuroraDb db) =>
            Results.Json(db.LabDraws.AsNoTracking()
                .Where(d => d.PatientId == patientId)
                .OrderBy(d => d.LabId)
                .AsEnumerable()
                .Select(d => d.ToDto()), JsonOpts.Web))
            .RequireAuthorization();

        /* GET /api/icu/results/imaging?patientId — imaging studies incl. reports. */
        app.MapGet("/api/icu/results/imaging", (string patientId, AuroraDb db) =>
            Results.Json(db.ImagingStudies.AsNoTracking()
                .Where(s => s.PatientId == patientId)
                .OrderBy(s => s.StudyId)
                .AsEnumerable()
                .Select(s => s.ToDto()), JsonOpts.Web))
            .RequireAuthorization();

        /* GET /api/icu/results/inbox — unit-wide unacknowledged results, DERIVED at
           read time from the stored draws/studies (derived state is never stored). */
        app.MapGet("/api/icu/results/inbox", (AuroraDb db) =>
        {
            var labs = db.LabDraws.AsNoTracking().Where(d => !d.Acknowledged).AsEnumerable().Select(d =>
            {
                /* Custom / Other results are UNSTRUCTURED — the numeric items
                   array is empty, so the LabItemDto parse below (and items[0])
                   would throw. Build the headline from the free-text
                   testName/value/unit instead, and carry NO flag (Flag is ""). */
                /* §2a UI hint: the documentation anchor rides along (null when
                   absent) so the inbox can show that an in-window result is
                   not yet acknowledgeable — the server enforces regardless */
                var docAt = d.DocumentedAt == "" ? null : d.DocumentedAt;
                if (d.Custom)
                {
                    var unit = string.IsNullOrEmpty(d.CustomUnit) ? "" : $" {d.CustomUnit}";
                    return new InboxItemDto("lab", d.LabId, d.PatientId, d.BedId, d.PatientName,
                        $"{d.Label} {d.CustomValue}{unit} — {d.BedId} {d.PatientName}".Replace("  ", " "),
                        d.Note ?? "custom test documented", d.ResultedAt, d.Flag, docAt);
                }
                var items = JsonSerializer.Deserialize<List<LabItemDto>>(d.ItemsJson, JsonOpts.Web)!;
                var h = items.FirstOrDefault(i => i.Flag == "critical")
                    ?? items.FirstOrDefault(i => i.Flag == "abnormal") ?? items[0];
                var v = h.Value == Math.Floor(h.Value) ? ((long)h.Value).ToString() : h.Value.ToString("0.0");
                return new InboxItemDto("lab", d.LabId, d.PatientId, d.BedId, d.PatientName,
                    $"{h.Analyte} {v} {h.Unit} — {d.BedId} {d.PatientName}".Replace("  ", " "),
                    d.Note ?? $"{d.Panel} panel resulted", d.ResultedAt, d.Flag, docAt);
            });
            var imaging = db.ImagingStudies.AsNoTracking().Where(s => !s.Acknowledged).AsEnumerable().Select(s =>
                new InboxItemDto("imaging", s.StudyId, s.PatientId, s.BedId, s.PatientName,
                    $"{s.Description} {(s.Status == "preliminary" ? "prelim" : s.Status)} — {s.BedId} {s.PatientName}",
                    s.Note ?? s.Impression ?? "", s.ReportedAt ?? s.OrderedAt, s.Flag));
            return Results.Json(labs.Concat(imaging)
                .OrderByDescending(x => x.Time, StringComparer.Ordinal), JsonOpts.Web);
        }).RequireAuthorization();

        /* POST /api/icu/results/labs — CREATE a lab result (results audit PR).
           Ancillary RBAC (results.create — the producing service enters
           results; doctor/nurse tokens are 403'd). The result is scoped to
           the patient's OPEN encounter (409 if closed — initiating care)
           and arrives UNACKNOWLEDGED, entering the inbox. encounterId,
           bed/name snapshots, draw-level flag, timestamps, and the actor
           are all server-derived — none is accepted from the client. */
        app.MapPost("/api/icu/results/labs", (CreateLabRequest req, ClaimsPrincipal user, AuroraDb db) =>
        {
            if (Rbac.Deny(user, "results.create") is IResult denied) return denied;
            if (ResultsLogic.ValidateLabCreate(req, db) is string problem)
                return ApiError.BadRequest(problem);
            if (EncounterGuard.RequireOpenForPatient(db, req.PatientId!, "creating a lab result", out var enc) is IResult conflict)
                return conflict;
            var pt = db.AdtPatients.AsNoTracking().First(p => p.PatientId == req.PatientId);
            var actor = user.FindFirst("name")?.Value ?? "Unknown";
            var now = DateTime.UtcNow;
            var time = now.ToString("HH:mm");
            var items = req.Items!.Select(i => new LabItemFull(
                i.Analyte!, i.Value!.Value, i.Unit ?? "", i.RefRange!, i.RefLow!.Value, i.RefHigh!.Value, i.Flag!)).ToList();
            /* ORDER→RESULT LINKAGE (Layer 4 phase 2) — SERVER-derived,
               never client-supplied (a payload carrying orderId fails
               binding, exactly as encounterId does): the result fulfils
               the OLDEST unfulfilled active Lab order for the SAME test
               on this open encounter, when one exists. No match → the
               result stands alone: walk-in, reflex and protocol-added
               results are legitimate, and mandatory linkage would block
               exactly the entries a real lab performs unsolicited. */
            var fulfilled = db.LabDraws.AsNoTracking()
                .Where(x => x.OrderId != null).Select(x => x.OrderId).ToHashSet();
            var linkedOrder = db.Orders.AsNoTracking()
                .Where(o => o.PatientId == req.PatientId && o.EncounterId == enc!.EncounterId
                    && o.Category == "Lab" && o.TestId == req.Panel && o.Status == "active")
                .OrderBy(o => o.Seq).AsEnumerable()
                .FirstOrDefault(o => !fulfilled.Contains(o.OrderId));
            var row = new LabDrawRow
            {
                LabId = ResultsLogic.NextLabId(), PatientId = req.PatientId!,
                EncounterId = enc!.EncounterId, OrderId = linkedOrder?.OrderId,
                BedId = enc.BedId, PatientName = pt.Name,
                Panel = req.Panel!.Trim(), Label = req.Label!.Trim(),
                CollectedAt = time, ResultedAt = time,
                ItemsJson = JsonSerializer.Serialize(items, JsonOpts.Web),
                Flag = ResultsLogic.DeriveLabFlag(req.Items!), Note = req.Note?.Trim(),
                Acknowledged = false,
                EventsJson = JsonSerializer.Serialize(
                    new List<ResultEventDto> { new(now.ToString("yyyy-MM-dd HH:mm"), actor, "resulted", null) }, JsonOpts.Web),
            };
            db.LabDraws.Add(row);
            db.SaveChanges();
            return Results.Json(row.ToDto(), JsonOpts.Web);
        }).RequireAuthorization();

        /* POST /api/icu/results/labs/document — DOCUMENT (transcribe) a lab
           result (Lab Result-Entry design). The MANUAL human-entry path the
           ICU bedside team uses: transcribing a paper central-lab report, or
           entering a bedside ABG from the analyzer. RBAC is results.document
           (Doctor/SeniorDoctor/Nurse) — a DISTINCT atom from the
           producing-service results.create above, so the two authorities stay
           reconciled rather than repurposed (the design's open item #1). The
           request is LEAN: only patientId, the catalogue panel, and per-analyte
           {analyte, value}. Everything the result stores that is not those raw
           numbers is SERVER-OWNED — unit/refRange/bounds/flag are
           CATALOGUE-DERIVED (§9), the label is the catalogue test's Name, the
           documenting clinician is the token, timestamps are stamped here, the
           encounter is the patient's OPEN one (409 if closed — documenting a
           result is completing care initiated on this episode), the order
           linkage is the same server-derived rule as create, and source is
           stamped "manual" so a future LIS-fed result is distinguishable (§5). */
        app.MapPost("/api/icu/results/labs/document", (DocumentLabRequest req, ClaimsPrincipal user, AuroraDb db) =>
        {
            if (Rbac.Deny(user, "results.document") is IResult denied) return denied;
            if (ResultsLogic.ValidateLabDocument(req, db) is string problem)
                return ApiError.BadRequest(problem);
            var test = Aurora.Core.MasterData.LabCatalogLogic.Resolve(db, req.Panel!)!;
            /* Option B retire semantics, SPLIT deliberately from the
               producing-service create path below: a RETIRED (inactive) test
               takes no NEW bedside documentation (it is off the menu and
               unusable — resource state, 409), while the create path keeps
               the recorded resulting-never-blocked rule (a day-3 order whose
               test was retired on day 5 must still be resultable by the
               laboratory). Historical results of a retired test keep
               resolving their definition for display either way. */
            if (!test.Active)
                return ApiError.StateConflict(
                    $"test '{test.TestId}' is retired — it takes no new documentation; its historical results remain readable");
            if (EncounterGuard.RequireOpenForPatient(db, req.PatientId!, "documenting a lab result", out var enc) is IResult conflict)
                return conflict;
            var pt = db.AdtPatients.AsNoTracking().First(p => p.PatientId == req.PatientId);
            var actor = user.FindFirst("name")?.Value ?? "Unknown";
            var now = DateTime.UtcNow;
            var time = now.ToString("HH:mm");
            var items = ResultsLogic.BuildDocumentedItems(req, test);
            /* ORDER→RESULT LINKAGE — the SAME server-derived rule as create:
               the oldest unfulfilled active Lab order for this panel on the
               open encounter, else stand alone (documenting a result that was
               never ordered is legitimate — a reflex/protocol addition). */
            var fulfilled = db.LabDraws.AsNoTracking()
                .Where(x => x.OrderId != null).Select(x => x.OrderId).ToHashSet();
            var linkedOrder = db.Orders.AsNoTracking()
                .Where(o => o.PatientId == req.PatientId && o.EncounterId == enc!.EncounterId
                    && o.Category == "Lab" && o.TestId == req.Panel && o.Status == "active")
                .OrderBy(o => o.Seq).AsEnumerable()
                .FirstOrDefault(o => !fulfilled.Contains(o.OrderId));
            var row = new LabDrawRow
            {
                LabId = ResultsLogic.NextLabId(), PatientId = req.PatientId!,
                EncounterId = enc!.EncounterId, OrderId = linkedOrder?.OrderId,
                BedId = enc.BedId, PatientName = pt.Name,
                Panel = test.TestId, Label = test.Name,
                CollectedAt = time, ResultedAt = time,
                ItemsJson = JsonSerializer.Serialize(items, JsonOpts.Web),
                Flag = ResultsLogic.DeriveLabFlag(items), Source = "manual", Note = req.Note?.Trim(),
                /* the correction-window anchor (Lab Result Editing): seconds
                   precision, the observation EnteredAt pattern */
                DocumentedAt = now.ToString("yyyy-MM-dd HH:mm:ss"),
                Acknowledged = false,
                EventsJson = JsonSerializer.Serialize(
                    new List<ResultEventDto> { new(now.ToString("yyyy-MM-dd HH:mm"), actor, "documented", null) }, JsonOpts.Web),
            };
            db.LabDraws.Add(row);
            db.SaveChanges();
            return Results.Json(row.ToDto(), JsonOpts.Web);
        }).RequireAuthorization();

        /* POST /api/icu/results/labs/document-custom — DOCUMENT a CUSTOM / OTHER
           lab test (Custom Lab Test design). The honest escape hatch for a test
           the catalogue does not have: same results.document authority
           (Doctor/SeniorDoctor/Nurse), same server-owned provenance
           (clinician + time), source=manual, open-encounter scope. But the
           result is UNSTRUCTURED and UNFLAGGED — testName + value are stored as
           free text exactly as typed; unit and reference range are optional
           free-text context; the reference range is DISPLAY-ONLY and NEVER
           drives a flag (Flag stays "" — the system does not fabricate a
           normal/abnormal/critical judgment it has no catalogue definition to
           justify). No catalogue lookup, no order linkage (a custom test has no
           catalogue TestId to match), and the numeric ItemsJson stays "[]" so
           no numeric consumer misparses the free-text value. */
        app.MapPost("/api/icu/results/labs/document-custom", (DocumentCustomLabRequest req, ClaimsPrincipal user, AuroraDb db) =>
        {
            if (Rbac.Deny(user, "results.document") is IResult denied) return denied;
            if (ResultsLogic.ValidateCustomLabDocument(req, db) is string problem)
                return ApiError.BadRequest(problem);
            if (EncounterGuard.RequireOpenForPatient(db, req.PatientId!, "documenting a custom lab result", out var enc) is IResult conflict)
                return conflict;
            var pt = db.AdtPatients.AsNoTracking().First(p => p.PatientId == req.PatientId);
            var actor = user.FindFirst("name")?.Value ?? "Unknown";
            var now = DateTime.UtcNow;
            var time = now.ToString("HH:mm");
            static string? Trimmed(string? s) => string.IsNullOrWhiteSpace(s) ? null : s.Trim();
            var row = new LabDrawRow
            {
                LabId = ResultsLogic.NextLabId(), PatientId = req.PatientId!,
                EncounterId = enc!.EncounterId, OrderId = null,
                BedId = enc.BedId, PatientName = pt.Name,
                Panel = "Custom", Label = req.TestName!.Trim(),
                CollectedAt = time, ResultedAt = time,
                ItemsJson = "[]", Flag = "", Source = "manual",
                Custom = true, CustomValue = req.Value!.Trim(),
                CustomUnit = Trimmed(req.Unit), CustomRefRange = Trimmed(req.RefRange),
                DocumentedAt = now.ToString("yyyy-MM-dd HH:mm:ss"),
                Note = Trimmed(req.Note), Acknowledged = false,
                EventsJson = JsonSerializer.Serialize(
                    new List<ResultEventDto> { new(now.ToString("yyyy-MM-dd HH:mm"), actor, "documented", null) }, JsonOpts.Web),
            };
            db.LabDraws.Add(row);
            db.SaveChanges();
            return Results.Json(row.ToDto(), JsonOpts.Web);
        }).RequireAuthorization();

        /* POST /api/icu/results/labs/{labId}/correct — the two-tier CORRECTION
           of a DOCUMENTED lab result (Lab Result Editing design; mirrors the
           observation §8 amendment). TIER 1 (self): the documenter, within the
           flat 5-minute window from documentation — needs results.document,
           reason OPTIONAL (recorded when given). TIER 2 (everything else —
           another's entry, or the window closed): needs results.correct
           (Consultant-tier), reason REQUIRED. Editable: an item VALUE (a
           structured analyte — re-derives that item's flag from its own
           stored reference bounds, then the draw's worst-of-items flag; the
           design's open item #2 resolved to re-derive-from-the-corrected-
           value) or the free-text VALUE of a custom result (stays UNFLAGGED),
           and/or the NOTE. Amend-not-erase: the row keeps CURRENT STATE (the
           store's existing convention — the Acknowledged summary fields plus
           the EventsJson record) while the amendment preserves previous→new
           with actor/role/time/reason; an audit event is appended too.
           §2b: correcting an ALREADY-ACKNOWLEDGED result is
           ALLOWED, the original acknowledgment is KEPT, and the amendment is
           stamped AfterAcknowledgment=true — the fact that the current value
           post-dates the sign-off is stored, never inferred. Only manually
           DOCUMENTED results carry the model — a seed/producing-service
           result answers 409 (no bedside correction window exists for it).
           Corrections complete the record → allowed on a CLOSED encounter, no
           EncounterGuard. RBAC ordering keeps the 403 oracle-free: the
           weakest gate (results.document — held by every possible corrector)
           answers before the lookup; the tier gate answers after. */
        app.MapPost("/api/icu/results/labs/{labId}/correct",
            (string labId, CorrectLabRequest req, ClaimsPrincipal user, AuroraDb db) =>
        {
            if (Rbac.Deny(user, "results.document") is IResult denied) return denied;
            var d = db.LabDraws.FirstOrDefault(x => x.LabId == labId);
            if (d is null) return ApiError.NotFound();
            if (d.DocumentedAt == "")
                return ApiError.StateConflict(
                    $"result '{labId}' was not manually documented — the bedside correction model applies to the documentation path only");
            var actor = user.FindFirst("name")?.Value ?? "Unknown";
            var now = DateTime.UtcNow;
            var selfTier = ResultsLogic.IsSelfTier(d, actor, now);
            if (!selfTier)
            {
                if (Rbac.Deny(user, "results.correct") is IResult deniedTier) return deniedTier;
                if (string.IsNullOrWhiteSpace(req.Reason))
                    return ApiError.BadRequest("reason is required for a Consultant-tier correction (outside the 5-minute self-correction window or on another clinician's entry)");
            }
            if (req.Reason is not null && req.Reason.Length > OrderLogic.MaxTextLength)
                return ApiError.BadRequest($"reason exceeds {OrderLogic.MaxTextLength} characters");
            if (req.Value is null && req.Note is null)
                return ApiError.BadRequest("nothing to correct — provide a corrected value and/or a corrected note");

            var role = Rbac.ProfileOf(user.FindFirst("jobTitle")?.Value ?? "") ?? "Unknown";
            var stamp = now.ToString("yyyy-MM-dd HH:mm");
            var amendments = JsonSerializer.Deserialize<List<LabAmendmentDto>>(d.AmendmentsJson, JsonOpts.Web)!;
            var applied = new List<string>();

            /* ---- the corrected VALUE ---- */
            if (req.Value is JsonElement v)
            {
                if (d.Custom)
                {
                    if (req.Analyte is not null)
                        return ApiError.BadRequest("a custom result has no analytes — correct its value without an analyte");
                    if (v.ValueKind != JsonValueKind.String || string.IsNullOrWhiteSpace(v.GetString()))
                        return ApiError.BadRequest("value must be non-empty free text for a custom result");
                    var newVal = v.GetString()!.Trim();
                    if (newVal.Length > OrderLogic.MaxTextLength)
                        return ApiError.BadRequest($"value exceeds {OrderLogic.MaxTextLength} characters");
                    if (newVal == d.CustomValue)
                        return ApiError.StateConflict($"result '{labId}' already reads {d.CustomValue} — there is nothing to correct");
                    amendments.Add(new("value", d.CustomValue ?? "", newVal, actor, stamp,
                        req.Reason?.Trim() ?? "", role, d.Acknowledged));
                    d.CustomValue = newVal;   /* stays UNFLAGGED — Flag remains "" */
                    applied.Add($"value → {newVal}");
                }
                else
                {
                    if (string.IsNullOrWhiteSpace(req.Analyte))
                        return ApiError.BadRequest("analyte is required to correct a structured result's value");
                    if (v.ValueKind != JsonValueKind.Number || !v.TryGetDouble(out var newNum) || !double.IsFinite(newNum))
                        return ApiError.BadRequest("value must be a finite number for a structured result");
                    var items = JsonSerializer.Deserialize<List<LabItemFull>>(d.ItemsJson, JsonOpts.Web)!;
                    var idx = items.FindIndex(i => i.Analyte == req.Analyte);
                    if (idx < 0)
                        return ApiError.BadRequest($"analyte '{req.Analyte}' is not part of this result — expected one of: {string.Join(", ", items.Select(i => i.Analyte))}");
                    var item = items[idx];
                    if (newNum == item.Value)
                        return ApiError.StateConflict($"{req.Analyte} already reads {item.Value} — there is nothing to correct");
                    /* re-derive the item flag from the corrected value against the
                       item's OWN stored bounds — incl. the snapshotted critical
                       thresholds (Option B) — then the draw's worst-of-items */
                    items[idx] = item with { Value = newNum, Flag = ResultsLogic.FlagForValue(newNum, item.RefLow, item.RefHigh, item.CritLow, item.CritHigh) };
                    amendments.Add(new(req.Analyte!, item.Value.ToString("0.####"), newNum.ToString("0.####"),
                        actor, stamp, req.Reason?.Trim() ?? "", role, d.Acknowledged));
                    d.ItemsJson = JsonSerializer.Serialize(items, JsonOpts.Web);
                    d.Flag = ResultsLogic.DeriveLabFlag(items);
                    applied.Add($"{req.Analyte} {item.Value:0.####} → {newNum:0.####}");
                }
            }

            /* ---- the corrected NOTE ---- */
            if (req.Note is not null)
            {
                var newNote = req.Note.Trim();
                if (newNote.Length == 0) return ApiError.BadRequest("note must be non-empty when provided");
                if (newNote.Length > OrderLogic.MaxTextLength)
                    return ApiError.BadRequest($"note exceeds {OrderLogic.MaxTextLength} characters");
                if (newNote == (d.Note ?? ""))
                    return ApiError.StateConflict($"the note already reads that — there is nothing to correct");
                amendments.Add(new("note", d.Note ?? "", newNote, actor, stamp,
                    req.Reason?.Trim() ?? "", role, d.Acknowledged));
                d.Note = newNote;
                applied.Add("note corrected");
            }

            d.AmendmentsJson = JsonSerializer.Serialize(amendments, JsonOpts.Web);
            d.EventsJson = ResultsLogic.AppendEvent(d.EventsJson,
                new(now.ToString("yyyy-MM-dd HH:mm"), actor, "corrected",
                    $"{string.Join(" · ", applied)}{(selfTier ? " (self, within window)" : $" — {req.Reason!.Trim()}")}{(d.Acknowledged ? " [after acknowledgment]" : "")}"));
            db.SaveChanges();
            return Results.Json(d.ToDto(), JsonOpts.Web);
        }).RequireAuthorization();

        /* POST /api/icu/results/imaging — CREATE an imaging result (same rules;
           the study is recorded at the RESULTED stage: report + impression
           present, status final — the ordered/performed pipeline stages
           arrive with the imaging ORDER workflow, not manual result entry). */
        app.MapPost("/api/icu/results/imaging", (CreateImagingRequest req, ClaimsPrincipal user, AuroraDb db) =>
        {
            if (Rbac.Deny(user, "results.create") is IResult denied) return denied;
            if (ResultsLogic.ValidateImagingCreate(req, db) is string problem)
                return ApiError.BadRequest(problem);
            if (EncounterGuard.RequireOpenForPatient(db, req.PatientId!, "creating an imaging result", out var enc) is IResult conflict)
                return conflict;
            var pt = db.AdtPatients.AsNoTracking().First(p => p.PatientId == req.PatientId);
            var actor = user.FindFirst("name")?.Value ?? "Unknown";
            var now = DateTime.UtcNow;
            var time = now.ToString("HH:mm");
            var row = new ImagingStudyRow
            {
                StudyId = ResultsLogic.NextStudyId(), PatientId = req.PatientId!,
                EncounterId = enc!.EncounterId, BedId = enc.BedId, PatientName = pt.Name,
                Modality = req.Modality!.Trim(), Description = req.Description!.Trim(),
                OrderedAt = time, PerformedAt = time, ReportedAt = time, Status = "final",
                Report = req.Report!.Trim(), Impression = req.Impression!.Trim(),
                Flag = req.Flag!, Note = req.Note?.Trim(),
                Acknowledged = false,
                EventsJson = JsonSerializer.Serialize(
                    new List<ResultEventDto> { new(now.ToString("yyyy-MM-dd HH:mm"), actor, "resulted", null) }, JsonOpts.Web),
            };
            db.ImagingStudies.Add(row);
            db.SaveChanges();
            return Results.Json(row.ToDto(), JsonOpts.Web);
        }).RequireAuthorization();

        /* POST /api/icu/results/labs/{labId}/acknowledge — doctor RBAC
           (results.acknowledge). NO EncounterGuard — acknowledging is
           completing the record and must succeed on a closed encounter.
           REPLAY IS A STATE CONFLICT (409), not absence: a result that is
           already acknowledged EXISTS — 404 is reserved for ids that
           resolve to nothing (the 403/404/409 convention codified by the
           encounter-scoping fix). Event times are DATED UTC (the users-
           audit convention — result audit trails span discharges and
           readmissions); the acknowledgedAt SUMMARY stays HH:mm (the
           bedside display contract, unchanged on the wire). */
        app.MapPost("/api/icu/results/labs/{labId}/acknowledge", (string labId, ClaimsPrincipal user, AuroraDb db) =>
        {
            if (Rbac.Deny(user, "results.acknowledge") is IResult denied) return denied;
            var d = db.LabDraws.FirstOrDefault(x => x.LabId == labId);
            if (d is null) return ApiError.NotFound();
            if (d.Acknowledged)
                return ApiError.StateConflict(
                    $"result '{labId}' is already acknowledged (by {d.AcknowledgedBy} at {d.AcknowledgedAt}) — it is not awaiting acknowledgment");
            /* Lab Result Editing §2a: a DOCUMENTED result cannot be
               acknowledged inside its 5-minute self-correction window — the
               value stabilises before anyone signs off on it (nobody
               acknowledges a value that might still get a Tier-1 typo fix).
               Resource STATE → 409. Results without a documentation anchor
               (seed rows, the producing-service create path) have no window
               and acknowledge exactly as before. */
            if (ResultsLogic.WithinSelfWindow(d, DateTime.UtcNow))
                return ApiError.StateConflict(
                    $"result '{labId}' is still in its {ResultsLogic.SelfCorrectWindowMinutes}-minute self-correction window (documented {d.DocumentedAt} UTC) — it becomes acknowledgeable when the window closes");
            var now = DateTime.UtcNow;
            d.Acknowledged = true;
            d.AcknowledgedBy = user.FindFirst("name")?.Value ?? "Unknown";
            d.AcknowledgedAt = now.ToString("HH:mm");
            d.EventsJson = ResultsLogic.AppendEvent(d.EventsJson,
                new(now.ToString("yyyy-MM-dd HH:mm"), d.AcknowledgedBy, "acknowledged", null));
            db.SaveChanges();
            return Results.Json(d.ToDto(), JsonOpts.Web);
        }).RequireAuthorization();

        /* POST /api/icu/results/imaging/{studyId}/acknowledge — doctor RBAC. */
        app.MapPost("/api/icu/results/imaging/{studyId}/acknowledge", (string studyId, ClaimsPrincipal user, AuroraDb db) =>
        {
            if (Rbac.Deny(user, "results.acknowledge") is IResult denied) return denied;
            var s = db.ImagingStudies.FirstOrDefault(x => x.StudyId == studyId);
            if (s is null) return ApiError.NotFound();
            if (s.Acknowledged)
                return ApiError.StateConflict(
                    $"result '{studyId}' is already acknowledged (by {s.AcknowledgedBy} at {s.AcknowledgedAt}) — it is not awaiting acknowledgment");
            var now = DateTime.UtcNow;
            s.Acknowledged = true;
            s.AcknowledgedBy = user.FindFirst("name")?.Value ?? "Unknown";
            s.AcknowledgedAt = now.ToString("HH:mm");
            s.EventsJson = ResultsLogic.AppendEvent(s.EventsJson,
                new(now.ToString("yyyy-MM-dd HH:mm"), s.AcknowledgedBy, "acknowledged", null));
            db.SaveChanges();
            return Results.Json(s.ToDto(), JsonOpts.Web);
        }).RequireAuthorization();

        /* POST /api/icu/results/labs/{labId}/unacknowledge — reverse an
           acknowledgment (own or another's). Doctor RBAC mirrors
           acknowledge; a REQUIRED reason is validated like discontinue.
           NEVER a deletion: the original acknowledgment stays in the event
           history; the reversal appends its own audited event; the
           current-state summary clears and the result RETURNS TO THE
           INBOX (derived from Acknowledged=false). NO EncounterGuard —
           completing the record stays allowed on a closed encounter. */
        app.MapPost("/api/icu/results/labs/{labId}/unacknowledge",
            (string labId, UnacknowledgeRequest req, ClaimsPrincipal user, AuroraDb db) =>
        {
            if (Rbac.Deny(user, "results.acknowledge") is IResult denied) return denied;
            if (string.IsNullOrWhiteSpace(req.Reason))
                return ApiError.BadRequest("reason is required to reverse an acknowledgment");
            if (req.Reason.Length > OrderLogic.MaxTextLength)
                return ApiError.BadRequest($"reason exceeds {OrderLogic.MaxTextLength} characters");
            var d = db.LabDraws.FirstOrDefault(x => x.LabId == labId);
            if (d is null) return ApiError.NotFound();
            if (!d.Acknowledged)
                return ApiError.StateConflict(
                    $"result '{labId}' is not acknowledged — there is no acknowledgment to reverse");
            var actor = user.FindFirst("name")?.Value ?? "Unknown";
            d.EventsJson = ResultsLogic.AppendEvent(d.EventsJson,
                new(DateTime.UtcNow.ToString("yyyy-MM-dd HH:mm"), actor, "unacknowledged",
                    $"acknowledgment by {d.AcknowledgedBy} at {d.AcknowledgedAt} reversed — {req.Reason.Trim()}"));
            d.Acknowledged = false;
            d.AcknowledgedBy = null;
            d.AcknowledgedAt = null;
            db.SaveChanges();
            return Results.Json(d.ToDto(), JsonOpts.Web);
        }).RequireAuthorization();

        /* POST /api/icu/results/imaging/{studyId}/unacknowledge — same rules. */
        app.MapPost("/api/icu/results/imaging/{studyId}/unacknowledge",
            (string studyId, UnacknowledgeRequest req, ClaimsPrincipal user, AuroraDb db) =>
        {
            if (Rbac.Deny(user, "results.acknowledge") is IResult denied) return denied;
            if (string.IsNullOrWhiteSpace(req.Reason))
                return ApiError.BadRequest("reason is required to reverse an acknowledgment");
            if (req.Reason.Length > OrderLogic.MaxTextLength)
                return ApiError.BadRequest($"reason exceeds {OrderLogic.MaxTextLength} characters");
            var s = db.ImagingStudies.FirstOrDefault(x => x.StudyId == studyId);
            if (s is null) return ApiError.NotFound();
            if (!s.Acknowledged)
                return ApiError.StateConflict(
                    $"result '{studyId}' is not acknowledged — there is no acknowledgment to reverse");
            var actor = user.FindFirst("name")?.Value ?? "Unknown";
            s.EventsJson = ResultsLogic.AppendEvent(s.EventsJson,
                new(DateTime.UtcNow.ToString("yyyy-MM-dd HH:mm"), actor, "unacknowledged",
                    $"acknowledgment by {s.AcknowledgedBy} at {s.AcknowledgedAt} reversed — {req.Reason.Trim()}"));
            s.Acknowledged = false;
            s.AcknowledgedBy = null;
            s.AcknowledgedAt = null;
            db.SaveChanges();
            return Results.Json(s.ToDto(), JsonOpts.Web);
        }).RequireAuthorization();
    }
}

using System.Security.Claims;
using Aurora.Core.Identity;
using Aurora.Core.Persistence;
using Aurora.Core.Shared;
using Microsoft.EntityFrameworkCore;

namespace Aurora.Core.MasterData;

/* ------- Configuration Vocabularies API (Master Data, Aurora Core) -------
   Dispositions, isolation types, shifts, and named-frequency management —
   the last four vocabularies, each on the CodeStatusApi pattern exactly:
   every authenticated profile may READ (bedside surfaces render from the
   vocabulary, and a RETIRED entry must keep resolving on records that
   carry it); mutations are gated per-domain and AUDITED on the entry's
   append-only event history (actor from the token, dated UTC).

   RBAC (design §5 — per-domain atoms, stated):
   - dispositions.manage / isolation.manage / shifts.manage — CLINICAL /
     OPERATIONAL governance → SeniorDoctor (the codestatus.manage /
     observations.configure precedent). NEVER the office Administrator,
     never the System Administrator (the F2/F3 hard constraint).
   - frequencies.manage — medication scheduling → Pharmacist (the
     formulary.manage governance; doctors and administrators are 403'd).

   Four-code rule everywhere: 403 permission · 404 absent code · 409
   state (duplicate create, replayed de/reactivation, the reserved-died
   rule) · 400 malformed. ASSIGNING a value to a patient is NOT here —
   discharge carries the disposition (adt.discharge), the encounter
   isolation write is observations.record (AdtApi), the assignment
   carries the shift (assignments.manage), and orders carry frequencies
   (orders.create/modify). */
static class VocabApi
{
    /* one shared tenant mapper — the four vocabularies differ only in
       table, atom, and domain wording, so the mechanics live once */
    public static void Map(WebApplication app)
    {
        MapVocab(app, "dispositions", "dispositions.manage", "disposition", "dsp",
            db => db.Dispositions.OrderBy(d => d.Seq).AsNoTracking().AsEnumerable().Select(d => (object)d.ToDto()),
            (db, code) => db.Dispositions.FirstOrDefault(d => d.Code == code) is DispositionRow r
                ? new VocabHandle(r.Code, r.Label, r.Active,
                    () => { r.Active = false; }, () => { r.Active = true; },
                    l => { r.Label = l; }, () => r.EventsJson, j => r.EventsJson = j, () => r.ToDto())
                : null,
            db => db.Dispositions.AsNoTracking().AsEnumerable().Select(d => (d.Code, d.Label, d.Active)),
            /* THE RESERVED RULE (design §1): 'died' is structural — the
               deceased guard and the mortality numerator depend on a
               death disposition always being recordable. A rule in code,
               like the q<n>h pattern — never hospital data. */
            deactivateGuard: (db, code) => code == "died"
                ? "disposition 'died' is reserved and can never be retired — the deceased "
                  + "re-admission guard and the mortality statistics depend on a death "
                  + "outcome always being recordable"
                : null);

        MapVocab(app, "isolation-types", "isolation.manage", "isolation type", "iso",
            db => db.IsolationTypes.OrderBy(t => t.Seq).AsNoTracking().AsEnumerable().Select(t => (object)t.ToDto()),
            (db, code) => db.IsolationTypes.FirstOrDefault(t => t.Code == code) is IsolationTypeRow r
                ? new VocabHandle(r.Code, r.Label, r.Active,
                    () => { r.Active = false; }, () => { r.Active = true; },
                    l => { r.Label = l; }, () => r.EventsJson, j => r.EventsJson = j, () => r.ToDto())
                : null,
            db => db.IsolationTypes.AsNoTracking().AsEnumerable().Select(t => (t.Code, t.Label, t.Active)));

        MapVocab(app, "shifts", "shifts.manage", "shift", "shf",
            db => db.Shifts.OrderBy(s => s.Seq).AsNoTracking().AsEnumerable().Select(s => (object)s.ToDto()),
            (db, code) => db.Shifts.FirstOrDefault(s => s.Code == code) is ShiftRow r
                ? new VocabHandle(r.Code, r.Label, r.Active,
                    () => { r.Active = false; }, () => { r.Active = true; },
                    l => { r.Label = l; }, () => r.EventsJson, j => r.EventsJson = j, () => r.ToDto())
                : null,
            db => db.Shifts.AsNoTracking().AsEnumerable().Select(s => (s.Code, s.Label, s.Active)));

        /* dispositions POST is mapped separately (it carries the
           immutable isDeath attribute at creation — see MapVocab's
           create for the other tenants) */
        app.MapPost("/api/icu/dispositions", (CreateDispositionRequest req, ClaimsPrincipal user, AuroraDb db) =>
        {
            if (Rbac.Deny(user, "dispositions.manage") is IResult denied) return denied;
            if (ValidateCodeLabel(req.Code, req.Label, out var code, out var label) is string err)
                return ApiError.BadRequest(err);
            if (code.Length == 0)
                code = FormularyLogic.NewKey("dsp", c => db.Dispositions.AsNoTracking().Any(d => d.Code == c));
            if (db.Dispositions.FirstOrDefault(d => d.Code == code) is DispositionRow existing)
                return ApiError.StateConflict(
                    $"disposition '{code}' already exists ({existing.Label}, {(existing.Active ? "active" : "inactive")}) — codes are permanent");
            if (ActiveLabelDup(db.Dispositions.AsNoTracking().AsEnumerable()
                    .Select(d => (d.Code, d.Label, d.Active)), label, null) is string dupLabel)
                return ApiError.StateConflict(
                    $"an active disposition labelled '{dupLabel}' already exists — two identical entries would be indistinguishable at discharge; edit or retire the existing one");
            var actor = user.FindFirst("name")?.Value ?? "Unknown";
            var row = new DispositionRow
            {
                Code = code, Label = label, IsDeath = req.IsDeath ?? false,
                Seq = (db.Dispositions.Max(d => (int?)d.Seq) ?? 0) + 1, Active = true,
                EventsJson = System.Text.Json.JsonSerializer.Serialize(
                    new List<FormularyEventDto> { new(FormularyLogic.Now(), actor, "added to vocabulary",
                        req.IsDeath == true ? "counts as death (deceased guard + mortality) — immutable" : null) }, JsonOpts.Web),
            };
            db.Dispositions.Add(row);
            db.SaveChanges();
            return Results.Json(row.ToDto(), JsonOpts.Web);
        }).RequireAuthorization();

        MapFrequencies(app);
    }

    /* a closed-over row handle so one mapper serves three tables without
       reflection — the lambdas capture the tracked row */
    sealed record VocabHandle(string Code, string Label, bool Active,
        Action Deactivate, Action Reactivate, Action<string> SetLabel,
        Func<string> GetEvents, Action<string> SetEvents, Func<object> ToDto);

    /* free-text correction: the user types only the LABEL — an empty
       code is GENERATED by the caller (hidden internal key, permanent
       once created); an explicit code stays wire-accepted with no
       format rule. Labels carry only the platform bound. */
    static string? ValidateCodeLabel(string? rawCode, string? rawLabel, out string code, out string label)
    {
        code = (rawCode ?? "").Trim(); label = (rawLabel ?? "").Trim();
        if (code.Length > FormularyLogic.MaxTextLength)
            return $"code exceeds {FormularyLogic.MaxTextLength} characters";
        if (label.Length == 0) return "label is required";
        if (label.Length > FormularyLogic.MaxTextLength)
            return $"label exceeds {FormularyLogic.MaxTextLength} characters";
        return null;
    }

    /** the ACTIVE label that would collide (case-insensitive, trimmed),
        or null — the label is the only identity a human sees, so a
        duplicate active label is a 409 (the imaging-name precedent) */
    static string? ActiveLabelDup(IEnumerable<(string Code, string Label, bool Active)> rows,
        string label, string? excludeCode)
    {
        var lowered = label.Trim().ToLowerInvariant();
        foreach (var r in rows)
            if (r.Active && r.Code != excludeCode && r.Label.Trim().ToLowerInvariant() == lowered)
                return r.Label;
        return null;
    }

    static void MapVocab(WebApplication app, string path, string atom, string noun, string prefix,
        Func<AuroraDb, IEnumerable<object>> list,
        Func<AuroraDb, string, VocabHandle?> resolve,
        Func<AuroraDb, IEnumerable<(string Code, string Label, bool Active)>> snapshot,
        Func<AuroraDb, string, string?>? deactivateGuard = null)
    {
        /* GET — all entries incl. inactive (management needs them, and a
           RETIRED entry must keep resolving on records that carry it;
           new selection excludes inactive and the server enforces it) */
        app.MapGet($"/api/icu/{path}", (HttpContext ctx, AuroraDb db) =>
        {
            foreach (var key in ctx.Request.Query.Keys)
                return ApiError.BadRequest($"unknown query parameter '{key}'");
            return Results.Json(list(db), JsonOpts.Web);
        }).RequireAuthorization();

        /* POST — add an entry (dispositions map their own create above) */
        if (path != "dispositions")
            app.MapPost($"/api/icu/{path}", (CreateVocabEntryRequest req, ClaimsPrincipal user, AuroraDb db) =>
            {
                if (Rbac.Deny(user, atom) is IResult denied) return denied;
                if (ValidateCodeLabel(req.Code, req.Label, out var code, out var label) is string err)
                    return ApiError.BadRequest(err);
                if (code.Length == 0)
                    code = FormularyLogic.NewKey(prefix, c => resolve(db, c) is not null);
                if (resolve(db, code) is VocabHandle existing)
                    return ApiError.StateConflict(
                        $"{noun} '{code}' already exists ({existing.Label}, {(existing.Active ? "active" : "inactive")}) — codes are permanent");
                if (ActiveLabelDup(snapshot(db), label, null) is string dupLabel)
                    return ApiError.StateConflict(
                        $"an active {noun} labelled '{dupLabel}' already exists — two identical entries would be indistinguishable when selecting; edit or retire the existing one");
                var actor = user.FindFirst("name")?.Value ?? "Unknown";
                var events = System.Text.Json.JsonSerializer.Serialize(
                    new List<FormularyEventDto> { new(FormularyLogic.Now(), actor, "added to vocabulary", null) }, JsonOpts.Web);
                object row = path switch
                {
                    "isolation-types" => db.IsolationTypes.Add(new IsolationTypeRow
                    {
                        Code = code, Label = label, Active = true, EventsJson = events,
                        Seq = (db.IsolationTypes.Max(t => (int?)t.Seq) ?? 0) + 1,
                    }).Entity,
                    _ => db.Shifts.Add(new ShiftRow
                    {
                        Code = code, Label = label, Active = true, EventsJson = events,
                        Seq = (db.Shifts.Max(s => (int?)s.Seq) ?? 0) + 1,
                    }).Entity,
                };
                db.SaveChanges();
                return Results.Json(row is IsolationTypeRow it ? it.ToDto() : (object)((ShiftRow)row).ToDto(), JsonOpts.Web);
            }).RequireAuthorization();

        /* PUT — edit the label; the code is the immutable natural key
           (and for dispositions isDeath is likewise immutable — the
           request contract has no such field, by design) */
        app.MapPut($"/api/icu/{path}/{{code}}", (string code, EditVocabEntryRequest req, ClaimsPrincipal user, AuroraDb db) =>
        {
            if (Rbac.Deny(user, atom) is IResult denied) return denied;
            var row = resolve(db, code);
            if (row is null) return ApiError.NotFound();
            var label = (req.Label ?? "").Trim();
            if (label.Length == 0) return ApiError.BadRequest("label is required");
            if (label.Length > FormularyLogic.MaxTextLength)
                return ApiError.BadRequest($"label exceeds {FormularyLogic.MaxTextLength} characters");
            if (label == row.Label)
                return ApiError.BadRequest("no field change — the provided label matches the current entry");
            if (ActiveLabelDup(snapshot(db), label, code) is string dupLabel)
                return ApiError.StateConflict(
                    $"an active {noun} labelled '{dupLabel}' already exists — two identical entries would be indistinguishable when selecting");
            var actor = user.FindFirst("name")?.Value ?? "Unknown";
            row.SetEvents(FormularyLogic.AppendEvents(row.GetEvents(),
                [new(FormularyLogic.Now(), actor, "changed", $"label: {row.Label} → {label}")]));
            row.SetLabel(label);
            db.SaveChanges();
            return Results.Json(row.ToDto(), JsonOpts.Web);
        }).RequireAuthorization();

        /* POST deactivate — RETIRE: a status change, never a delete.
           Records carrying the entry keep rendering it; NEW selection of
           it is refused (409 at the consuming endpoint). */
        app.MapPost($"/api/icu/{path}/{{code}}/deactivate", (string code, ClaimsPrincipal user, AuroraDb db) =>
        {
            if (Rbac.Deny(user, atom) is IResult denied) return denied;
            var row = resolve(db, code);
            if (row is null) return ApiError.NotFound();
            if (deactivateGuard?.Invoke(db, code) is string guard) return ApiError.StateConflict(guard);
            if (!row.Active)
                return ApiError.StateConflict($"{noun} '{code}' is already inactive — there is nothing to deactivate");
            var actor = user.FindFirst("name")?.Value ?? "Unknown";
            row.Deactivate();
            row.SetEvents(FormularyLogic.AppendEvents(row.GetEvents(),
                [new(FormularyLogic.Now(), actor, "retired", null)]));
            db.SaveChanges();
            return Results.Json(row.ToDto(), JsonOpts.Web);
        }).RequireAuthorization();

        /* POST reactivate */
        app.MapPost($"/api/icu/{path}/{{code}}/reactivate", (string code, ClaimsPrincipal user, AuroraDb db) =>
        {
            if (Rbac.Deny(user, atom) is IResult denied) return denied;
            var row = resolve(db, code);
            if (row is null) return ApiError.NotFound();
            if (row.Active)
                return ApiError.StateConflict($"{noun} '{code}' is already active — there is nothing to reactivate");
            /* reactivation may not resurrect a duplicate selectable label */
            if (ActiveLabelDup(snapshot(db), row.Label, code) is string dupLabel)
                return ApiError.StateConflict(
                    $"an active {noun} labelled '{dupLabel}' already exists — reactivating '{row.Label}' would put two identical entries in the picker");
            var actor = user.FindFirst("name")?.Value ?? "Unknown";
            row.Reactivate();
            row.SetEvents(FormularyLogic.AppendEvents(row.GetEvents(),
                [new(FormularyLogic.Now(), actor, "reactivated", null)]));
            db.SaveChanges();
            return Results.Json(row.ToDto(), JsonOpts.Web);
        }).RequireAuthorization();
    }

    /* ---------- named frequencies (design §4) ----------
       The VALUE is both identity and display (it is what orders store),
       so there is no edit — add / retire / reactivate only. The q<n>h
       structured pattern STAYS CODE (a safety-shaped rule like the
       infusion-unit closed union, never a hospital list): a hospital
       adds NAMED frequencies; it does not redefine what q6h means.
       GET /api/icu/formulary/frequencies (the plain string list order
       validation quotes) now serves ACTIVE values — its consumers want
       "what may I pick", and the wire shape is unchanged. */
    static void MapFrequencies(WebApplication app)
    {
        /* GET entries — the management view: every row incl. inactive,
           with per-value drug references (allowed-but-surfaced retire) */
        app.MapGet("/api/icu/formulary/frequencies/entries", (HttpContext ctx, AuroraDb db) =>
        {
            foreach (var key in ctx.Request.Query.Keys)
                return ApiError.BadRequest($"unknown query parameter '{key}'");
            return Results.Json(FrequencyEntries(db), JsonOpts.Web);
        }).RequireAuthorization();

        app.MapPost("/api/icu/formulary/frequencies", (CreateFrequencyRequest req, ClaimsPrincipal user, AuroraDb db) =>
        {
            if (Rbac.Deny(user, "frequencies.manage") is IResult denied) return denied;
            /* free-text correction: the value is FREE TEXT (it appears
               verbatim on orders) — only the platform bound applies. The
               q<n>h collision guard is a SAFETY rule and stays: MAR
               derives dose schedules by parsing q<n>h structurally, so a
               NAMED 'q6h' would shadow the built-in meaning. */
            var value = (req.Value ?? "").Trim();
            if (value.Length == 0) return ApiError.BadRequest("value is required");
            if (value.Length > FormularyLogic.MaxTextLength)
                return ApiError.BadRequest($"value exceeds {FormularyLogic.MaxTextLength} characters");
            if (System.Text.RegularExpressions.Regex.IsMatch(value, @"^q\d+h$"))
                return ApiError.BadRequest("structured q<n>h frequencies are built in (q1h-q48h) — add NAMED frequencies only");
            if (db.NamedFrequencies.FirstOrDefault(f => f.Value == value) is NamedFrequencyRow existing)
                return ApiError.StateConflict(
                    $"named frequency '{value}' already exists ({(existing.Active ? "active" : "inactive")}) — values are permanent");
            var actor = user.FindFirst("name")?.Value ?? "Unknown";
            var row = new NamedFrequencyRow
            {
                Value = value, Seq = (db.NamedFrequencies.Max(f => (int?)f.Seq) ?? 0) + 1, Active = true,
                EventsJson = System.Text.Json.JsonSerializer.Serialize(
                    new List<FormularyEventDto> { new(FormularyLogic.Now(), actor, "added to vocabulary", null) }, JsonOpts.Web),
            };
            db.NamedFrequencies.Add(row);
            db.SaveChanges();
            return Results.Json(ToEntryDto(db, row), JsonOpts.Web);
        }).RequireAuthorization();

        app.MapPost("/api/icu/formulary/frequencies/{value}/deactivate", (string value, ClaimsPrincipal user, AuroraDb db) =>
        {
            if (Rbac.Deny(user, "frequencies.manage") is IResult denied) return denied;
            var row = db.NamedFrequencies.FirstOrDefault(f => f.Value == value);
            if (row is null) return ApiError.NotFound();
            if (!row.Active)
                return ApiError.StateConflict($"named frequency '{value}' is already inactive — there is nothing to deactivate");
            var actor = user.FindFirst("name")?.Value ?? "Unknown";
            row.Active = false;
            row.EventsJson = FormularyLogic.AppendEvents(row.EventsJson,
                [new(FormularyLogic.Now(), actor, "retired", null)]);
            db.SaveChanges();
            /* allowed-but-surfaced: the response NAMES the drugs whose
               per-drug list carries the value (the UI shows them) */
            return Results.Json(ToEntryDto(db, row), JsonOpts.Web);
        }).RequireAuthorization();

        app.MapPost("/api/icu/formulary/frequencies/{value}/reactivate", (string value, ClaimsPrincipal user, AuroraDb db) =>
        {
            if (Rbac.Deny(user, "frequencies.manage") is IResult denied) return denied;
            var row = db.NamedFrequencies.FirstOrDefault(f => f.Value == value);
            if (row is null) return ApiError.NotFound();
            if (row.Active)
                return ApiError.StateConflict($"named frequency '{value}' is already active — there is nothing to reactivate");
            var actor = user.FindFirst("name")?.Value ?? "Unknown";
            row.Active = true;
            row.EventsJson = FormularyLogic.AppendEvents(row.EventsJson,
                [new(FormularyLogic.Now(), actor, "reactivated", null)]);
            db.SaveChanges();
            return Results.Json(ToEntryDto(db, row), JsonOpts.Web);
        }).RequireAuthorization();
    }

    /* the outer rows MATERIALIZE before the per-row drug projection —
       ToEntryDto issues its own query, and Npgsql (unlike SQLite)
       refuses a new command while a reader is open on the connection
       (found by the Postgres verification run, not the SQLite one) */
    static List<FrequencyEntryDto> FrequencyEntries(AuroraDb db) =>
        db.NamedFrequencies.AsNoTracking().OrderBy(f => f.Seq).ToList()
            .Select(f => ToEntryDto(db, f)).ToList();

    static FrequencyEntryDto ToEntryDto(AuroraDb db, NamedFrequencyRow f) => new(
        f.Value, f.Seq, f.Active,
        db.FormularyDrugs.AsNoTracking().AsEnumerable()
            .Where(d => System.Text.Json.JsonSerializer.Deserialize<List<string>>(d.FrequenciesJson, JsonOpts.Web)!.Contains(f.Value))
            .OrderBy(d => d.Seq).Select(d => d.Name).ToList(),
        System.Text.Json.JsonSerializer.Deserialize<List<FormularyEventDto>>(f.EventsJson, JsonOpts.Web)!);
}

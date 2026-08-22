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
        MapVocab<DispositionRow>(app, "dispositions", "dispositions.manage", "disposition", "dsp",
            db => db.Dispositions,
            db => db.Dispositions.OrderBy(d => d.Seq).AsNoTracking().AsEnumerable().Select(d => (object)d.ToDto()),
            (db, code) => db.Dispositions.FirstOrDefault(d => d.Code == code) is DispositionRow r
                ? new VocabHandle(r.Code, r.Label, r.Active,
                    () => { r.Active = false; }, () => { r.Active = true; },
                    l => { r.Label = l; }, () => r.EventsJson, j => r.EventsJson = j, () => r.ToDto())
                : null,
            db => db.Dispositions.AsNoTracking().AsEnumerable().Select(d => (d.Code, d.Label, d.Active)),
            /* no shared create: dispositions map their own POST below, because
               the entry carries the immutable isDeath attribute at creation and
               the shared CreateVocabEntryRequest has no field for it. Explicit
               null, not an omission — the parameter is required. */
            toDto: null,
            /* THE RESERVED RULE (design §1): 'died' is structural — the
               deceased guard and the mortality numerator depend on a
               death disposition always being recordable. A rule in code,
               like the q<n>h pattern — never hospital data. */
            deactivateGuard: (db, code) => code == "died"
                ? "disposition 'died' is reserved and can never be retired — the deceased "
                  + "re-admission guard and the mortality statistics depend on a death "
                  + "outcome always being recordable"
                : null);

        MapVocab<IsolationTypeRow>(app, "isolation-types", "isolation.manage", "isolation type", "iso",
            db => db.IsolationTypes,
            db => db.IsolationTypes.OrderBy(t => t.Seq).AsNoTracking().AsEnumerable().Select(t => (object)t.ToDto()),
            (db, code) => db.IsolationTypes.FirstOrDefault(t => t.Code == code) is IsolationTypeRow r
                ? new VocabHandle(r.Code, r.Label, r.Active,
                    () => { r.Active = false; }, () => { r.Active = true; },
                    l => { r.Label = l; }, () => r.EventsJson, j => r.EventsJson = j, () => r.ToDto())
                : null,
            db => db.IsolationTypes.AsNoTracking().AsEnumerable().Select(t => (t.Code, t.Label, t.Active)),
            toDto: r => r.ToDto());

        MapVocab<ShiftRow>(app, "shifts", "shifts.manage", "shift", "shf",
            db => db.Shifts,
            db => db.Shifts.OrderBy(s => s.Seq).AsNoTracking().AsEnumerable().Select(s => (object)s.ToDto()),
            (db, code) => db.Shifts.FirstOrDefault(s => s.Code == code) is ShiftRow r
                ? new VocabHandle(r.Code, r.Label, r.Active,
                    () => { r.Active = false; }, () => { r.Active = true; },
                    l => { r.Label = l; }, () => r.EventsJson, j => r.EventsJson = j, () => r.ToDto())
                : null,
            db => db.Shifts.AsNoTracking().AsEnumerable().Select(s => (s.Code, s.Label, s.Active)),
            toDto: r => r.ToDto());

        /* ---------- Inpatient Reception master data (design §2) ----------
           Four hospital-configured lists, all gated on hospital.configure —
           the office Administrator's ADMINISTRATIVE atom, never a clinical
           profile: a department is how a hospital describes itself, not a
           clinical judgement (the hospital-identity precedent).
           Three of the four drop straight onto this mapper. The fourth,
           SERVICE, carries an immutable parent at creation and therefore maps
           its own POST below — the same explicit exception dispositions take,
           not a new mechanism. */
        MapVocab<AdmissionTypeRow>(app, "admission-types", "hospital.configure", "admission type", "atp",
            db => db.AdmissionTypes,
            db => db.AdmissionTypes.OrderBy(t => t.Seq).AsNoTracking().AsEnumerable().Select(t => (object)t.ToDto()),
            (db, code) => db.AdmissionTypes.FirstOrDefault(t => t.Code == code) is AdmissionTypeRow r
                ? new VocabHandle(r.Code, r.Label, r.Active,
                    () => { r.Active = false; }, () => { r.Active = true; },
                    l => { r.Label = l; }, () => r.EventsJson, j => r.EventsJson = j, () => r.ToDto())
                : null,
            db => db.AdmissionTypes.AsNoTracking().AsEnumerable().Select(t => (t.Code, t.Label, t.Active)),
            toDto: r => r.ToDto());

        MapVocab<DepartmentRow>(app, "departments", "hospital.configure", "department", "dep",
            db => db.Departments,
            db => db.Departments.OrderBy(d => d.Seq).AsNoTracking().AsEnumerable().Select(d => (object)d.ToDto()),
            (db, code) => db.Departments.FirstOrDefault(d => d.Code == code) is DepartmentRow r
                ? new VocabHandle(r.Code, r.Label, r.Active,
                    () => { r.Active = false; }, () => { r.Active = true; },
                    l => { r.Label = l; }, () => r.EventsJson, j => r.EventsJson = j, () => r.ToDto())
                : null,
            db => db.Departments.AsNoTracking().AsEnumerable().Select(d => (d.Code, d.Label, d.Active)),
            toDto: r => r.ToDto(),
            /* THE HIERARCHY GUARD, HALF OF IT (design §2.1). Retiring a
               department is refused while it still has ACTIVE SERVICES — the
               occupied-bed precedent, and the reason a Service may never be
               left pointing at a retired parent.
               THE OTHER HALF — refused while the department has OPEN
               ADMISSIONS — IS NOT BUILT AND CANNOT BE: an admission does not
               carry a department until the admission build lands, so there is
               nothing to count. It is recorded as owed in 02_PROJECT_STATUS.md
               rather than left silently absent. A half-guard that reads as a
               whole one is exactly the false-green shape this repo keeps
               paying for, so it is named here at the guard itself. */
            /* §2.1 asks for retirement to be refused while a department has
               active SERVICES *or* OPEN ADMISSIONS. Both halves are here now.
               THE ADMISSIONS HALF WAS RECORDED AS OWED "to the admission
               build" (02, #199) because an admission carried no department and
               there was nothing to count. Step 5 is that build — and it is
               what makes this half necessary rather than merely possible:
               before it, retiring a department could not strand anything;
               after it, an open encounter can point at a department, and
               retiring one out from under a patient who is still admitted
               under it is exactly the orphan the guard exists to prevent.
               A half-guard that reads as a whole one is the shape this repo
               keeps paying for, so it is closed in the same change that makes
               it reachable. */
            deactivateGuard: (db, code) =>
            {
                var kids = db.Services.AsNoTracking().Where(s => s.DepartmentCode == code && s.Active)
                    .OrderBy(s => s.Seq).Select(s => s.Label).ToList();
                if (kids.Count > 0)
                    return $"department '{code}' still has {kids.Count} active service(s) — {string.Join(", ", kids)} — "
                        + "retire those services first; a service may never point at a retired department";
                var open = db.Encounters.AsNoTracking()
                    .Where(e => e.Status == "open" && e.DepartmentCode == code)
                    .OrderBy(e => e.EncounterId).Select(e => e.EncounterId).ToList();
                return open.Count == 0 ? null
                    : $"department '{code}' still has {open.Count} open admission(s) — {string.Join(", ", open)} — "
                      + "discharge or transfer them first; a patient may never be admitted under a retired department";
            });

        /* SERVICE — GET/PUT/deactivate/reactivate come from the mapper; only
           POST is its own (the parent is immutable at creation and the shared
           CreateVocabEntryRequest has no field for it). Explicit null, not an
           omission — the parameter is required. */
        MapVocab<ServiceRow>(app, "services", "hospital.configure", "service", "svc",
            db => db.Services,
            db => db.Services.OrderBy(s => s.Seq).AsNoTracking().AsEnumerable().Select(s => (object)s.ToDto()),
            (db, code) => db.Services.FirstOrDefault(s => s.Code == code) is ServiceRow r
                ? new VocabHandle(r.Code, r.Label, r.Active,
                    () => { r.Active = false; }, () => { r.Active = true; },
                    l => { r.Label = l; }, () => r.EventsJson, j => r.EventsJson = j, () => r.ToDto())
                : null,
            db => db.Services.AsNoTracking().AsEnumerable().Select(s => (s.Code, s.Label, s.Active)),
            toDto: null);

        MapVocab<AdmissionSourceRow>(app, "admission-sources", "hospital.configure", "admission source", "src",
            db => db.AdmissionSources,
            db => db.AdmissionSources.OrderBy(s => s.Seq).AsNoTracking().AsEnumerable().Select(s => (object)s.ToDto()),
            (db, code) => db.AdmissionSources.FirstOrDefault(s => s.Code == code) is AdmissionSourceRow r
                ? new VocabHandle(r.Code, r.Label, r.Active,
                    () => { r.Active = false; }, () => { r.Active = true; },
                    l => { r.Label = l; }, () => r.EventsJson, j => r.EventsJson = j, () => r.ToDto())
                : null,
            db => db.AdmissionSources.AsNoTracking().AsEnumerable().Select(s => (s.Code, s.Label, s.Active)),
            toDto: r => r.ToDto());

        /* WARD — the FIFTH tenant (ward.md Amendment A1): Area promoted to a
           governed vocabulary on this same mapper, gated hospital.configure
           like the four above (a ward NAME is administrative structure —
           the recorded administrative/clinical split). The CODE is the
           value beds already carry in `Area` (the backfill writes it
           verbatim), so beds join the vocabulary by construction.
           THE RETIRE GUARD is the department/active-services precedent:
           a ward with ACTIVE beds refuses to retire — a bed may never
           point at a retired ward, exactly as a service may never point
           at a retired department. Retired beds do NOT block (their ward
           reference is historical, resolution stays total). */
        MapVocab<WardRow>(app, "wards", "hospital.configure", "ward", "wrd",
            db => db.Wards,
            db => db.Wards.OrderBy(w => w.Seq).AsNoTracking().AsEnumerable().Select(w => (object)w.ToDto()),
            (db, code) => db.Wards.FirstOrDefault(w => w.Code == code) is WardRow r
                ? new VocabHandle(r.Code, r.Label, r.Active,
                    () => { r.Active = false; }, () => { r.Active = true; },
                    l => { r.Label = l; }, () => r.EventsJson, j => r.EventsJson = j, () => r.ToDto())
                : null,
            db => db.Wards.AsNoTracking().AsEnumerable().Select(w => (w.Code, w.Label, w.Active)),
            toDto: r => r.ToDto(),
            deactivateGuard: (db, code) =>
            {
                var beds = db.Beds.AsNoTracking().Where(b => b.Area == code && b.Active)
                    .OrderBy(b => b.Seq).Select(b => b.BedId).ToList();
                return beds.Count == 0 ? null
                    : $"ward '{code}' still has {beds.Count} active bed(s) — {string.Join(", ", beds)} — "
                      + "retire those beds or move them to another ward first; a bed may never point at a retired ward";
            });

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

        /* ---------------- services POST (the design's one hierarchy) --------
           MAPPED SEPARATELY because a service carries its immutable parent
           `departmentCode` at creation, and the shared CreateVocabEntryRequest
           has no field for it.

           🔴 THIS INSERT SITS OUTSIDE #197's COMPILE-TIME GUARANTEE, and that
           is the whole reason the production-seed job asserts this path by SQL.
           MapVocab<TRow> OWNS the Add for every other tenant, so a registration
           naming another tenant's DbSet cannot compile. Here the Add is
           HAND-WRITTEN — `db.Services.Add(row)` is a line a human chose, and
           writing `db.Shifts.Add(...)` instead would compile perfectly. The
           wrong-table class #195 and #197 closed is reachable again through
           exactly this escape hatch and nowhere else in the mapper, so the one
           path the type system cannot reach is the one covered by a runtime
           assertion instead. Dispositions' own POST has the same property; both
           are now exercised by that leg.

           THE PARENT IS VALIDATED IN APPLICATION CODE — this database has no
           foreign keys. The precedent is ObservationType.GroupCode
           (ObservationCatalogApi.cs:51-54): an unknown parent is a payload
           reference resolving to nothing → 400 that NAMES what is valid; a
           RETIRED parent is resource state → 409 (reactivate it and the same
           request succeeds). The four-code rule, unchanged. */
        app.MapPost("/api/icu/services", (CreateServiceRequest req, ClaimsPrincipal user, AuroraDb db) =>
        {
            if (Rbac.Deny(user, "hospital.configure") is IResult denied) return denied;
            if (ValidateCodeLabel(req.Code, req.Label, out var code, out var label) is string err)
                return ApiError.BadRequest(err);
            var deptCode = (req.DepartmentCode ?? "").Trim();
            if (deptCode.Length == 0)
                return ApiError.BadRequest(
                    "departmentCode is required — a service cannot exist without a parent department");
            var dept = db.Departments.AsNoTracking().FirstOrDefault(d => d.Code == deptCode);
            if (dept is null)
            {
                var known = db.Departments.AsNoTracking().Where(d => d.Active)
                    .OrderBy(d => d.Seq).Select(d => d.Code).ToList();
                return ApiError.BadRequest(
                    $"departmentCode '{deptCode}' does not match any department — "
                    + (known.Count == 0
                        ? "no departments are configured yet; add one before adding services under it"
                        : $"active departments: {string.Join(", ", known)}"));
            }
            if (!dept.Active)
                return ApiError.StateConflict(
                    $"department '{deptCode}' ({dept.Label}) is retired — reactivate it before adding services under it");
            if (code.Length == 0)
                code = FormularyLogic.NewKey("svc", c => db.Services.AsNoTracking().Any(s => s.Code == c));
            if (db.Services.FirstOrDefault(s => s.Code == code) is ServiceRow existing)
                return ApiError.StateConflict(
                    $"service '{code}' already exists ({existing.Label}, {(existing.Active ? "active" : "inactive")}) — codes are permanent");
            /* FLAGGED, and deliberately the STRICTER rule: the duplicate-label
               check is TABLE-WIDE, not per-department, so "Emergency" cannot
               exist under two departments at once. The design does not decide
               this. Table-wide is chosen because the shared mapper's PUT
               enforces exactly that on every edit — scoping CREATE
               per-department while EDIT stayed table-wide would let a row be
               created that can never be edited. A uniform stricter rule costs
               an occasional precise 409; a split rule costs a trap. Relaxing it
               later means Service mapping its own PUT too, and is recorded in
               02_PROJECT_STATUS.md as the open question it is. */
            if (ActiveLabelDup(db.Services.AsNoTracking().AsEnumerable()
                    .Select(s => (s.Code, s.Label, s.Active)), label, null) is string dupLabel)
                return ApiError.StateConflict(
                    $"an active service labelled '{dupLabel}' already exists — two identical entries would be "
                    + "indistinguishable when selecting; edit or retire the existing one");
            var actor = user.FindFirst("name")?.Value ?? "Unknown";
            var row = new ServiceRow
            {
                Code = code, Label = label,
                /* the RESOLVED row's code, never the raw request string */
                DepartmentCode = dept.Code,
                Seq = (db.Services.Max(s => (int?)s.Seq) ?? 0) + 1, Active = true,
                /* the audit SNAPSHOTS the parent's label as it read at this
                   moment — a later rename of the department cannot rewrite what
                   this entry was filed under (a code is identity, never
                   meaning) */
                EventsJson = System.Text.Json.JsonSerializer.Serialize(
                    new List<FormularyEventDto> { new(FormularyLogic.Now(), actor, "added to vocabulary",
                        $"under department {dept.Label} ({dept.Code})") }, JsonOpts.Web),
            };
            db.Services.Add(row);
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

    /* `create` is REQUIRED and positional — it has no default ON PURPOSE.
       Until 2026-08-09 there was no such parameter: the POST half switched on
       the `path` STRING and ended `_ => db.Shifts.Add(new ShiftRow ...)`. A new
       tenant registered here without also editing that switch therefore did not
       fail — every POST to it silently inserted a ShiftRow. Wrong table, a
       200 response, and an entry that then showed up in the shift picker and
       nowhere else. Nothing threw, nothing logged, no test noticed.
       Now the row factory is supplied by the caller like list/resolve/snapshot
       already were, so forgetting it is a COMPILE ERROR rather than a silent
       write to somebody else's table. It returns a THUNK, not a DTO, so the
       DTO is still built AFTER SaveChanges exactly as before.
       A tenant that maps its own POST (dispositions — it carries the immutable
       isDeath at creation) passes an explicit `null`: an omission is now
       impossible, but a deliberate exception is still expressible and visible.
       scripts/vocab-registration-gate.mjs is the belt to this braces. */
    static void MapVocab<TRow>(WebApplication app, string path, string atom, string noun, string prefix,
        Func<AuroraDb, DbSet<TRow>> set,
        Func<AuroraDb, IEnumerable<object>> list,
        Func<AuroraDb, string, VocabHandle?> resolve,
        Func<AuroraDb, IEnumerable<(string Code, string Label, bool Active)>> snapshot,
        Func<TRow, object>? toDto,
        Func<AuroraDb, string, string?>? deactivateGuard = null)
        where TRow : class, IVocabRow, new()
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

        /* POST — add an entry. The condition is now "did this tenant supply a
           row factory?", not a string comparison against one tenant's name:
           dispositions map their own create above (isDeath at creation). */
        if (toDto is not null)
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
                /* the caller's own factory — no switch, no default, no cast.
                   The old return line had the SAME hazard as the switch it
                   followed: `(ShiftRow)row` was the fallback cast, so a new
                   tenant would have been serialised as a shift or thrown an
                   InvalidCastException at the very end of a successful write. */
                /* THE MAPPER OWNS THE INSERT. The caller supplies the DbSet and a
                   row->DTO projection; it never writes an Add of its own, so it
                   cannot name the wrong table. Seq and the audit stamp are
                   computed here once for every tenant. The DTO is still built
                   AFTER SaveChanges, exactly as before. */
                var rows = set(db);
                var row = new TRow
                {
                    Code = code, Label = label, Active = true, EventsJson = events,
                    Seq = (rows.Max(r => (int?)r.Seq) ?? 0) + 1,
                };
                rows.Add(row);
                db.SaveChanges();
                return Results.Json(toDto(row), JsonOpts.Web);
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
            /* \d KEPT DELIBERATELY (the one survivor of the [0-9]
               class fix): this match gates a REFUSAL, so Unicode-wide \d is
               the SAFE direction — 'q٦h' reads as q6h to the humans this
               guard protects, and narrowing to [0-9] would let it become a
               named frequency that shadows the structural meaning. */
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

using System.ComponentModel.DataAnnotations;
using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;

/* AURORA ICU — Stage 10: roster/patients service + authentication.
   Phase 1: GET /api/icu/patients serves the canonical unit roster from
   SQLite, seeded with the same 14-patient data as the frontend mock store
   (Data/roster-seed.json is GENERATED from src/lib/api/data/roster.ts).
   Phase 2: real authentication — a users table (the same 20 staff as the
   Stage 9 preset list; Data/users-seed.json is GENERATED from src/lib/
   session.ts) with bcrypt-hashed passwords, POST /api/auth/login issuing
   a JWT, and JWT bearer validation applied to the roster endpoint. All 20
   demo users share ONE password (DEMO_PASSWORD env, default "Aurora2026!")
   — a documented NON-PRODUCTION credential; no registration/reset flow yet.

   SQLite is a deliberate, documented Phase 1 simplification: swapping to
   SQL Server later is an EF Core provider change (UseSqlite → UseSqlServer
   + connection string), not a rewrite. The container never bakes the DB —
   it is created and seeded at startup, so the hosting choice stays
   swappable (Docker anywhere). */

var builder = WebApplication.CreateBuilder(args);

/* Render (and most PaaS) inject PORT; default 8080 for local Docker runs. */
var port = Environment.GetEnvironmentVariable("PORT") ?? "8080";
builder.WebHost.UseUrls($"http://0.0.0.0:{port}");

/* SQLite file lives under ./data (ephemeral on Render free tier — reseeded
   on every boot, which is correct for Phase 1 read-only roster data). */
var dbPath = Environment.GetEnvironmentVariable("DB_PATH") ?? "data/aurora.db";
Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(dbPath))!);
builder.Services.AddDbContext<RosterDb>(o => o.UseSqlite($"Data Source={dbPath}"));

/* CORS — explicit allowlist only. The deployed GitHub Pages origin is the
   default; override/extend with CORS_ORIGINS (semicolon-separated). */
var corsOrigins = (Environment.GetEnvironmentVariable("CORS_ORIGINS")
    ?? "https://jaafer272007-design.github.io;http://localhost:5173;http://localhost:4173")
    .Split(';', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
builder.Services.AddCors(o => o.AddDefaultPolicy(p =>
    p.WithOrigins(corsOrigins).AllowAnyHeader().WithMethods("GET", "POST", "PUT")));

/* ---- JWT (Stage 10 Phase 2) ----
   Signing key from JWT_SECRET (any length — hashed to 256 bits). When the
   env var is unset a random per-boot key is generated: fine for the demo
   (tokens simply expire when the free-tier service restarts), and it means
   no secret ever lives in the repo. Validation is registered ONCE here so
   Phase 3 endpoints opt in with just `.RequireAuthorization()`. */
var jwtSecret = Environment.GetEnvironmentVariable("JWT_SECRET");
if (string.IsNullOrWhiteSpace(jwtSecret))
    jwtSecret = Convert.ToBase64String(RandomNumberGenerator.GetBytes(48));
var jwtKey = new SymmetricSecurityKey(SHA256.HashData(Encoding.UTF8.GetBytes(jwtSecret)));
const string JwtIssuer = "aurora-icu";
const string JwtAudience = "aurora-icu-client";

builder.Services
    .AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(o =>
    {
        /* keep original claim names ("sub"/"name"/"jobTitle") — Phase 3's
           server-side RBAC reads jobTitle straight off the principal */
        o.MapInboundClaims = false;
        o.TokenValidationParameters = new TokenValidationParameters
        {
        ValidIssuer = JwtIssuer,
        ValidAudience = JwtAudience,
        IssuerSigningKey = jwtKey,
        ValidateIssuer = true,
        ValidateAudience = true,
        ValidateIssuerSigningKey = true,
            ValidateLifetime = true,
            ClockSkew = TimeSpan.FromMinutes(1),
        };
    });
builder.Services.AddAuthorization();

var app = builder.Build();
app.UseCors();
app.UseAuthentication();
app.UseAuthorization();

/* Shared demo password — bcrypt-hashed once at startup, NEVER stored or
   logged in plaintext beyond this env read. Non-production, documented. */
var demoPassword = Environment.GetEnvironmentVariable("DEMO_PASSWORD") ?? "Aurora2026!";
/* verified against when the username doesn't exist, so unknown-user and
   wrong-password take the same time (no user enumeration via timing) */
var decoyHash = BCrypt.Net.BCrypt.HashPassword(Guid.NewGuid().ToString(), workFactor: 10);

/* create + seed the database at startup if empty */
using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<RosterDb>();
    /* The DB is a startup-built cache (Render free tier disks are ephemeral
       anyway) — rebuild it every boot so schema changes (e.g. Phase 2's
       Users table) never need migrations against a stale file. */
    db.Database.EnsureDeleted();
    db.Database.EnsureCreated();
    if (!db.Patients.Any())
    {
        var seedPath = Path.Combine(AppContext.BaseDirectory, "Data", "roster-seed.json");
        var records = JsonSerializer.Deserialize<List<RosterRecordDto>>(
            File.ReadAllText(seedPath), JsonOpts.Web)!;
        db.Patients.AddRange(records.Select(PatientRow.FromDto));
        db.SaveChanges();
        app.Logger.LogInformation("Seeded {Count} roster records into {Db}", records.Count, dbPath);
    }
    if (!db.Users.Any())
    {
        var seedPath = Path.Combine(AppContext.BaseDirectory, "Data", "users-seed.json");
        var staff = JsonSerializer.Deserialize<List<UserSeedDto>>(
            File.ReadAllText(seedPath), JsonOpts.Web)!;
        /* one hash per user (same demo password, distinct salts — hashes
           must never reveal that two users share a password) */
        db.Users.AddRange(staff.Select(s => new UserRow
        {
            Username = s.Username,
            Name = s.Name,
            JobTitle = s.JobTitle,
            PasswordHash = BCrypt.Net.BCrypt.HashPassword(demoPassword, workFactor: 10),
        }));
        db.SaveChanges();
        app.Logger.LogInformation("Seeded {Count} user accounts", staff.Count);
    }
    if (!db.LabDraws.Any())
    {
        var labs = JsonSerializer.Deserialize<List<LabDrawDto>>(
            File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Data", "labs-seed.json")), JsonOpts.Web)!;
        var imaging = JsonSerializer.Deserialize<List<ImagingStudyDto>>(
            File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Data", "imaging-seed.json")), JsonOpts.Web)!;
        db.LabDraws.AddRange(labs.Select(LabDrawRow.FromDto));
        db.ImagingStudies.AddRange(imaging.Select(ImagingStudyRow.FromDto));
        db.SaveChanges();
        app.Logger.LogInformation("Seeded {Labs} lab draws + {Imaging} imaging studies", labs.Count, imaging.Count);
    }
    if (!db.Orders.Any())
    {
        var orders = JsonSerializer.Deserialize<List<OrderDto>>(
            File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Data", "orders-seed.json")), JsonOpts.Web)!;
        db.Orders.AddRange(orders.Select((o, i) => OrderRow.FromDto(o, i + 1)));
        db.SaveChanges();
        app.Logger.LogInformation("Seeded {Count} orders", orders.Count);
    }
}

/* health/warmup probe (also Render's health check path) */
app.MapGet("/healthz", () => Results.Json(new { status = "ok", service = "aurora-icu-api", phase = "stage10-phase3" }));

/* POST /api/auth/login — Phase 2's authentication endpoint (anonymous).
   Accepts username OR full display name + password; verifies against the
   bcrypt hash; returns a JWT whose claims carry the user's identity and
   JobTitle. Failure is ALWAYS the same generic 401 — never reveals whether
   the username or the password was wrong. */
app.MapPost("/api/auth/login", (LoginRequest req, RosterDb db) =>
{
    var input = (req.Username ?? "").Trim().ToLowerInvariant();
    var user = input.Length == 0 ? null : db.Users.AsNoTracking()
        .AsEnumerable()
        .FirstOrDefault(u => u.Username == input || u.Name.ToLowerInvariant() == input);
    var verified = BCrypt.Net.BCrypt.Verify(req.Password ?? "", user?.PasswordHash ?? decoyHash);
    if (user is null || !verified)
        return Results.Json(new { error = "Invalid credentials" }, JsonOpts.Web, statusCode: 401);

    var now = DateTime.UtcNow;
    var token = new JwtSecurityTokenHandler().WriteToken(new JwtSecurityToken(
        issuer: JwtIssuer,
        audience: JwtAudience,
        claims:
        [
            new Claim(JwtRegisteredClaimNames.Sub, user.Username),
            new Claim(JwtRegisteredClaimNames.Jti, Guid.NewGuid().ToString()),
            new Claim("name", user.Name),
            new Claim("jobTitle", user.JobTitle),
        ],
        notBefore: now,
        expires: now.AddHours(12), // one shift
        signingCredentials: new SigningCredentials(jwtKey, SecurityAlgorithms.HmacSha256)));
    return Results.Json(new { token, name = user.Name, jobTitle = user.JobTitle }, JsonOpts.Web);
});

/* GET /api/icu/patients — the canonical unit roster (Phase 1's single real
   endpoint; Phase 2 puts it behind JWT bearer auth — future endpoints adopt
   the same middleware with just .RequireAuthorization()). Matches the
   contract documented on the frontend mock adapter; note alertCount is NOT
   served: it is a DERIVED value (AI alerts + unacked results + bed alert)
   and those domains are still mock — the frontend adapter derives it, same
   as before (derived state is never stored). */
app.MapGet("/api/icu/patients", (RosterDb db) =>
    Results.Json(db.Patients.AsNoTracking()
        .OrderBy(p => p.PatientId)
        .AsEnumerable()
        .Select(p => p.ToDto()), JsonOpts.Web))
    .RequireAuthorization();

/* ---------------- Orders & Medication (Stage 10 Phase 3, Orders PR) ----------------
   The canonical orders service — full order lifecycle behind JWT auth with
   the same server-side RBAC pattern as results: create/sign/modify/
   discontinue require the doctor-level permissions, implement requires the
   nurse's orders.implement — each derived from the token's jobTitle claim
   at read time. A nurse token gets a generic 403 on every prescriber
   mutation even when the UI is bypassed. The acting/signing actor is ALWAYS
   the token's name claim, never a request field. MAR administrations stay
   MOCK this phase (their own migration comes next). */

/* GET /api/icu/orders?patientId&status&implement — filtered order list
   (per-patient full list incl. audit history, pending signature queue,
   nursing implementation queue — the same derived views the mock serves). */
app.MapGet("/api/icu/orders", (string? patientId, string? status, bool? implement, RosterDb db) =>
{
    var q = db.Orders.AsNoTracking().AsQueryable();
    if (patientId is not null) q = q.Where(o => o.PatientId == patientId);
    if (status is not null) q = q.Where(o => o.Status == status);
    if (implement == true) q = q.Where(o => o.Status == "active" && o.RequiresImplementation == true);
    return Results.Json(q.OrderBy(o => o.Seq).AsEnumerable().Select(o => o.ToDto()), JsonOpts.Web);
}).RequireAuthorization();

/* POST /api/icu/orders — create order(s); sign=true activates immediately.
   Body: { drafts: NewOrderDraft[], sign, note? }. Patient name/bed are
   resolved server-side from the roster (denormalized display snapshot).
   A payload that doesn't match the contract is REJECTED with 400 — never
   a 200 that silently creates nothing (a client believing an order was
   placed when it wasn't is a patient-safety failure). Unrecognized JSON
   fields are rejected at binding time (see the request DTOs' Disallow
   attributes), and every draft is validated BEFORE any is inserted so a
   bad batch creates zero orders, never a partial one. */
app.MapPost("/api/icu/orders", (CreateOrdersRequest req, ClaimsPrincipal user, RosterDb db) =>
{
    if (Rbac.Deny(user, "orders.create") is IResult d1) return d1;
    if (req.Sign && Rbac.Deny(user, "orders.sign") is IResult d2) return d2;

    if (req.Drafts is null || req.Drafts.Count == 0)
        return OrderLogic.BadRequest("At least one order draft is required (drafts[])");
    if (req.Note?.Length > OrderLogic.MaxTextLength)
        return OrderLogic.BadRequest($"note exceeds {OrderLogic.MaxTextLength} characters");
    for (var i = 0; i < req.Drafts.Count; i++)
    {
        if (OrderLogic.ValidateDraft(req.Drafts[i], i, db) is string problem)
            return OrderLogic.BadRequest(problem);
    }

    var actor = user.FindFirst("name")?.Value ?? "Unknown";
    var time = DateTime.UtcNow.ToString("HH:mm");
    var created = new List<OrderDto>();
    foreach (var draft in req.Drafts)
    {
        var pt = db.Patients.AsNoTracking().First(p => p.PatientId == draft.PatientId);
        var history = new List<OrderEventDto> { new(time, actor, "created", req.Note) };
        List<AdminDto>? administrations = null;
        if (req.Sign)
        {
            history.Add(new(time, actor, "signed", null));
            if (draft.Medication is not null) administrations = OrderLogic.GenerateAdministrations(draft.Medication);
        }
        var dto = new OrderDto(
            OrderLogic.NextOrderId(), draft.PatientId!, pt.BedId, pt.Name,
            draft.Category!, draft.Summary ?? OrderLogic.MedSummary(draft.Medication!),
            draft.Medication, draft.Priority!, req.Sign ? "active" : "pending",
            actor, time, draft.RequiresImplementation, administrations, history, null);
        db.Orders.Add(OrderRow.FromDto(dto, OrderLogic.NextSeq()));
        created.Add(dto);
    }
    db.SaveChanges();
    return Results.Json(created, JsonOpts.Web);
}).RequireAuthorization();

/* POST /api/icu/orders/{orderId}/sign — doctor RBAC (orders.sign). */
app.MapPost("/api/icu/orders/{orderId}/sign", (string orderId, ClaimsPrincipal user, RosterDb db) =>
{
    if (Rbac.Deny(user, "orders.sign") is IResult denied) return denied;
    var row = db.Orders.FirstOrDefault(x => x.OrderId == orderId && x.Status == "pending");
    if (row is null) return Results.Json(new { error = "Not found" }, JsonOpts.Web, statusCode: 404);
    var actor = user.FindFirst("name")?.Value ?? "Unknown";
    var o = row.ToDto();
    row.Status = "active";
    row.HistoryJson = OrderLogic.AppendHistory(row.HistoryJson,
        new(DateTime.UtcNow.ToString("HH:mm"), actor, "signed", null));
    if (o.Medication is not null && o.Administrations is null)
        row.AdministrationsJson = JsonSerializer.Serialize(OrderLogic.GenerateAdministrations(o.Medication), JsonOpts.Web);
    db.SaveChanges();
    return Results.Json(row.ToDto(), JsonOpts.Web);
}).RequireAuthorization();

/* PUT /api/icu/orders/{orderId} — modify medication fields; reason required
   (doctor RBAC, orders.modify). Body: { changes, reason }. */
app.MapPut("/api/icu/orders/{orderId}", (string orderId, ModifyOrderRequest req, ClaimsPrincipal user, RosterDb db) =>
{
    if (Rbac.Deny(user, "orders.modify") is IResult denied) return denied;
    if (string.IsNullOrWhiteSpace(req.Reason))
        return OrderLogic.BadRequest("Reason required");
    if (req.Reason.Length > OrderLogic.MaxTextLength)
        return OrderLogic.BadRequest($"reason exceeds {OrderLogic.MaxTextLength} characters");
    /* a modify that carries no recognized change field is a malformed
       request (typo'd payload), not a no-op to record — reject it */
    if (req.Changes is null || !req.Changes.HasAnyField)
        return OrderLogic.BadRequest("changes must include at least one medication field (drug, dose, route, frequency, duration, prn, prnIndication)");
    /* provided change values must be usable — a whitespace dose blanking an
       ACTIVE medication order is exactly the silent hazard this guards */
    if (OrderLogic.ValidateChanges(req.Changes) is string invalid)
        return OrderLogic.BadRequest(invalid);
    var row = db.Orders.FirstOrDefault(x => x.OrderId == orderId && (x.Status == "active" || x.Status == "pending"));
    if (row is null || row.MedicationJson is null)
        return Results.Json(new { error = "Not found" }, JsonOpts.Web, statusCode: 404);
    var actor = user.FindFirst("name")?.Value ?? "Unknown";
    var before = JsonSerializer.Deserialize<MedicationDto>(row.MedicationJson, JsonOpts.Web)!;
    var (merged, diff) = OrderLogic.ApplyChanges(before, req.Changes);
    row.MedicationJson = JsonSerializer.Serialize(merged, JsonOpts.Web);
    row.Summary = OrderLogic.MedSummary(merged);
    row.HistoryJson = OrderLogic.AppendHistory(row.HistoryJson,
        new(DateTime.UtcNow.ToString("HH:mm"), actor, "modified",
            $"{(diff.Length > 0 ? diff : "no field change")} — {req.Reason.Trim()}"));
    db.SaveChanges();
    return Results.Json(row.ToDto(), JsonOpts.Web);
}).RequireAuthorization();

/* POST /api/icu/orders/{orderId}/discontinue — reason required (doctor RBAC). */
app.MapPost("/api/icu/orders/{orderId}/discontinue", (string orderId, DiscontinueRequest req, ClaimsPrincipal user, RosterDb db) =>
{
    if (Rbac.Deny(user, "orders.discontinue") is IResult denied) return denied;
    if (string.IsNullOrWhiteSpace(req.Reason))
        return OrderLogic.BadRequest("Reason required");
    if (req.Reason.Length > OrderLogic.MaxTextLength)
        return OrderLogic.BadRequest($"reason exceeds {OrderLogic.MaxTextLength} characters");
    var row = db.Orders.FirstOrDefault(x => x.OrderId == orderId && (x.Status == "active" || x.Status == "pending"));
    if (row is null) return Results.Json(new { error = "Not found" }, JsonOpts.Web, statusCode: 404);
    var actor = user.FindFirst("name")?.Value ?? "Unknown";
    row.Status = "discontinued";
    row.StatusReason = req.Reason.Trim();
    if (row.AdministrationsJson is not null)
    {
        /* remaining scheduled administrations are cancelled with the order */
        var admins = JsonSerializer.Deserialize<List<AdminDto>>(row.AdministrationsJson, JsonOpts.Web)!
            .Where(a => a.Status != "scheduled").ToList();
        row.AdministrationsJson = JsonSerializer.Serialize(admins, JsonOpts.Web);
    }
    row.HistoryJson = OrderLogic.AppendHistory(row.HistoryJson,
        new(DateTime.UtcNow.ToString("HH:mm"), actor, "discontinued", req.Reason.Trim()));
    db.SaveChanges();
    return Results.Json(row.ToDto(), JsonOpts.Web);
}).RequireAuthorization();

/* POST /api/icu/orders/{orderId}/implement — nurse RBAC (orders.implement):
   one-shot completion of a non-med order from "Orders to Implement".
   Note a DOCTOR token is correctly rejected here — implementation is a
   nursing permission in the locked RBAC model. */
app.MapPost("/api/icu/orders/{orderId}/implement", (string orderId, ClaimsPrincipal user, RosterDb db) =>
{
    if (Rbac.Deny(user, "orders.implement") is IResult denied) return denied;
    var row = db.Orders.FirstOrDefault(x => x.OrderId == orderId && x.Status == "active" && x.RequiresImplementation == true);
    if (row is null) return Results.Json(new { error = "Not found" }, JsonOpts.Web, statusCode: 404);
    var actor = user.FindFirst("name")?.Value ?? "Unknown";
    var time = DateTime.UtcNow.ToString("HH:mm");
    row.Status = "completed";
    row.HistoryJson = OrderLogic.AppendHistory(
        OrderLogic.AppendHistory(row.HistoryJson, new(time, actor, "implemented", null)),
        new(time, actor, "completed", null));
    db.SaveChanges();
    return Results.Json(row.ToDto(), JsonOpts.Web);
}).RequireAuthorization();

/* ---------------- Medication Administration Record (Stage 10 Phase 3, MAR) ----------------
   The MAR has NO table of its own: administrations live on the Orders
   table (the administrations JSON of signed medication orders), so these
   endpoints read from and mutate the REAL orders store — never a parallel
   copy. RBAC polarity FLIPS vs the prescriber mutations: administering a
   dose requires the NURSE's meds.administer, so a doctor token is 403'd
   here (mirroring implement). The administering actor is always the
   token's name claim. Given needs no reason; Held/Refused require one
   (validated like discontinue). */

/* GET /api/icu/mar — unit-wide MAR rows, DERIVED server-side at read time
   from the orders' administrations (derived state is never stored). The
   nurse-assignment narrowing stays a client-side derivation, same as the
   orders implement queue. */
app.MapGet("/api/icu/mar", (RosterDb db) =>
    Results.Json(db.Orders.AsNoTracking()
        .Where(o => o.MedicationJson != null && o.AdministrationsJson != null)
        .OrderBy(o => o.Seq)
        .AsEnumerable()
        .SelectMany(OrderLogic.MarRowsFor), JsonOpts.Web))
    .RequireAuthorization();

/* POST /api/icu/mar/{orderId}/administrations/{adminId} — document a dose
   (Given/Held/Refused). Nurse RBAC (meds.administer); doctor → 403.
   Body: { action, reason? }; reason required for held/refused. */
app.MapPost("/api/icu/mar/{orderId}/administrations/{adminId}",
    (string orderId, string adminId, AdministerRequest req, ClaimsPrincipal user, RosterDb db) =>
{
    if (Rbac.Deny(user, "meds.administer") is IResult denied) return denied;
    if (req.Action is not ("given" or "held" or "refused"))
        return OrderLogic.BadRequest("action must be one of: given, held, refused");
    var needsReason = req.Action is "held" or "refused";
    if (needsReason && string.IsNullOrWhiteSpace(req.Reason))
        return OrderLogic.BadRequest($"reason is required when a dose is {req.Action}");
    if (req.Reason is not null && req.Reason.Length > OrderLogic.MaxTextLength)
        return OrderLogic.BadRequest($"reason exceeds {OrderLogic.MaxTextLength} characters");

    var row = db.Orders.FirstOrDefault(x => x.OrderId == orderId);
    if (row is null || row.AdministrationsJson is null)
        return Results.Json(new { error = "Not found" }, JsonOpts.Web, statusCode: 404);
    var admins = JsonSerializer.Deserialize<List<AdminDto>>(row.AdministrationsJson, JsonOpts.Web)!;
    var idx = admins.FindIndex(a => a.AdminId == adminId && a.Status == "scheduled");
    if (idx < 0) return Results.Json(new { error = "Not found" }, JsonOpts.Web, statusCode: 404);

    var actor = user.FindFirst("name")?.Value ?? "Unknown";
    var time = DateTime.UtcNow.ToString("HH:mm");
    var reason = needsReason ? req.Reason!.Trim() : null;
    admins[idx] = admins[idx] with
    {
        Status = req.Action, DocumentedTime = time, DocumentedBy = actor, Reason = reason,
    };
    row.AdministrationsJson = JsonSerializer.Serialize(admins, JsonOpts.Web);
    var verb = req.Action == "given" ? "administered" : req.Action;
    var detail = $"{(admins[idx].ScheduledTime.Length > 0 ? admins[idx].ScheduledTime : "PRN")} dose {req.Action} at {time}"
        + (reason is not null ? $" — {reason}" : "");
    row.HistoryJson = OrderLogic.AppendHistory(row.HistoryJson, new(time, actor, verb, detail));
    db.SaveChanges();
    return Results.Json(row.ToDto(), JsonOpts.Web);
}).RequireAuthorization();

/* ---------------- Laboratory & Imaging results (Stage 10 Phase 3) ----------------
   The canonical results service — same wire contract the mock adapter
   documents. All endpoints require a valid JWT; the acknowledge actions
   ADDITIONALLY require the results.acknowledge permission, derived
   server-side from the token's jobTitle claim via the same three-layer
   RBAC lookup the frontend uses (User → JobTitle → Profile → Permissions,
   computed at read time, never stored). A nurse token is rejected with a
   403 here regardless of what the UI shows — the first real server-side
   RBAC enforcement. The acknowledging actor is taken from the TOKEN's
   name claim, never from the request body (server-verified identity). */

/* GET /api/icu/results/labs?patientId — all lab draws for a patient, oldest first. */
app.MapGet("/api/icu/results/labs", (string patientId, RosterDb db) =>
    Results.Json(db.LabDraws.AsNoTracking()
        .Where(d => d.PatientId == patientId)
        .OrderBy(d => d.LabId)
        .AsEnumerable()
        .Select(d => d.ToDto()), JsonOpts.Web))
    .RequireAuthorization();

/* GET /api/icu/results/imaging?patientId — imaging studies incl. reports. */
app.MapGet("/api/icu/results/imaging", (string patientId, RosterDb db) =>
    Results.Json(db.ImagingStudies.AsNoTracking()
        .Where(s => s.PatientId == patientId)
        .OrderBy(s => s.StudyId)
        .AsEnumerable()
        .Select(s => s.ToDto()), JsonOpts.Web))
    .RequireAuthorization();

/* GET /api/icu/results/inbox — unit-wide unacknowledged results, DERIVED at
   read time from the stored draws/studies (derived state is never stored). */
app.MapGet("/api/icu/results/inbox", (RosterDb db) =>
{
    var labs = db.LabDraws.AsNoTracking().Where(d => !d.Acknowledged).AsEnumerable().Select(d =>
    {
        var items = JsonSerializer.Deserialize<List<LabItemDto>>(d.ItemsJson, JsonOpts.Web)!;
        var h = items.FirstOrDefault(i => i.Flag == "critical")
            ?? items.FirstOrDefault(i => i.Flag == "abnormal") ?? items[0];
        var v = h.Value == Math.Floor(h.Value) ? ((long)h.Value).ToString() : h.Value.ToString("0.0");
        return new InboxItemDto("lab", d.LabId, d.PatientId, d.BedId, d.PatientName,
            $"{h.Analyte} {v} {h.Unit} — {d.BedId} {d.PatientName}".Replace("  ", " "),
            d.Note ?? $"{d.Panel} panel resulted", d.ResultedAt, d.Flag);
    });
    var imaging = db.ImagingStudies.AsNoTracking().Where(s => !s.Acknowledged).AsEnumerable().Select(s =>
        new InboxItemDto("imaging", s.StudyId, s.PatientId, s.BedId, s.PatientName,
            $"{s.Description} {(s.Status == "preliminary" ? "prelim" : s.Status)} — {s.BedId} {s.PatientName}",
            s.Note ?? s.Impression ?? "", s.ReportedAt ?? s.OrderedAt, s.Flag));
    return Results.Json(labs.Concat(imaging)
        .OrderByDescending(x => x.Time, StringComparer.Ordinal), JsonOpts.Web);
}).RequireAuthorization();

/* POST /api/icu/results/labs/{labId}/acknowledge — doctor RBAC (results.acknowledge). */
app.MapPost("/api/icu/results/labs/{labId}/acknowledge", (string labId, ClaimsPrincipal user, RosterDb db) =>
{
    if (Rbac.Deny(user, "results.acknowledge") is IResult denied) return denied;
    var d = db.LabDraws.FirstOrDefault(x => x.LabId == labId && !x.Acknowledged);
    if (d is null) return Results.Json(new { error = "Not found" }, JsonOpts.Web, statusCode: 404);
    d.Acknowledged = true;
    d.AcknowledgedBy = user.FindFirst("name")?.Value ?? "Unknown";
    d.AcknowledgedAt = DateTime.UtcNow.ToString("HH:mm");
    db.SaveChanges();
    return Results.Json(d.ToDto(), JsonOpts.Web);
}).RequireAuthorization();

/* POST /api/icu/results/imaging/{studyId}/acknowledge — doctor RBAC. */
app.MapPost("/api/icu/results/imaging/{studyId}/acknowledge", (string studyId, ClaimsPrincipal user, RosterDb db) =>
{
    if (Rbac.Deny(user, "results.acknowledge") is IResult denied) return denied;
    var s = db.ImagingStudies.FirstOrDefault(x => x.StudyId == studyId && !x.Acknowledged);
    if (s is null) return Results.Json(new { error = "Not found" }, JsonOpts.Web, statusCode: 404);
    s.Acknowledged = true;
    s.AcknowledgedBy = user.FindFirst("name")?.Value ?? "Unknown";
    s.AcknowledgedAt = DateTime.UtcNow.ToString("HH:mm");
    db.SaveChanges();
    return Results.Json(s.ToDto(), JsonOpts.Web);
}).RequireAuthorization();

app.Run();

static class JsonOpts
{
    /* WhenWritingNull keeps optional fields ABSENT on the wire (not null) —
       exactly how the mock adapter's objects serialize */
    public static readonly JsonSerializerOptions Web = new(JsonSerializerDefaults.Web)
    {
        DefaultIgnoreCondition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull,
    };
}

/* ---------- three-layer RBAC, server side (Stage 10 Phase 3) ----------
   Mirrors src/lib/session.ts: JobTitle → PermissionProfile → Permissions,
   ALWAYS computed at read time from the token's jobTitle claim — profiles
   and permissions are never stored, never carried in the token. */
static class Rbac
{
    static readonly Dictionary<string, string> TitleProfile = new()
    {
        ["Consultant"] = "Doctor", ["Specialist"] = "Doctor", ["Senior Resident"] = "Doctor",
        ["Resident"] = "Doctor", ["Intern"] = "Doctor",
        ["Pharmacist"] = "Pharmacist", ["Clinical Pharmacist"] = "Pharmacist",
        ["Staff Nurse"] = "Nurse", ["Charge Nurse"] = "Nurse", ["Head Nurse"] = "Nurse",
        ["Laboratory Technician"] = "Ancillary", ["Radiology Technician"] = "Ancillary",
        ["Respiratory Therapist"] = "RespiratoryTherapist",
        ["Physiotherapist"] = "AlliedHealth", ["Dietitian"] = "AlliedHealth",
        ["Receptionist"] = "Administrator", ["Billing Officer"] = "Administrator",
        ["Medical Records Officer"] = "Administrator", ["Hospital Administrator"] = "Administrator",
        ["IT Administrator"] = "Administrator",
    };

    static readonly Dictionary<string, string[]> ProfilePermissions = new()
    {
        ["Doctor"] = ["patients.view", "orders.view", "orders.create", "orders.sign",
            "orders.modify", "orders.discontinue", "results.view", "results.acknowledge",
            "notes.document", "ai.view"],
        ["Nurse"] = ["patients.view", "orders.view", "orders.implement", "meds.administer",
            "notes.document", "results.view", "ai.view"],
        ["Administrator"] = ["admin.view", "patients.view"],
        ["Pharmacist"] = ["patients.view", "orders.view", "results.view"],
        ["RespiratoryTherapist"] = ["patients.view", "orders.view", "results.view", "ai.view"],
        ["Ancillary"] = ["patients.view", "orders.view", "results.view"],
        ["AlliedHealth"] = ["patients.view", "results.view"],
    };

    public static bool Has(ClaimsPrincipal user, string permission) =>
        TitleProfile.TryGetValue(user.FindFirst("jobTitle")?.Value ?? "", out var profile)
        && ProfilePermissions[profile].Contains(permission);

    /** null when permitted; a generic 403 otherwise (never explains which
        permission was missing) */
    public static IResult? Deny(ClaimsPrincipal user, string permission) =>
        Has(user, permission) ? null
        : Results.Json(new { error = "Insufficient permissions" }, JsonOpts.Web, statusCode: 403);
}

/* ---------- persistence ---------- */

class RosterDb(DbContextOptions<RosterDb> options) : DbContext(options)
{
    public DbSet<PatientRow> Patients => Set<PatientRow>();
    public DbSet<UserRow> Users => Set<UserRow>();
    public DbSet<LabDrawRow> LabDraws => Set<LabDrawRow>();
    public DbSet<ImagingStudyRow> ImagingStudies => Set<ImagingStudyRow>();
    public DbSet<OrderRow> Orders => Set<OrderRow>();
}

/* One row per staff account (Stage 10 Phase 2). Only the bcrypt hash is
   stored — never a plaintext password. PermissionProfile/permissions are
   deliberately NOT columns: they are derived from JobTitle at read time
   (locked RBAC rule), on the client today and server-side from Phase 3. */
class UserRow
{
    [Key]
    public string Username { get; set; } = "";
    public string Name { get; set; } = "";
    public string JobTitle { get; set; } = "";
    public string PasswordHash { get; set; } = "";
}

record UserSeedDto(string Username, string Name, string JobTitle);

record LoginRequest(string? Username, string? Password);

/* ---------- Laboratory & Imaging results (Stage 10 Phase 3) ----------
   One row per lab draw / imaging study. Scalar fields are real columns;
   the per-draw result items array is a JSON text column (same pattern as
   the roster's nested value objects — portable to SQL Server later).
   Data/labs-seed.json and Data/imaging-seed.json are GENERATED from
   src/lib/api/data/results.ts — never hand-edit them. */

class LabDrawRow
{
    [Key]
    public string LabId { get; set; } = "";
    public string PatientId { get; set; } = "";
    public string BedId { get; set; } = "";
    public string PatientName { get; set; } = "";
    public string Panel { get; set; } = "";
    public string Label { get; set; } = "";
    public string CollectedAt { get; set; } = "";
    public string ResultedAt { get; set; } = "";
    public string ItemsJson { get; set; } = "[]";
    public string Flag { get; set; } = "";
    public string? Note { get; set; }
    public bool Acknowledged { get; set; }
    public string? AcknowledgedBy { get; set; }
    public string? AcknowledgedAt { get; set; }

    public static LabDrawRow FromDto(LabDrawDto d) => new()
    {
        LabId = d.LabId, PatientId = d.PatientId, BedId = d.BedId, PatientName = d.PatientName,
        Panel = d.Panel, Label = d.Label, CollectedAt = d.CollectedAt, ResultedAt = d.ResultedAt,
        ItemsJson = JsonSerializer.Serialize(d.Items, JsonOpts.Web),
        Flag = d.Flag, Note = d.Note, Acknowledged = d.Acknowledged,
        AcknowledgedBy = d.AcknowledgedBy, AcknowledgedAt = d.AcknowledgedAt,
    };

    public LabDrawDto ToDto() => new(
        LabId, PatientId, BedId, PatientName, Panel, Label, CollectedAt, ResultedAt,
        JsonSerializer.Deserialize<JsonElement>(ItemsJson, JsonOpts.Web),
        Flag, Note, Acknowledged, AcknowledgedBy, AcknowledgedAt);
}

class ImagingStudyRow
{
    [Key]
    public string StudyId { get; set; } = "";
    public string PatientId { get; set; } = "";
    public string BedId { get; set; } = "";
    public string PatientName { get; set; } = "";
    public string Modality { get; set; } = "";
    public string Description { get; set; } = "";
    public string OrderedAt { get; set; } = "";
    public string? PerformedAt { get; set; }
    public string? ReportedAt { get; set; }
    public string Status { get; set; } = "";
    public string? Report { get; set; }
    public string? Impression { get; set; }
    public string Flag { get; set; } = "";
    public string? Note { get; set; }
    public bool Acknowledged { get; set; }
    public string? AcknowledgedBy { get; set; }
    public string? AcknowledgedAt { get; set; }

    public static ImagingStudyRow FromDto(ImagingStudyDto d) => new()
    {
        StudyId = d.StudyId, PatientId = d.PatientId, BedId = d.BedId, PatientName = d.PatientName,
        Modality = d.Modality, Description = d.Description, OrderedAt = d.OrderedAt,
        PerformedAt = d.PerformedAt, ReportedAt = d.ReportedAt, Status = d.Status,
        Report = d.Report, Impression = d.Impression, Flag = d.Flag, Note = d.Note,
        Acknowledged = d.Acknowledged, AcknowledgedBy = d.AcknowledgedBy, AcknowledgedAt = d.AcknowledgedAt,
    };

    public ImagingStudyDto ToDto() => new(
        StudyId, PatientId, BedId, PatientName, Modality, Description, OrderedAt,
        PerformedAt, ReportedAt, Status, Report, Impression, Flag, Note,
        Acknowledged, AcknowledgedBy, AcknowledgedAt);
}

/* wire contracts — mirror LabDraw / ImagingStudy / ResultInboxItem in
   src/lib/api/types.ts (camelCase over the wire; optional fields absent,
   not null — see JsonOpts). Items pass through as-is (JsonElement). */
record LabDrawDto(
    string LabId, string PatientId, string BedId, string PatientName, string Panel,
    string Label, string CollectedAt, string ResultedAt, JsonElement Items, string Flag,
    string? Note, bool Acknowledged, string? AcknowledgedBy, string? AcknowledgedAt);

record ImagingStudyDto(
    string StudyId, string PatientId, string BedId, string PatientName, string Modality,
    string Description, string OrderedAt, string? PerformedAt, string? ReportedAt,
    string Status, string? Report, string? Impression, string Flag, string? Note,
    bool Acknowledged, string? AcknowledgedBy, string? AcknowledgedAt);

/* parse shape for deriving the inbox headline from ItemsJson */
record LabItemDto(string Analyte, double Value, string Unit, string Flag);

record InboxItemDto(
    string Kind, string Id, string PatientId, string BedId, string PatientName,
    string Title, string Detail, string Time, string Flag);

/* ---------- Orders & Medication (Stage 10 Phase 3, Orders PR) ----------
   One row per order; medication/administrations/history are JSON columns
   the lifecycle mutations rewrite. Seq preserves insertion order (seed
   order, then append — same as the mock store). Data/orders-seed.json is
   GENERATED from src/lib/api/data/orders.ts — never hand-edit it. */

class OrderRow
{
    [Key]
    public string OrderId { get; set; } = "";
    public int Seq { get; set; }
    public string PatientId { get; set; } = "";
    public string BedId { get; set; } = "";
    public string PatientName { get; set; } = "";
    public string Category { get; set; } = "";
    public string Summary { get; set; } = "";
    public string? MedicationJson { get; set; }
    public string Priority { get; set; } = "";
    public string Status { get; set; } = "";
    public string OrderedBy { get; set; } = "";
    public string OrderedTime { get; set; } = "";
    public bool? RequiresImplementation { get; set; }
    public string? AdministrationsJson { get; set; }
    public string HistoryJson { get; set; } = "[]";
    public string? StatusReason { get; set; }

    public static OrderRow FromDto(OrderDto d, int seq) => new()
    {
        OrderId = d.OrderId, Seq = seq, PatientId = d.PatientId, BedId = d.BedId,
        PatientName = d.PatientName, Category = d.Category, Summary = d.Summary,
        MedicationJson = d.Medication is null ? null : JsonSerializer.Serialize(d.Medication, JsonOpts.Web),
        Priority = d.Priority, Status = d.Status, OrderedBy = d.OrderedBy, OrderedTime = d.OrderedTime,
        RequiresImplementation = d.RequiresImplementation,
        AdministrationsJson = d.Administrations is null ? null : JsonSerializer.Serialize(d.Administrations, JsonOpts.Web),
        HistoryJson = JsonSerializer.Serialize(d.History, JsonOpts.Web),
        StatusReason = d.StatusReason,
    };

    public OrderDto ToDto() => new(
        OrderId, PatientId, BedId, PatientName, Category, Summary,
        MedicationJson is null ? null : JsonSerializer.Deserialize<MedicationDto>(MedicationJson, JsonOpts.Web),
        Priority, Status, OrderedBy, OrderedTime, RequiresImplementation,
        AdministrationsJson is null ? null : JsonSerializer.Deserialize<List<AdminDto>>(AdministrationsJson, JsonOpts.Web),
        JsonSerializer.Deserialize<List<OrderEventDto>>(HistoryJson, JsonOpts.Web)!,
        StatusReason);
}

/* wire contracts — mirror Order / MedicationDetails / MedAdministration /
   OrderEvent / NewOrderDraft in src/lib/api/types.ts */
record OrderDto(
    string OrderId, string PatientId, string BedId, string PatientName, string Category,
    string Summary, MedicationDto? Medication, string Priority, string Status,
    string OrderedBy, string OrderedTime, bool? RequiresImplementation,
    List<AdminDto>? Administrations, List<OrderEventDto> History, string? StatusReason);

/* nested in create requests as well as responses/seeds — Disallow makes a
   typo'd medication field (e.g. "dosage") a 400 at binding time; the seed
   files carry exactly these fields (byte-parity verified) so boot-time
   deserialization is unaffected */
[System.Text.Json.Serialization.JsonUnmappedMemberHandling(System.Text.Json.Serialization.JsonUnmappedMemberHandling.Disallow)]
record MedicationDto(
    string DrugId, string Drug, string Dose, string Route, string Frequency,
    string Duration, bool Prn, string? PrnIndication);

record AdminDto(string AdminId, string ScheduledTime, string Status,
    string? DocumentedTime, string? DocumentedBy, string? Reason = null);

/* MAR row — mirrors MarRow in src/lib/api/types.ts; derived at read time
   from the orders' administrations, never stored. */
record MarRowDto(
    string OrderId, string AdminId, string PatientId, string BedId, string Medication,
    string Dose, string Route, string ScheduledTime, bool Prn, string Status,
    string? DocumentedTime);

record OrderEventDto(string Time, string Actor, string Action, string? Detail);

/* MAR administration action request (Stage 10 Phase 3) — Disallow rejects
   any unrecognized field; action/reason validated explicitly in the
   endpoint (reason required for held/refused, like discontinue). */
[System.Text.Json.Serialization.JsonUnmappedMemberHandling(System.Text.Json.Serialization.JsonUnmappedMemberHandling.Disallow)]
record AdministerRequest(string? Action, string? Reason);

/* REQUEST DTOs — unlike the response/seed DTOs above, these carry
   [JsonUnmappedMemberHandling(Disallow)]: an unrecognized field in a
   mutation payload fails JSON binding, which minimal APIs surface as an
   automatic 400 — a typo'd contract can never silently no-op. Fields
   arrive nullable and are validated explicitly (OrderLogic.ValidateDraft)
   so a missing field is a 400, never a null-crash or a silent default. */

[System.Text.Json.Serialization.JsonUnmappedMemberHandling(System.Text.Json.Serialization.JsonUnmappedMemberHandling.Disallow)]
record NewOrderDraftDto(
    string? PatientId, string? Category, string? Summary, MedicationDto? Medication,
    string? Priority, bool? RequiresImplementation);

[System.Text.Json.Serialization.JsonUnmappedMemberHandling(System.Text.Json.Serialization.JsonUnmappedMemberHandling.Disallow)]
record CreateOrdersRequest(List<NewOrderDraftDto>? Drafts, bool Sign, string? Note);

/* partial medication update — only provided fields are applied */
[System.Text.Json.Serialization.JsonUnmappedMemberHandling(System.Text.Json.Serialization.JsonUnmappedMemberHandling.Disallow)]
record MedicationChanges(
    string? DrugId, string? Drug, string? Dose, string? Route, string? Frequency,
    string? Duration, bool? Prn, string? PrnIndication)
{
    public bool HasAnyField =>
        DrugId is not null || Drug is not null || Dose is not null || Route is not null
        || Frequency is not null || Duration is not null || Prn is not null || PrnIndication is not null;
}

[System.Text.Json.Serialization.JsonUnmappedMemberHandling(System.Text.Json.Serialization.JsonUnmappedMemberHandling.Disallow)]
record ModifyOrderRequest(MedicationChanges? Changes, string? Reason);

[System.Text.Json.Serialization.JsonUnmappedMemberHandling(System.Text.Json.Serialization.JsonUnmappedMemberHandling.Disallow)]
record DiscontinueRequest(string? Reason);

/* ports of the mock store's helpers (src/lib/api/data/orders.ts) so the
   wire behavior matches the adapter contract exactly */
static class OrderLogic
{
    static int _orderSeq = 100;  // new orders: ORD-101… (seeded ones are ORD-2001…)
    static int _adminSeq = 500;  // new administrations: ADM-501…
    static int _rowSeq = 1000;   // insertion order for new rows (seeds are 1…n)

    static readonly string[] Categories = ["Medication", "Lab", "Imaging", "Nursing"];
    static readonly string[] Priorities = ["Routine", "Urgent", "STAT"];

    /* Frequency is the one medication field the server INTERPRETS (it
       drives administration-schedule generation), so unlike the
       display-only free-text fields (dose/route/duration — Layer 4
       formulary scope) it must parse: either a named frequency from the
       vocabulary the formulary/order sets/seeds actually use, or qNh with
       a physically sane interval. Anything else is a 400, never saved. */
    static readonly string[] NamedFrequencies =
        ["continuous", "daily", "bid", "tid", "qid", "once",
         "sliding scale", "per level", "per CRRT protocol"];

    public static bool IsValidFrequency(string f) =>
        NamedFrequencies.Contains(f)
        || (System.Text.RegularExpressions.Regex.Match(f, @"^q(\d{1,2})h$") is { Success: true } m
            && int.TryParse(m.Groups[1].Value, out var h) && h is >= 1 and <= 48);

    public const string FrequencyRule =
        "must be one of: continuous, daily, bid, tid, qid, once, sliding scale, per level, per CRRT protocol, or q<1-48>h";

    /* upper bound on any free-text request field — Kestrel's ~28 MB body
       limit is the only bound otherwise, and multi-megabyte strings would
       be persisted and re-served to every client */
    public const int MaxTextLength = 2000;

    public static IResult BadRequest(string error) =>
        Results.Json(new { error }, JsonOpts.Web, statusCode: 400);

    /** MAR rows for one order, DERIVED exactly as the mock deriveMarRows:
        a scheduled administration only appears while the order is active;
        documented ones stay for the shift record. */
    public static IEnumerable<MarRowDto> MarRowsFor(OrderRow o)
    {
        var m = JsonSerializer.Deserialize<MedicationDto>(o.MedicationJson!, JsonOpts.Web)!;
        var admins = JsonSerializer.Deserialize<List<AdminDto>>(o.AdministrationsJson!, JsonOpts.Web)!;
        var route = $"{m.Route} · {(m.Prn ? $"PRN — {m.PrnIndication ?? "as required"}" : m.Frequency)}";
        foreach (var a in admins)
        {
            if (o.Status != "active" && a.Status == "scheduled") continue;
            yield return new MarRowDto(o.OrderId, a.AdminId, o.PatientId, o.BedId, m.Drug,
                m.Dose, route, a.ScheduledTime, m.Prn, a.Status, a.DocumentedTime);
        }
    }

    /** shared text-field rule: required fields must be non-whitespace;
        optional fields may be absent but never blank; everything bounded */
    static string? CheckText(string name, string? value, bool required)
    {
        if (value is null) return required ? $"{name} is required" : null;
        if (string.IsNullOrWhiteSpace(value))
            return required ? $"{name} is required" : $"{name} must be non-empty when provided";
        if (value.Length > MaxTextLength) return $"{name} exceeds {MaxTextLength} characters";
        return null;
    }

    /** null when the draft is valid; otherwise the validation error to 400.
        Runs BEFORE any insert so an invalid batch creates zero orders. */
    public static string? ValidateDraft(NewOrderDraftDto? d, int index, RosterDb db)
    {
        var at = $"drafts[{index}]";
        if (d is null) return $"{at} is null";
        if (CheckText($"{at}.patientId", d.PatientId, required: true) is string p) return p;
        if (!db.Patients.AsNoTracking().Any(x => x.PatientId == d.PatientId))
            return $"{at}.patientId '{d.PatientId}' does not match any roster patient";
        if (d.Category is null || !Categories.Contains(d.Category))
            return $"{at}.category must be one of: {string.Join(", ", Categories)}";
        if (d.Priority is null || !Priorities.Contains(d.Priority))
            return $"{at}.priority must be one of: {string.Join(", ", Priorities)}";
        if (d.Medication is null && string.IsNullOrWhiteSpace(d.Summary))
            return $"{at} requires a summary (non-medication order) or a medication object";
        /* a provided-but-blank summary must never override the composed
           medication summary or create a contentless order */
        if (CheckText($"{at}.summary", d.Summary, required: false) is string s) return s;
        if (d.Medication is not null)
        {
            /* med orders are administered via the MAR schedule — the one-shot
               nursing implement action doesn't apply to them */
            if (d.RequiresImplementation == true)
                return $"{at}: a medication order cannot set requiresImplementation";
            var m = d.Medication;
            foreach (var (name, value, required) in new[] {
                ("drugId", m.DrugId, true), ("drug", m.Drug, true), ("dose", m.Dose, true),
                ("route", m.Route, true), ("frequency", m.Frequency, true),
                ("duration", m.Duration, true), ("prnIndication", m.PrnIndication, false) })
            {
                if (CheckText($"{at}.medication.{name}", value, required) is string e) return e;
            }
            if (!IsValidFrequency(m.Frequency))
                return $"{at}.medication.frequency '{m.Frequency}' is not a valid frequency — {FrequencyRule}";
        }
        return null;
    }

    /** validates a modify payload's provided fields — a change may omit
        fields but can never blank one or exceed the text bound */
    public static string? ValidateChanges(MedicationChanges c)
    {
        foreach (var (name, value) in new[] {
            ("drugId", c.DrugId), ("drug", c.Drug), ("dose", c.Dose), ("route", c.Route),
            ("frequency", c.Frequency), ("duration", c.Duration), ("prnIndication", c.PrnIndication) })
        {
            if (value is null) continue;
            if (string.IsNullOrWhiteSpace(value)) return $"changes.{name} must be a non-empty string";
            if (value.Length > MaxTextLength) return $"changes.{name} exceeds {MaxTextLength} characters";
        }
        if (c.Frequency is not null && !IsValidFrequency(c.Frequency))
            return $"changes.frequency '{c.Frequency}' is not a valid frequency — {FrequencyRule}";
        return null;
    }

    public static string NextOrderId() => $"ORD-{Interlocked.Increment(ref _orderSeq)}";
    public static string NextAdminId() => $"ADM-{Interlocked.Increment(ref _adminSeq)}";
    public static int NextSeq() => Interlocked.Increment(ref _rowSeq);

    public static string MedSummary(MedicationDto m) =>
        $"{m.Drug} {m.Dose} · {m.Route} · {(m.Prn ? $"PRN ({m.PrnIndication ?? "as required"})" : m.Frequency)}";

    /* mock schedule generation for newly signed med orders: next full hour,
       plus one interval for q\dh frequencies; PRN gets one availability row.
       Frequency is free text (mock parity) — the interval is bounds-checked
       with TryParse so no payload can crash schedule generation (a q0h /
       q99999999h string simply yields a single first dose). */
    public static List<AdminDto> GenerateAdministrations(MedicationDto m)
    {
        if (m.Prn) return [new AdminDto(NextAdminId(), "", "scheduled", null, null)];
        var now = DateTime.UtcNow;
        var first = new DateTime(now.Year, now.Month, now.Day, now.Hour, 0, 0, DateTimeKind.Utc).AddHours(1);
        var times = new List<DateTime> { first };
        var interval = System.Text.RegularExpressions.Regex.Match(m.Frequency, @"q(\d+)h");
        if (interval.Success && int.TryParse(interval.Groups[1].Value, out var hours) && hours is >= 1 and <= 168)
            times.Add(first.AddHours(hours));
        return times.Select(t => new AdminDto(NextAdminId(), t.ToString("HH:mm"), "scheduled", null, null)).ToList();
    }

    public static string AppendHistory(string historyJson, OrderEventDto evt)
    {
        var history = JsonSerializer.Deserialize<List<OrderEventDto>>(historyJson, JsonOpts.Web)!;
        history.Add(evt);
        return JsonSerializer.Serialize(history, JsonOpts.Web);
    }

    /* merge non-null change fields; diff string matches the mock's
       ("field: old → new" with lowercase booleans, comma-joined) */
    public static (MedicationDto merged, string diff) ApplyChanges(MedicationDto before, MedicationChanges c)
    {
        var merged = new MedicationDto(
            c.DrugId ?? before.DrugId, c.Drug ?? before.Drug, c.Dose ?? before.Dose,
            c.Route ?? before.Route, c.Frequency ?? before.Frequency, c.Duration ?? before.Duration,
            c.Prn ?? before.Prn, c.PrnIndication ?? before.PrnIndication);
        var parts = new List<string>();
        void Diff(string name, string? oldV, string? newV)
        {
            if (newV is not null && newV != oldV) parts.Add($"{name}: {oldV} → {newV}");
        }
        Diff("drugId", before.DrugId, c.DrugId);
        Diff("drug", before.Drug, c.Drug);
        Diff("dose", before.Dose, c.Dose);
        Diff("route", before.Route, c.Route);
        Diff("frequency", before.Frequency, c.Frequency);
        Diff("duration", before.Duration, c.Duration);
        Diff("prn", before.Prn ? "true" : "false", c.Prn is null ? null : (c.Prn.Value ? "true" : "false"));
        Diff("prnIndication", before.PrnIndication, c.PrnIndication);
        return (merged, string.Join(", ", parts));
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

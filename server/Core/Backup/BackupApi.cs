using System.Security.Claims;
using Aurora.Core.Identity;
using Aurora.Core.Persistence;
using Aurora.Core.Shared;
using Microsoft.EntityFrameworkCore;

namespace Aurora.Core.Backup;

/* The Backup & Recovery area's API (BACKUP_DR_DESIGN.md §6) —
   System-Administrator-gated end to end: every endpoint requires
   backup.manage, which lives on the SystemAdministrator profile ONLY
   (design §1: IT ops, never clinical — clinical roles get the generic
   403). Reads answer the dashboard/history/audit views; writes drive the
   same engine the nightly CLI uses, with the authenticated USERNAME as
   the audit actor ("who restored, when" — design §5).

   There is deliberately NO delete/update surface for events (append-only
   audit) and NO endpoint that returns the key: rotate-key's response
   carries the new key EXACTLY ONCE (design §4) and nothing can read it
   back afterwards. */
static class BackupApi
{
    static string Actor(ClaimsPrincipal user) => user.FindFirst("sub")?.Value ?? "?";

    public static void Map(WebApplication app)
    {
        /* GET /api/backup/status — the dashboard: health (with the LOUD
           24h-RPO message), last/next run, retention held vs kept,
           external-disk status (honest, from the audit trail), key id. */
        app.MapGet("/api/backup/status", (ClaimsPrincipal user) =>
        {
            if (Rbac.Deny(user, "backup.manage") is IResult denied) return denied;
            return Results.Json(BackupService.Status(), JsonOpts.Web);
        }).RequireAuthorization();

        /* GET /api/backup/history — every backup currently held: manifest
           facts + the newest verify/test-restore recorded against it. */
        app.MapGet("/api/backup/history", (ClaimsPrincipal user, AuroraDb db) =>
        {
            if (Rbac.Deny(user, "backup.manage") is IResult denied) return denied;
            List<BackupEventRow> verifies;
            try
            {
                var kinds = new[] { "verify", "test-restore" };
                verifies = db.Set<BackupEventRow>().AsNoTracking()
                    .Where(e => kinds.Contains(e.Kind)).ToList();
            }
            catch { verifies = []; }
            var rows = BackupService.AllManifests().Select(m =>
            {
                var last = verifies.Where(e => e.File == m.File)
                    .OrderByDescending(e => e.Id).FirstOrDefault();
                return new BackupHistoryRow(m.File, m.CreatedAtUtc, m.EncryptedSizeBytes,
                    m.KeyId, m.TimeZone, m.TableCounts.Count, m.TableCounts.Values.Sum(),
                    last?.At, last == null ? null : $"{last.Kind}:{last.Outcome}");
            });
            return Results.Json(rows, JsonOpts.Web);
        }).RequireAuthorization();

        /* GET /api/backup/events?limit=N — the immutable audit trail,
           newest first (read-only; there is no way to change it). */
        app.MapGet("/api/backup/events", (HttpContext ctx, ClaimsPrincipal user, AuroraDb db) =>
        {
            if (Rbac.Deny(user, "backup.manage") is IResult denied) return denied;
            var limit = int.TryParse(ctx.Request.Query["limit"], out var n)
                ? Math.Clamp(n, 1, 500) : 200;
            List<BackupEventDto> events;
            try
            {
                events = db.Set<BackupEventRow>().AsNoTracking()
                    .OrderByDescending(e => e.Id).Take(limit).AsEnumerable()
                    .Select(e => new BackupEventDto(e.Id, e.At, e.Kind, e.Outcome,
                        e.Actor, e.File, e.DetailJson)).ToList();
            }
            catch { events = []; }
            return Results.Json(events, JsonOpts.Web);
        }).RequireAuthorization();

        /* POST /api/backup/run — an on-demand backup (the nightly task uses
           the CLI; this is the "backup now" button). Synchronous: the
           response IS the born-restore-verified manifest. */
        app.MapPost("/api/backup/run", (ClaimsPrincipal user) =>
        {
            if (Rbac.Deny(user, "backup.manage") is IResult denied) return denied;
            try { return Results.Json(BackupService.RunBackup(Actor(user)), JsonOpts.Web); }
            catch (Exception ex) { return ApiError.StateConflict(ex.Message); }
        }).RequireAuthorization();

        /* POST /api/backup/verify {file, key?} — integrity WITHOUT a
           restore. Supplying a key proves a RECORDED off-server copy
           decrypts (the envelope drill); omitting it uses the server key. */
        app.MapPost("/api/backup/verify", (VerifyRequest req, ClaimsPrincipal user) =>
        {
            if (Rbac.Deny(user, "backup.manage") is IResult denied) return denied;
            if (string.IsNullOrWhiteSpace(req.File)) return ApiError.BadRequest("file is required");
            return Results.Json(BackupService.Verify(req.File.Trim(),
                string.IsNullOrWhiteSpace(req.Key) ? null : req.Key.Trim(), Actor(user)), JsonOpts.Web);
        }).RequireAuthorization();

        /* POST /api/backup/test-restore {file} — full reconstruction into
           an ISOLATED scratch database with source-vs-restored counts +
           digests; live data untouched (design §6). */
        app.MapPost("/api/backup/test-restore", (TestRestoreRequest req, ClaimsPrincipal user) =>
        {
            if (Rbac.Deny(user, "backup.manage") is IResult denied) return denied;
            if (string.IsNullOrWhiteSpace(req.File)) return ApiError.BadRequest("file is required");
            try { return Results.Json(BackupService.TestRestore(req.File.Trim(), Actor(user)), JsonOpts.Web); }
            catch (Exception ex) { return ApiError.StateConflict(ex.Message); }
        }).RequireAuthorization();

        /* POST /api/backup/rotate-key — the response carries the new key
           EXACTLY ONCE for the operator's envelope ceremony; no endpoint
           can ever read it back. */
        app.MapPost("/api/backup/rotate-key", (ClaimsPrincipal user) =>
        {
            if (Rbac.Deny(user, "backup.manage") is IResult denied) return denied;
            try { return Results.Json(BackupService.RotateKey(Actor(user)), JsonOpts.Web); }
            catch (Exception ex) { return ApiError.StateConflict(ex.Message); }
        }).RequireAuthorization();
    }
}

using System.Text.Json;
using Aurora.Core.Orders;
using Aurora.Core.Persistence;
using Aurora.Core.LabImaging;
using Aurora.Core.Shared;
using Microsoft.EntityFrameworkCore;

namespace Aurora.Core.Timeline;

/* ---------------- Timeline (Stage 10 Phase 3) ----------------
   A read-only AGGREGATION with NO table of its own — the architectural
   rule holds server-side too. Events are DERIVED at read time from the
   real domains this service can reach: Order audit history (create/sign/
   modify/discontinue/implement) AND MAR administrations (which already
   live on the order history), plus Lab draws and Imaging studies incl.
   acknowledgments. No parallel copy of any of them.

   FOUR sources stay mock this phase — Consults, ClinicalNotes, Nursing
   task completions, and I&O entries — so this endpoint returns ONLY the
   four server-derived categories {order, med, lab, imaging}. The frontend
   adapter is a HYBRID: it merges these with the four still-mock categories
   {task, io, consult, note} client-side. The category split IS the seam;
   when those domains migrate they move here and drop out of the client
   merge WITHOUT rewriting the aggregator. Read-only for every role (no
   mutations, no new RBAC surface) — auth required, both roles read. */
static class TimelineApi
{
    public static void Map(WebApplication app)
    {
        app.MapGet("/api/icu/timeline", (HttpContext ctx, AuroraDb db) =>
        {
            /* codified validation rule: unknown query params are a malformed
               request, not silently ignored */
            foreach (var key in ctx.Request.Query.Keys)
                if (key != "patientId") return ApiError.BadRequest($"unknown query parameter '{key}'");
            var patientId = ctx.Request.Query["patientId"].ToString();
            if (string.IsNullOrWhiteSpace(patientId)) return ApiError.BadRequest("patientId is required");
            if (!db.Patients.AsNoTracking().Any(p => p.PatientId == patientId))
                return ApiError.BadRequest($"patientId '{patientId}' does not match any roster patient");
            return Results.Json(TimelineLogic.Derive(patientId, db), JsonOpts.Web);
        }).RequireAuthorization();
    }
}

/* ---------- Timeline derivation (Stage 10 Phase 3) ----------
   Ports the mock deriveTimeline (src/lib/api/data/timeline.ts) for the four
   server-reachable categories only — order/med events (incl. MAR admin
   history), lab draw events, imaging study events. Sorted newest-first by
   the same day/HH:MM key the mock uses, so the frontend's re-sort of the
   merged (server + still-mock) feed is byte-identical to the mock feed. */
static class TimelineLogic
{
    static readonly Dictionary<string, string> ActionTitle = new()
    {
        ["created"] = "Order placed", ["signed"] = "Order signed",
        ["modified"] = "Order modified", ["implemented"] = "Order implemented",
        ["administered"] = "Dose given", ["held"] = "Dose held", ["refused"] = "Dose refused",
        ["completed"] = "Order completed", ["discontinued"] = "Order discontinued",
    };

    static string Fmt(double v) => v == Math.Floor(v) ? ((long)v).ToString() : v.ToString("0.0");

    static string AbnormalSummary(List<LabItemFull> items)
    {
        var flagged = items.Where(i => i.Flag != "normal").ToList();
        if (flagged.Count == 0) return "All values within reference range";
        return string.Join(" · ", flagged.Select(i => $"{i.Analyte} {Fmt(i.Value)}{(string.IsNullOrEmpty(i.Unit) ? "" : $" {i.Unit}")}"));
    }

    /* sort key: minutes relative to today 00:00 ("D-n HH:MM" → negative days) */
    static int TimestampMinutes(string t)
    {
        var m = System.Text.RegularExpressions.Regex.Match(t, @"^D-(\d+)");
        var dayOffset = m.Success ? -int.Parse(m.Groups[1].Value) : 0;
        var hm = t.Split(' ')[^1].Split(':');
        var mins = hm.Length == 2 && int.TryParse(hm[0], out var h) && int.TryParse(hm[1], out var mn) ? h * 60 + mn : 0;
        return dayOffset * 1440 + mins;
    }

    public static IEnumerable<TimelineEventDto> Derive(string patientId, AuroraDb db)
    {
        var events = new List<TimelineEventDto>();

        /* order + med events — the full audit history, incl. MAR administrations */
        foreach (var row in db.Orders.AsNoTracking().Where(o => o.PatientId == patientId).OrderBy(o => o.Seq).AsEnumerable())
        {
            var cat = row.Category == "Medication" ? "med" : "order";
            var history = JsonSerializer.Deserialize<List<OrderEventDto>>(row.HistoryJson, JsonOpts.Web)!;
            for (var i = 0; i < history.Count; i++)
            {
                var ev = history[i];
                events.Add(new TimelineEventDto(
                    $"{row.OrderId}-h{i}", patientId, ev.Time, cat, cat.ToUpperInvariant(),
                    $"{(ActionTitle.TryGetValue(ev.Action, out var t) ? t : ev.Action)} — {row.Summary}",
                    ev.Detail, ev.Actor, null, $"/orders/{patientId}", row.OrderId));
            }
        }

        /* lab draw events — resulted + acknowledged */
        foreach (var d in db.LabDraws.AsNoTracking().Where(x => x.PatientId == patientId).OrderBy(x => x.LabId).AsEnumerable())
        {
            var items = JsonSerializer.Deserialize<List<LabItemFull>>(d.ItemsJson, JsonOpts.Web)!;
            var summary = AbnormalSummary(items);
            events.Add(new TimelineEventDto(
                $"{d.LabId}-res", patientId, d.ResultedAt, "lab", "LAB",
                $"{d.Panel} panel resulted",
                d.Note is not null ? $"{summary} — {d.Note}" : summary,
                null, d.Flag, $"/labs/{patientId}", d.LabId));
            if (d.Acknowledged && d.AcknowledgedAt is not null && d.AcknowledgedBy is not null)
                events.Add(new TimelineEventDto(
                    $"{d.LabId}-ack", patientId, d.AcknowledgedAt, "lab", "LAB",
                    $"{d.Panel} results acknowledged", null, d.AcknowledgedBy, null,
                    $"/labs/{patientId}", d.LabId));
        }

        /* imaging study events — ordered / performed / reported / acknowledged */
        foreach (var s in db.ImagingStudies.AsNoTracking().Where(x => x.PatientId == patientId).OrderBy(x => x.StudyId).AsEnumerable())
        {
            events.Add(new TimelineEventDto($"{s.StudyId}-ord", patientId, s.OrderedAt, "imaging", "IMAGING",
                $"{s.Description} — ordered", null, null, null, $"/labs/{patientId}", s.StudyId));
            if (s.PerformedAt is not null)
                events.Add(new TimelineEventDto($"{s.StudyId}-perf", patientId, s.PerformedAt, "imaging", "IMAGING",
                    $"{s.Description} — performed", null, null, null, $"/labs/{patientId}", s.StudyId));
            if (s.ReportedAt is not null)
                events.Add(new TimelineEventDto($"{s.StudyId}-rep", patientId, s.ReportedAt, "imaging", "IMAGING",
                    $"{s.Description} — {(s.Status == "final" ? "final report" : "preliminary report")}",
                    s.Impression, null, s.Flag, $"/labs/{patientId}", s.StudyId));
            if (s.Acknowledged && s.AcknowledgedAt is not null && s.AcknowledgedBy is not null)
                events.Add(new TimelineEventDto($"{s.StudyId}-ack", patientId, s.AcknowledgedAt, "imaging", "IMAGING",
                    $"{s.Description} — report acknowledged", null, s.AcknowledgedBy, null, $"/labs/{patientId}", s.StudyId));
        }

        /* newest first — stable sort preserves the order/lab/imaging derivation
           order for equal timestamps, matching the mock's category ordering */
        return events.OrderByDescending(e => TimestampMinutes(e.Time));
    }
}

/* Timeline event — mirrors TimelineEvent in src/lib/api/types.ts; derived
   at read time, never stored. Only the server-reachable categories
   {order, med, lab, imaging} are emitted here. */
record TimelineEventDto(
    string Id, string PatientId, string Time, string Category, string CategoryLabel,
    string Title, string? Detail, string? Actor, string? Flag, string? Link, string RefId);

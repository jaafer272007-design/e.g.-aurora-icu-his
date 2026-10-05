// Deterministic-clock harness over the REAL server sources (compiled in via
// MarHarness.csproj). The READ side is the server's own MarLogic.MarRowsFor;
// the WRITE decision replays MarApi's dated-instance branch step for step
// (membership -> superseded 409 -> duplicate 409 -> render window 404 ->
// delay-reason 400 -> re-timing anchor) using the same MarSchedule helpers,
// with an injected clock. The live endpoint itself is exercised separately
// against the real server + PostgreSQL (api-check).
using System.Text.Json;
using System.Text.Json.Nodes;
using Aurora.Core.Mar;
using Aurora.Core.Orders;
using Aurora.Core.Shared;

static class Harness
{
    static DateTime D(string s) => MarSchedule.ParseDated(s) ?? throw new Exception("bad stamp " + s);

    static string Document(OrderRow row, string adminId, string action, DateTime now, string? administeredAt, string? reason)
    {
        var med = JsonSerializer.Deserialize<MedicationDto>(row.MedicationJson!, JsonOpts.Web)!;
        var admins = row.AdministrationsJson is null ? new List<AdminDto>()
            : JsonSerializer.Deserialize<List<AdminDto>>(row.AdministrationsJson, JsonOpts.Web)!;
        var parsed = MarSchedule.Parse(med);
        string scheduledStamp = ""; DateTime? scheduledInstant = null;
        (List<DateTime> anchors, DateTime? floor)? retiming = null;
        if (adminId == "prn") { if (parsed.Kind != MarSchedule.Kind.Prn) return "400"; }
        else
        {
            var instant = DateTime.SpecifyKind(DateTime.ParseExact(adminId, "yyyy-MM-ddTHH:mm", null), DateTimeKind.Utc);
            if (row.Status != "active") return "409-inactive";
            var first = MarSchedule.FirstDose(MarSchedule.TherapyStart(row, now)!.Value);
            retiming = MarSchedule.RetimingState(admins);
            var onGrid = parsed.Kind == MarSchedule.Kind.Once ? instant == first
                : MarSchedule.OnGrid(instant, first, parsed.IntervalHours, retiming.Value.anchors);
            if (!onGrid)
                return parsed.Kind == MarSchedule.Kind.Interval
                    && MarSchedule.SupersededBy(instant, first, parsed.IntervalHours, retiming.Value.anchors) is DateTime by
                    ? $"409-superseded(by {MarSchedule.StampOf(by)})" : "404";
            scheduledStamp = MarSchedule.StampOf(instant); scheduledInstant = instant;
            if (admins.Any(a => a.Status != "scheduled" && a.ScheduledTime == scheduledStamp)) return "409-duplicate";
            if (parsed.Kind == MarSchedule.Kind.Interval)
            {
                var docStamps = admins.Where(a => a.Status != "scheduled").Select(a => a.ScheduledTime).ToHashSet();
                var (_, _, renderable) = MarSchedule.IntervalInstances(first, parsed.IntervalHours, retiming.Value.anchors, docStamps, now);
                if (!renderable.Contains(instant)) return "404-not-rendered";
            }
        }
        var lateBy = action == "given" && scheduledInstant is not null ? now - scheduledInstant.Value : TimeSpan.Zero;
        if (lateBy > TimeSpan.FromHours(MarSchedule.LateThresholdHours) && string.IsNullOrWhiteSpace(reason)) return "400-reason-required";
        var time = now.ToString("yyyy-MM-dd HH:mm");
        var adminTime = administeredAt ?? time;
        string? anchor = null;
        if (action == "given" && parsed.Kind == MarSchedule.Kind.Interval && scheduledInstant is not null && retiming is not null
            && MarSchedule.ParseDated(adminTime) is DateTime actual && actual > scheduledInstant.Value
            && MarSchedule.Retimes(scheduledInstant.Value, actual, retiming.Value.floor))
            anchor = adminTime;
        admins.Add(new AdminDto("FACT", scheduledStamp, action, adminTime, "Harness Nurse", reason, anchor));
        row.AdministrationsJson = JsonSerializer.Serialize(admins, JsonOpts.Web);
        return anchor is null ? "ok" : $"ok(anchor {anchor})";
    }

    static int Main(string[] args)
    {
        var scenarios = JsonNode.Parse(File.ReadAllText(args[0]))!.AsArray();
        var output = new JsonArray();
        foreach (var sc in scenarios)
        {
            var freq = (string)sc!["frequency"]!;
            var prn = (bool?)sc["prn"] ?? false;
            var med = new MedicationDto("drug-x", "Synthetic Drug", "1 mg", "IV", freq, "ongoing", prn, prn ? "pain" : null);
            var row = new OrderRow
            {
                OrderId = "ORD-T", PatientId = "P-T", EncounterId = "E-T", BedId = "B-T", Category = "Medication",
                Status = "active", MedicationJson = JsonSerializer.Serialize(med, JsonOpts.Web),
                HistoryJson = JsonSerializer.Serialize(new List<OrderEventDto> { new((string)sc["signed"]!, "Dr Synthetic", "signed", null) }, JsonOpts.Web),
            };
            if (sc["legacyFacts"] is JsonArray lf) row.AdministrationsJson = lf.ToJsonString();
            var steps = new JsonArray();
            foreach (var st in sc["steps"]!.AsArray())
            {
                if (st!["read"] is JsonNode r)
                {
                    var now = D((string)r!);
                    var rows = new JsonArray();
                    foreach (var m in MarLogic.MarRowsFor(row, now))
                        rows.Add(new JsonObject
                        {
                            ["adminId"] = m.AdminId.StartsWith("ADM") || m.AdminId == "FACT" ? "FACT" : m.AdminId,
                            ["scheduledTime"] = m.ScheduledTime, ["status"] = m.Status,
                            ["documentedTime"] = m.DocumentedTime, ["missedEarlier"] = m.MissedEarlier,
                            ["scheduleAnchor"] = m.ScheduleAnchor,
                        });
                    steps.Add(new JsonObject { ["read"] = (string)r!, ["rows"] = rows });
                }
                else if (st["modify"] is JsonNode mf)
                {
                    var m = JsonSerializer.Deserialize<MedicationDto>(row.MedicationJson!, JsonOpts.Web)! with { Frequency = (string)mf! };
                    row.MedicationJson = JsonSerializer.Serialize(m, JsonOpts.Web);
                    steps.Add(new JsonObject { ["modify"] = (string)mf! });
                }
                else
                {
                    var res = Document(row, (string)st["doc"]!, (string)st["action"]!, D((string)st["at"]!),
                        (string?)st["administeredAt"], (string?)st["reason"]);
                    steps.Add(new JsonObject { ["doc"] = (string)st["doc"]!, ["action"] = (string)st["action"]!, ["at"] = (string)st["at"]!, ["result"] = res });
                }
            }
            output.Add(new JsonObject { ["name"] = (string)sc["name"]!, ["steps"] = steps });
        }
        Console.WriteLine(output.ToJsonString(new JsonSerializerOptions { WriteIndented = true }));
        return 0;
    }
}

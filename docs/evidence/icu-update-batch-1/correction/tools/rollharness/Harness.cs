// Deterministic-clock harness over the REAL server sources (compiled in via
// RollHarness.csproj): the READ side is the server's own MarLogic.MarRowsFor;
// the WRITE decision replays MarApi's POST branches step for step (prn /
// round identity / dated 'once' identity -> delay-reason 400 -> append the
// fact with its Round) using the same MarSchedule.CurrentRound, with an
// injected clock. The live endpoint itself (lock included) is exercised
// separately against the real server + PostgreSQL (api-check-rolling.py).
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
        if (action is not ("given" or "held" or "refused")) return "400";
        if (action != "given" && string.IsNullOrWhiteSpace(reason)) return "400-reason-required";
        if (administeredAt is not null)
        {
            if (action != "given") return "400-administeredAt";
            var at = D(administeredAt);
            if (at > now.AddMinutes(1) || at < now.AddHours(-MarSchedule.PastWindowHours)) return "400-administeredAt";
        }
        var parsed = MarSchedule.Parse(med);
        string scheduledStamp = ""; DateTime? scheduledInstant = null;
        MarSchedule.Round? round = null; DateTime? first = null;
        if (adminId == "prn")
        {
            if (parsed.Kind != MarSchedule.Kind.Prn) return "400";
            if (row.Status != "active") return "409-inactive";
        }
        else if (MarSchedule.ParseRoundIdentity(adminId) is { } rid)
        {
            if (parsed.Kind != MarSchedule.Kind.Interval) return "404";
            if (row.Status != "active") return "409-inactive";
            first = MarSchedule.FirstDose(MarSchedule.TherapyStart(row, now)!.Value);
            var facts = admins.Where(a => a.Status != "scheduled").ToList();
            var cur = MarSchedule.CurrentRound(first.Value, parsed.IntervalHours, facts, now);
            if (rid.Number < cur.Number) return facts.Any(a => a.Round == rid.Number) ? "409-resolved" : "404";
            if (rid.Number > cur.Number) return "404";
            if (rid.Due != cur.Due) return "409-rescheduled";
            round = cur; scheduledStamp = MarSchedule.StampOf(cur.Due); scheduledInstant = cur.Due;
        }
        else if (DateTime.TryParseExact(adminId, "yyyy-MM-ddTHH:mm", null,
                     System.Globalization.DateTimeStyles.AssumeUniversal | System.Globalization.DateTimeStyles.AdjustToUniversal, out var instant))
        {
            if (parsed.Kind is MarSchedule.Kind.Prn or MarSchedule.Kind.Underivable) return "400";
            if (parsed.Kind is MarSchedule.Kind.Interval) return "404";
            if (row.Status != "active") return "409-inactive";
            if (instant != MarSchedule.FirstDose(MarSchedule.TherapyStart(row, now)!.Value)) return "404";
            scheduledStamp = MarSchedule.StampOf(instant); scheduledInstant = instant;
            if (admins.Any(a => a.Status != "scheduled" && a.ScheduledTime == scheduledStamp)) return "409-duplicate";
        }
        else return "404";
        var lateBy = action == "given" && scheduledInstant is not null ? now - scheduledInstant.Value : TimeSpan.Zero;
        if (lateBy > TimeSpan.FromHours(MarSchedule.LateThresholdHours) && string.IsNullOrWhiteSpace(reason)) return "400-reason-required";
        var time = now.ToString("yyyy-MM-dd HH:mm");
        var adminTime = administeredAt ?? time;
        admins.Add(new AdminDto("FACT", scheduledStamp, action, adminTime, "Harness Nurse", reason, round?.Number));
        row.AdministrationsJson = JsonSerializer.Serialize(admins, JsonOpts.Web);
        return "ok";
    }

    static JsonArray Rows(OrderRow row, DateTime now)
    {
        var rows = new JsonArray();
        foreach (var m in MarLogic.MarRowsFor(row, now))
            rows.Add(new JsonObject
            {
                ["adminId"] = m.AdminId.StartsWith("ADM") || m.AdminId == "FACT" ? "FACT" : m.AdminId,
                ["scheduledTime"] = m.ScheduledTime, ["status"] = m.Status,
                ["documentedTime"] = m.DocumentedTime, ["round"] = m.Round,
                ["timerFrom"] = m.TimerFrom, ["timerRule"] = m.TimerRule,
            });
        return rows;
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
            string? last = null;
            foreach (var st in sc["steps"]!.AsArray())
            {
                if (st!["read"] is JsonNode r)
                    steps.Add(new JsonObject { ["read"] = (string)r!, ["rows"] = Rows(row, D((string)r!)) });
                else if (st["modify"] is JsonNode mf)
                {
                    var m = JsonSerializer.Deserialize<MedicationDto>(row.MedicationJson!, JsonOpts.Web)! with { Frequency = (string)mf! };
                    row.MedicationJson = JsonSerializer.Serialize(m, JsonOpts.Web);
                    steps.Add(new JsonObject { ["modify"] = (string)mf! });
                }
                else if (st["discontinue"] is not null)
                {
                    row.Status = "discontinued";
                    steps.Add(new JsonObject { ["discontinue"] = true });
                }
                else
                {
                    var now = D((string)st["at"]!);
                    var doc = (string)st["doc"]!;
                    var id = doc == "current"
                        ? MarLogic.MarRowsFor(row, now).FirstOrDefault(x => x.Status == "scheduled" && x.AdminId != "ondemand")?.AdminId ?? "none"
                        : doc == "last" ? last! : doc;
                    var res = Document(row, id, (string)st["action"]!, now, (string?)st["administeredAt"], (string?)st["reason"]);
                    if (res == "ok") last = id;
                    var next = MarLogic.MarRowsFor(row, now).FirstOrDefault(x => x.Status == "scheduled" && x.Round is not null);
                    steps.Add(new JsonObject
                    {
                        ["doc"] = doc, ["id"] = id, ["action"] = (string)st["action"]!, ["at"] = (string)st["at"]!,
                        ["result"] = res, ["next"] = next?.ScheduledTime, ["nextId"] = next?.AdminId,
                    });
                }
            }
            output.Add(new JsonObject { ["name"] = (string)sc["name"]!, ["steps"] = steps });
        }
        Console.WriteLine(output.ToJsonString(new JsonSerializerOptions { WriteIndented = true }));
        return 0;
    }
}

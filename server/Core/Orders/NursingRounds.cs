using System.Globalization;
using System.Text.Json;
using Aurora.Core.Shared;

namespace Aurora.Core.Orders;

/* ---------------- Nursing orders: one-time and repeating rounds ----------------
   docs/design/icu-update-nursing-patient-chart.md §2 (the owner's plan) and
   …-contracts.md §3 (the frozen wire contract). A nursing order created
   through the New Nursing Order form carries NursingJson: its repeat interval
   (absent = one-time) and the append-only record of completed rounds. Orders
   without it — every order created before this change, and every order-set
   item — are LEGACY one-time orders and behave exactly as before.

   THE ROUND (server-derived at read, never stored):
   - only while the order is active (pending, completed and discontinued
     orders have none);
   - round 1 is due at the signing minute, so it is open on signing;
   - a repeating order's next round is due at the recorded completion time +
     the interval (the owner's rule), numbered n + 1;
   - the clock never creates a round: a late round keeps its number and due
     time until it is completed.
   PRECISION (contract Amendment 1, §9.1): the round's due time, the
   completion time and the round identity use the NURSING stamp form, UTC
   with milliseconds "yyyy-MM-ddTHH:mm:ss.fffZ" — completion time is the
   server clock rounded UP to the millisecond, and the next round is due at
   exactly that + the full interval (Done at 10:00:59.900 with a 1-minute
   interval opens at 10:01:59.900, never earlier). History/audit stamps and
   every medication stamp keep the minute wire form "yyyy-MM-dd HH:mm".

   Completing a round is POST /api/icu/orders/{id}/implement with
   { roundId, attemptId } under the existing order row lock (OrdersApi); a
   resend of a recorded attempt is answered with the order as it is, judged
   before any state check — the MAR's SAFE RETRY rule applied to nursing.
   Nothing here touches AdministrationsJson or any medication timer. */
static class NursingRounds
{
    public const int MinIntervalMinutes = 1;
    public const int MaxIntervalMinutes = 48 * 60;

    const string NursingStampFormat = "yyyy-MM-dd'T'HH:mm:ss.fff'Z'";
    static readonly System.Text.RegularExpressions.Regex RoundIdPattern =
        new(@"^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)~r([1-9][0-9]{0,5})$");
    static readonly System.Text.RegularExpressions.Regex AttemptIdPattern =
        new("^[A-Za-z0-9_-]{8,64}$");

    /** the NURSING stamp form — due/completion times and round identity only */
    public static string StampOf(DateTime t) => t.ToString(NursingStampFormat, CultureInfo.InvariantCulture);
    public static string RoundIdOf(DateTime due, int number) => $"{StampOf(due)}~r{number}";

    /** a NURSING stamp → UTC instant; null for any other form */
    public static DateTime? ParseStamp(string? t) =>
        t is not null && DateTime.TryParseExact(t, NursingStampFormat, CultureInfo.InvariantCulture,
            DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal, out var d)
            ? d : null;

    /** the minute wire stamp of a history event — the DATED form only: a
        nursing round is never derived from the undated legacy forms ("HH:mm",
        "D-n HH:mm"), whose day moves with the clock */
    static DateTime? ParseMinuteStamp(string? t) =>
        t is not null && DateTime.TryParseExact(t, "yyyy-MM-dd HH:mm", CultureInfo.InvariantCulture,
            DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal, out var d)
            ? d : null;

    /** the recorded completion instant: the clock rounded UP to the whole
        millisecond, so it is never before the actual moment */
    public static DateTime CeilToMillisecond(DateTime t) =>
        new((t.Ticks + TimeSpan.TicksPerMillisecond - 1) / TimeSpan.TicksPerMillisecond * TimeSpan.TicksPerMillisecond, DateTimeKind.Utc);

    public static bool IsValidRoundId(string id) => RoundIdPattern.IsMatch(id);
    public static bool IsValidAttemptId(string id) => AttemptIdPattern.IsMatch(id);

    public static NursingDataDto? Read(OrderRow row) =>
        row.NursingJson is null ? null : JsonSerializer.Deserialize<NursingDataDto>(row.NursingJson, JsonOpts.Web);

    public static string Write(NursingDataDto data) => JsonSerializer.Serialize(data, JsonOpts.Web);

    /** the signing minute — round 1's due time */
    static DateTime? SignedAt(OrderRow row)
    {
        var history = JsonSerializer.Deserialize<List<OrderEventDto>>(row.HistoryJson, JsonOpts.Web)!;
        return ParseMinuteStamp(history.FirstOrDefault(e => e.Action == "signed")?.Time);
    }

    /** the order's current round, from stored facts only (never the clock);
        null when the order is not active or no honest due time exists */
    public static NursingRoundDto? CurrentRound(OrderRow row, NursingDataDto data)
    {
        if (row.Status != "active") return null;
        if (data.Completions.Count == 0)
        {
            if (SignedAt(row) is not DateTime signed) return null;
            return new(RoundIdOf(signed, 1), 1, StampOf(signed));
        }
        if (data.IntervalMinutes is not int interval) return null;   // a completed one-time order is not active
        var last = data.Completions[^1];
        if (ParseStamp(last.CompletedTime) is not DateTime done) return null;
        var due = done.AddMinutes(interval);
        return new(RoundIdOf(due, last.Round + 1), last.Round + 1, StampOf(due));
    }

    /** the wire form: stored fields + the derived current round */
    public static NursingOrderDto? ToWire(OrderRow row)
    {
        if (Read(row) is not NursingDataDto data) return null;
        return new(data.IntervalMinutes, data.Completions, CurrentRound(row, data));
    }
}

/* ---- stored (Orders.NursingJson): { intervalMinutes?, completions[] } ---- */
record NursingDataDto(int? IntervalMinutes, List<NursingCompletionDto> Completions);

/* one completed round — append-only. AttemptId is present when the
   completion was made with the round/attempt contract (safe retry). */
record NursingCompletionDto(
    int Round, string RoundId, string DueTime, string CompletedTime, string CompletedBy,
    string? AttemptId = null);

/* ---- wire: mirrors NursingOrderDetails / NursingRound in src/lib/api/types.ts ---- */
record NursingRoundDto(string RoundId, int Number, string DueTime);

record NursingOrderDto(int? IntervalMinutes, List<NursingCompletionDto> Completions, NursingRoundDto? CurrentRound = null);

/* ---- requests: [Disallow] — an unknown field is a 400, never a silent no-op ---- */

/** NewOrderDraft.nursing — absent interval = one-time */
[System.Text.Json.Serialization.JsonUnmappedMemberHandling(System.Text.Json.Serialization.JsonUnmappedMemberHandling.Disallow)]
record NursingDraftDto(int? IntervalMinutes);

/** the optional implement body: both fields or neither (an empty body is the
    legacy request) */
[System.Text.Json.Serialization.JsonUnmappedMemberHandling(System.Text.Json.Serialization.JsonUnmappedMemberHandling.Disallow)]
record ImplementRequest(string? RoundId, string? AttemptId);

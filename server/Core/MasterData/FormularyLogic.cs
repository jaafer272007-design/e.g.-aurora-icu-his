using System.Text.Json;
using Aurora.Core.Persistence;
using Aurora.Core.Shared;
using Microsoft.EntityFrameworkCore;

namespace Aurora.Core.MasterData;

static class FormularyLogic
{
    public const int MaxTextLength = 2000;
    public const int MaxListItems = 50;

    /** reference-data changes span months — audit times carry the DATE
        (UTC), the Layer 3 users convention */
    public static string Now() => DateTime.UtcNow.ToString("yyyy-MM-dd HH:mm");

    /* ---------- the frequency vocabulary (moved from OrderLogic) ----------
       A valid order frequency is a NAMED value from this table ∪ q<1-48>h.
       The named set was OrderLogic's hardcoded array before Layer 4; the
       table is seeded from the same values (via the mock store), so
       validation behavior is byte-identical — including the error text,
       which is BUILT from the table in seed order. */

    public static List<string> NamedFrequencies(AuroraDb db) =>
        db.NamedFrequencies.AsNoTracking().OrderBy(f => f.Seq).Select(f => f.Value).ToList();

    public static bool IsValidFrequency(AuroraDb db, string f) =>
        db.NamedFrequencies.AsNoTracking().Any(n => n.Value == f)
        || (System.Text.RegularExpressions.Regex.Match(f, @"^q(\d{1,2})h$") is { Success: true } m
            && int.TryParse(m.Groups[1].Value, out var h) && h is >= 1 and <= 48);

    public static string FrequencyRule(AuroraDb db) =>
        $"must be one of: {string.Join(", ", NamedFrequencies(db))}, or q<1-48>h";

    /** the formulary row a drugId resolves to, or null — order create/
        modify use this for the inactive-drug state check (an id with NO
        formulary row stays permitted free text — documented decision) */
    public static FormularyDrugRow? Resolve(AuroraDb db, string drugId) =>
        db.FormularyDrugs.AsNoTracking().FirstOrDefault(d => d.DrugId == drugId);

    /* ---------- drug field validation (create + edit share it) ---------- */

    public static string? ValidateDrugId(string drugId)
    {
        if (drugId.Length == 0) return "drugId is required";
        if (drugId.Length is < 2 or > 64) return "drugId must be 2-64 characters";
        if (!drugId.All(c => c is (>= 'a' and <= 'z') or (>= '0' and <= '9') or '-'))
            return "drugId may contain only lowercase letters, digits and '-'";
        return null;
    }

    public static string? CheckText(string field, string? value, bool required)
    {
        if (string.IsNullOrWhiteSpace(value))
            return required ? $"{field} is required" : null;
        if (value.Length > MaxTextLength) return $"{field} exceeds {MaxTextLength} characters";
        return null;
    }

    /** a provided string list must be items of bounded non-blank text;
        `nonEmpty` additionally requires at least one item */
    public static string? CheckList(string field, List<string>? list, bool nonEmpty)
    {
        if (list is null) return null;
        if (nonEmpty && list.Count == 0) return $"{field} must contain at least one item";
        if (list.Count > MaxListItems) return $"{field} exceeds {MaxListItems} items";
        for (var i = 0; i < list.Count; i++)
        {
            if (string.IsNullOrWhiteSpace(list[i])) return $"{field}[{i}] must be a non-empty string";
            if (list[i].Length > MaxTextLength) return $"{field}[{i}] exceeds {MaxTextLength} characters";
        }
        return null;
    }

    /** every per-drug frequency must itself be orderable (named ∪ qNh) —
        otherwise Pharmacy could author a frequency the order endpoint
        rejects, rendering a button that always 400s */
    public static string? CheckFrequencies(AuroraDb db, string field, List<string>? list)
    {
        if (list is null) return null;
        for (var i = 0; i < list.Count; i++)
        {
            if (!IsValidFrequency(db, list[i]))
                return $"{field}[{i}] '{list[i]}' is not a valid frequency — {FrequencyRule(db)}";
        }
        return null;
    }

    public static string? CheckDoseLimits(DoseLimitsDto? limits)
    {
        if (limits is null) return null;
        foreach (var (name, value) in new[] {
            ("min", limits.Min), ("max", limits.Max),
            ("maxDaily", limits.MaxDaily), ("perKg", limits.PerKg) })
        {
            if (value is null) continue;
            if (value.Length == 0) return $"doseLimits.{name} must be a non-empty string";
            if (value.Length > MaxTextLength) return $"doseLimits.{name} exceeds {MaxTextLength} characters";
        }
        return null;
    }

    /** append-only — existing entries are never rewritten or removed */
    public static string AppendEvents(string eventsJson, List<FormularyEventDto> newEvents)
    {
        var events = JsonSerializer.Deserialize<List<FormularyEventDto>>(eventsJson, JsonOpts.Web)!;
        events.AddRange(newEvents);
        return JsonSerializer.Serialize(events, JsonOpts.Web);
    }
}

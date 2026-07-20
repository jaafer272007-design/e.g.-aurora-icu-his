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
       which is BUILT from the table in seed order.
       MANAGED since the Configuration Vocabularies build (design §4).
       The split, deliberate (the four-code rule's shape/state line):
       - IsValidFrequency = ANY named row ∪ the q<n>h pattern — SHAPE.
         A retired value is not malformed (every stored order carrying
         it must keep resolving), so the 400 validation path is
         unchanged for it; the RETIRED state answers 409 at order
         create/modify (OrdersApi, beside the inactive-drug check).
       - NamedFrequencies/FrequencyRule list ACTIVE values — they answer
         "what may I pick NOW" (the GET the pickers read, and the
         guidance text in every rejection).
       - CheckFrequencies (per-drug authoring) requires ACTIVE ∪ q<n>h:
         a NEW list may not adopt a retired value (not newly selectable),
         while lists already stored keep rendering.
       The q<n>h pattern itself STAYS CODE — a safety-shaped structured
       rule (the infusion-unit closed union), never a hospital list. */

    public static List<string> NamedFrequencies(AuroraDb db) =>
        db.NamedFrequencies.AsNoTracking().Where(f => f.Active).OrderBy(f => f.Seq).Select(f => f.Value).ToList();

    public static bool IsValidFrequency(AuroraDb db, string f) =>
        db.NamedFrequencies.AsNoTracking().Any(n => n.Value == f)
        || IsStructuredFrequency(f);

    /** the structured q<1-48>h pattern — code, never data */
    public static bool IsStructuredFrequency(string f) =>
        System.Text.RegularExpressions.Regex.Match(f, @"^q(\d{1,2})h$") is { Success: true } m
        && int.TryParse(m.Groups[1].Value, out var h) && h is >= 1 and <= 48;

    /** the named row exists but is retired — the 409 state at order
        create/modify (a structured q<n>h value can never be retired) */
    public static bool IsRetiredFrequency(AuroraDb db, string f) =>
        db.NamedFrequencies.AsNoTracking().FirstOrDefault(n => n.Value == f) is { Active: false };

    public static string FrequencyRule(AuroraDb db) =>
        $"must be one of: {string.Join(", ", NamedFrequencies(db))}, or q<1-48>h";

    /** the formulary row a drugId resolves to, or null — order create/
        modify use this for the inactive-drug state check (an id with NO
        formulary row stays permitted free text — documented decision) */
    public static FormularyDrugRow? Resolve(AuroraDb db, string drugId) =>
        db.FormularyDrugs.AsNoTracking().FirstOrDefault(d => d.DrugId == drugId);

    /* ---------- drug field validation (create + edit share it) ---------- */

    /** Hidden internal keys (the free-text-fields correction): a human
        types only the display name — the SYSTEM owns the identifier (the
        auto-generated-MRN principle, the imaging StudyId precedent).
        Explicit ids remain wire-accepted with NO format rule (suites and
        the staging formulary sync keep working); the old 2-64
        lowercase/digit/hyphen rule was a style rule and is removed. */
    public static string NewKey(string prefix, Func<string, bool> exists)
    {
        while (true)
        {
            var id = $"{prefix}_{Guid.NewGuid():N}"[..16];
            if (!exists(id)) return id;
        }
    }

    /** an explicit id needs only the platform bound — never a format */
    public static string? ValidateExplicitId(string field, string id) =>
        id.Length > MaxTextLength ? $"{field} exceeds {MaxTextLength} characters" : null;

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

    /** every per-drug frequency must itself be orderable NOW (ACTIVE
        named ∪ qNh) — otherwise Pharmacy could author a frequency the
        order endpoint rejects, rendering a button that always fails.
        Retired values in lists ALREADY STORED keep rendering (reads
        never consult this); they just cannot be newly authored. */
    public static string? CheckFrequencies(AuroraDb db, string field, List<string>? list)
    {
        if (list is null) return null;
        var active = NamedFrequencies(db).ToHashSet();
        for (var i = 0; i < list.Count; i++)
        {
            if (!active.Contains(list[i]) && !IsStructuredFrequency(list[i]))
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

using System.ComponentModel.DataAnnotations;
using System.Text.Json;
using Aurora.Core.Shared;

namespace Aurora.Core.MasterData;

/* ---------- Master Data — Lab Test Catalogue (Layer 4 phase 2) ----------
   The tests that can be ordered, exactly parallel to the drug formulary:
   one row per test, analytes as a JSON column, TestId a natural key (==
   the LabPanelKey the results wire has always used, so the catalogue and
   the existing results are consistent by construction).
   Data/labcatalog-seed.json is GENERATED from src/lib/api/data/catalog.ts
   (itself derived from the panels the seeded labs domain implies) — never
   hand-edit.

   DEACTIVATION, NEVER DELETION (the formulary invariant): a test that has
   ever been ordered or resulted must stay resolvable forever. An inactive
   test cannot be newly ORDERED (409 at order create); every existing
   result referencing it still renders, and RESULTING against it stays
   allowed — a result completes care already ordered, and blocking it
   would strand the day-3 order whose test was retired on day 5. */

class LabTestRow
{
    [Key]
    public string TestId { get; set; } = "";
    public int Seq { get; set; }
    public string Name { get; set; } = "";
    public string Category { get; set; } = "";
    public string Specimen { get; set; } = "";
    public string AnalytesJson { get; set; } = "[]";
    public bool Active { get; set; } = true;
    public string EventsJson { get; set; } = "[]";

    public static LabTestRow FromDto(LabTestDto d, int seq) => new()
    {
        TestId = d.TestId, Seq = seq, Name = d.Name, Category = d.Category,
        Specimen = d.Specimen,
        AnalytesJson = JsonSerializer.Serialize(d.Analytes, JsonOpts.Web),
        Active = d.Active ?? true,
        EventsJson = d.History is null ? "[]" : JsonSerializer.Serialize(d.History, JsonOpts.Web),
    };

    public LabTestDto ToDto() => new(
        TestId, Name, Category, Specimen,
        JsonSerializer.Deserialize<List<AnalyteDefDto>>(AnalytesJson, JsonOpts.Web)!,
        Active,
        JsonSerializer.Deserialize<List<FormularyEventDto>>(EventsJson, JsonOpts.Web)!);
}

/* wire contracts — mirror LabTest / AnalyteDef in src/lib/api/types.ts.
   FormularyEventDto is the shared master-data audit event shape. */
record LabTestDto(
    string TestId, string Name, string Category, string Specimen,
    List<AnalyteDefDto> Analytes, bool? Active = null, List<FormularyEventDto>? History = null);

/* Catalogue Test Management (Option B): CritLow/CritHigh are the CRITICAL
   thresholds — beyond them a documented value flags CRITICAL (at-threshold
   counts as critical: over-flagging is the safe error). OPTIONAL per side
   (not every analyte has both bounds) and nullable → absent on the wire for
   the 7 seeded panels, whose definitions and behaviour are byte-identical
   (backfilling seeded critical thresholds is a recorded FUTURE item). They
   live inside AnalytesJson — data, not schema; no migration. */
record AnalyteDefDto(string Analyte, string Unit, string RefRange, double RefLow, double RefHigh,
    double? CritLow = null, double? CritHigh = null);

[System.Text.Json.Serialization.JsonUnmappedMemberHandling(System.Text.Json.Serialization.JsonUnmappedMemberHandling.Disallow)]
record AnalyteDefRequest(string? Analyte, string? Unit, string? RefRange, double? RefLow, double? RefHigh,
    double? CritLow = null, double? CritHigh = null);

[System.Text.Json.Serialization.JsonUnmappedMemberHandling(System.Text.Json.Serialization.JsonUnmappedMemberHandling.Disallow)]
record CreateLabTestRequest(
    string? TestId, string? Name, string? Category, string? Specimen, List<AnalyteDefRequest>? Analytes);

[System.Text.Json.Serialization.JsonUnmappedMemberHandling(System.Text.Json.Serialization.JsonUnmappedMemberHandling.Disallow)]
record EditLabTestRequest(string? Name, string? Category, string? Specimen, List<AnalyteDefRequest>? Analytes)
{
    public bool HasAnyField => Name is not null || Category is not null
        || Specimen is not null || Analytes is not null;
}

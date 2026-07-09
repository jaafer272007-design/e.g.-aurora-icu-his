using System.ComponentModel.DataAnnotations;
using System.Text.Json;
using Aurora.Core.Shared;

namespace Aurora.Core.Ai;

/* One row per patient AI risk profile. Only the per-risk history + scalar
   fields are stored (as a JSON column, same pattern as orders/labs); trend
   and delta are DERIVED at read (AiLogic). Data/ai-seed.json is GENERATED
   from src/lib/api/data/ai.ts — never hand-edit it. A Seq column preserves
   the mock's profile order for the pre-sort ranking traversal. */
class AiRiskRow
{
    [Key]
    public string PatientId { get; set; } = "";
    public int Seq { get; set; }
    public string BedId { get; set; } = "";
    public string PatientName { get; set; } = "";
    public string UpdatedAt { get; set; } = "";
    public string RisksJson { get; set; } = "[]";

    public static AiRiskRow FromDto(AiProfileDto d, int seq) => new()
    {
        PatientId = d.PatientId, Seq = seq, BedId = d.BedId, PatientName = d.PatientName,
        UpdatedAt = d.UpdatedAt,
        RisksJson = JsonSerializer.Serialize(d.Risks, JsonOpts.Web),
    };

    public AiProfileDto ToDto() => new(
        PatientId, BedId, PatientName, UpdatedAt,
        JsonSerializer.Deserialize<List<RiskPredictionDto>>(RisksJson, JsonOpts.Web)!);
}

/* wire contracts — mirror PatientRiskProfile / RiskPrediction / RiskFactor /
   RankedRisk / RiskRankingRow in src/lib/api/types.ts (camelCase; optional
   fields absent, not null — Suggestions/Mitigating). */
record AiProfileDto(
    string PatientId, string BedId, string PatientName, string UpdatedAt,
    List<RiskPredictionDto> Risks);

record RiskPredictionDto(
    string Category, int Probability, List<int> History, string Rationale,
    List<RiskFactorDto> Factors, List<string>? Suggestions);

record RiskFactorDto(string Label, int Weight, bool? Mitigating);

record RankedRiskDto(string Category, int Probability, string Trend, int Delta);

record RiskRankingRowDto(
    string PatientId, string BedId, string PatientName, string Diagnosis,
    RankedRiskDto Top, List<int> TopHistory, List<RankedRiskDto> AlsoElevated, string UpdatedAt);

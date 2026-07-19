using System.ComponentModel.DataAnnotations;
using System.Text.Json;
using Aurora.Core.Shared;

namespace Aurora.Core.MasterData;

/* ------------- Code Status vocabulary (Master Data, Aurora Core) -------------
   SAFETY FIX (the configurability audit's finding, built from the Code
   Status governed-vocabulary design): a resuscitation instruction is the
   single most consequential field in an ICU record, and it was an
   UNVALIDATED free-text string whose only values lived in demo data —
   with the roster read FABRICATING "Full Code" for any patient without a
   bedside row. Code status is now a governed vocabulary on the exact
   pattern the formulary and lab catalogue prove: natural key, Active
   flag, append-only audit, DEACTIVATE-NEVER-DELETE, validated at write.
   A patient's code status is SELECTED from the active vocabulary, never
   typed; an entry ever assigned to an encounter stays resolvable forever
   (retired = not newly assignable; historical records keep rendering).

   The starting set (full_code / dnr / dnr_dni / comfort_care) is a
   PLACEHOLDER the clinical owner finalises through the manager — the
   whole point is that the list is per-hospital policy, not code.
   Entries are LABEL + CODE only (the design's recommendation): no
   structured meaning is encoded in the data model — "DNR / DNI" is one
   vocabulary entry, matching how it is charted at the bedside. */
class CodeStatusRow
{
    [Key]
    public string Code { get; set; } = "";
    public string Label { get; set; } = "";
    public int Seq { get; set; }
    public bool Active { get; set; } = true;
    /* append-only audit history — actor always from the token, dated UTC
       times (the Layer 3 convention) */
    public string EventsJson { get; set; } = "[]";

    public CodeStatusDto ToDto() => new(Code, Label, Seq, Active,
        JsonSerializer.Deserialize<List<FormularyEventDto>>(EventsJson, JsonOpts.Web)!);
}

/* ---------- wire contracts (camelCase over the wire) ---------- */

record CodeStatusDto(string Code, string Label, int Seq, bool Active,
    List<FormularyEventDto> History);

[System.Text.Json.Serialization.JsonUnmappedMemberHandling(System.Text.Json.Serialization.JsonUnmappedMemberHandling.Disallow)]
record CreateCodeStatusRequest(string? Code, string? Label);

[System.Text.Json.Serialization.JsonUnmappedMemberHandling(System.Text.Json.Serialization.JsonUnmappedMemberHandling.Disallow)]
record EditCodeStatusRequest(string? Label);

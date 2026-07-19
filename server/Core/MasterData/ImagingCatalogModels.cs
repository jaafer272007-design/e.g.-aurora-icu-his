using System.ComponentModel.DataAnnotations;
using System.Text.Json;
using Aurora.Core.Shared;

namespace Aurora.Core.MasterData;

/* ------------- Imaging Catalogue (Master Data, Aurora Core) -------------
   The Imaging Catalogue design's triple fix: production imaging ordering
   was BLOCKED (the ordering vocabulary was a client mock —
   ORDER_SETS.Imaging, 3 studies — that nulls out in production), the
   result-entry modalities were two inconsistent hardcoded arrays, and
   studies had no coded identity so an imaging order carried only free
   text. This is the imaging counterpart of the LAB CATALOGUE, mirrored
   exactly (the design's instruction: do not invent a new mechanism):
   natural key, Active flag, append-only audit, deactivate-never-delete,
   snapshot-at-use (the order's Summary carries the study name AT ORDER
   TIME; historical records never re-resolve the live catalogue),
   validated writes. Each hospital manages its own studies live from the
   Configuration area — a hospital with no MRI retires the MRI studies; a
   hospital with a cath lab adds theirs.

   NAMING: the DbSet is ImagingCatalog and the row ImagingStudyDefRow —
   `ImagingStudies` (the design's working name) is ALREADY the imaging
   REPORTS table (LabImaging.ImagingStudyRow, #105); a study DEFINITION
   and a performed study are different things and keep different names.

   FIELD SET (design §1 flag, resolved): code + name + modality + body
   region + the two structured attributes that matter clinically in an
   ICU — CONTRAST and PORTABLE (they change screening, transport and
   nursing prep). Nothing more — deliberately not over-modelled.

   The starter sets are PLACEHOLDERS the clinical owner finalises live on
   the Configuration screen — the whole point is that the list is
   per-hospital, not code. */
class ImagingStudyDefRow
{
    [Key]
    public string StudyId { get; set; } = "";
    public int Seq { get; set; }
    public string Name { get; set; } = "";
    /* one of ResultsLogic.ImagingModalities — the SINGLE reconciled
       modality vocabulary (design §3) */
    public string Modality { get; set; } = "";
    public string Region { get; set; } = "";
    public bool Contrast { get; set; }
    public bool Portable { get; set; }
    public bool Active { get; set; } = true;
    /* append-only audit history — actor from the token, dated UTC */
    public string EventsJson { get; set; } = "[]";

    public ImagingStudyDefDto ToDto() => new(StudyId, Name, Modality, Region, Contrast, Portable, Active,
        JsonSerializer.Deserialize<List<FormularyEventDto>>(EventsJson, JsonOpts.Web)!);
}

/* ---------- wire contracts (camelCase over the wire) ---------- */

record ImagingStudyDefDto(string StudyId, string Name, string Modality, string Region,
    bool Contrast, bool Portable, bool Active, List<FormularyEventDto> History);

[System.Text.Json.Serialization.JsonUnmappedMemberHandling(System.Text.Json.Serialization.JsonUnmappedMemberHandling.Disallow)]
record CreateImagingStudyRequest(string? StudyId, string? Name, string? Modality, string? Region,
    bool? Contrast, bool? Portable);

[System.Text.Json.Serialization.JsonUnmappedMemberHandling(System.Text.Json.Serialization.JsonUnmappedMemberHandling.Disallow)]
record EditImagingStudyRequest(string? Name, string? Modality, string? Region,
    bool? Contrast, bool? Portable)
{
    public bool HasAnyField => Name is not null || Modality is not null || Region is not null
        || Contrast is not null || Portable is not null;
}

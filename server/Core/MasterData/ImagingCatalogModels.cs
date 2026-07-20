using System.ComponentModel.DataAnnotations;
using System.Text.Json;
using Aurora.Core.Shared;

namespace Aurora.Core.MasterData;

/* ------------- Imaging Catalogue (Master Data, Aurora Core) -------------
   CORRECTED CLINICAL MODEL (Imaging Catalogue Correction design, the
   validator's hands-on finding): a catalogue entry is a MODALITY plus a
   FREE-TEXT NAME — nothing else. Body region and contrast are ORDER-TIME
   decisions (the same CT is done with or without contrast, of the head or
   the abdomen, depending on the clinical question) and live on the ORDER;
   "portable" is removed entirely. Baking them into the definition forced
   one modality to become many rows and was shipped wrong in #136.

   The NAME carries no format rules at all — "CT", "CT Scan", whatever the
   user types (the only server bound is the platform-wide oversized-input
   guard). The old lowercase-underscore StudyId existed for order→result
   linkage; the LINKAGE stays but the id is now SYSTEM-GENERATED and never
   typed or shown — the auto-generated-MRN principle: the human types a
   friendly name, the system owns the stable key. Existing StudyIds are
   preserved by the migration so historical orders keep resolving.

   Everything else keeps the lab-catalogue mechanics: natural key, Active
   flag, append-only audit, deactivate-never-delete, snapshot-at-use (the
   order's Summary carries the assembled description AT ORDER TIME),
   validated writes. Each hospital manages its own studies live from the
   Configuration area.

   NAMING: the DbSet is ImagingCatalog and the row ImagingStudyDefRow —
   `ImagingStudies` is ALREADY the imaging REPORTS table
   (LabImaging.ImagingStudyRow, #105); a study DEFINITION and a performed
   study are different things and keep different names. */
class ImagingStudyDefRow
{
    [Key]
    public string StudyId { get; set; } = "";
    public int Seq { get; set; }
    public string Name { get; set; } = "";
    /* one of ResultsLogic.ImagingModalities — the SINGLE reconciled
       modality vocabulary (kept: the fixed vocabulary is correct) */
    public string Modality { get; set; } = "";
    public bool Active { get; set; } = true;
    /* append-only audit history — actor from the token, dated UTC */
    public string EventsJson { get; set; } = "[]";

    public ImagingStudyDefDto ToDto() => new(StudyId, Name, Modality, Active,
        JsonSerializer.Deserialize<List<FormularyEventDto>>(EventsJson, JsonOpts.Web)!);
}

/* ---------- wire contracts (camelCase over the wire) ---------- */

record ImagingStudyDefDto(string StudyId, string Name, string Modality,
    bool Active, List<FormularyEventDto> History);

/* the corrected create shape: name + modality ONLY. No studyId (the
   server generates the internal key), no region/contrast/portable
   (order-time or gone) — Disallow makes a request still sending them a
   binding-time 400, which is the contract, not an accident. */
[System.Text.Json.Serialization.JsonUnmappedMemberHandling(System.Text.Json.Serialization.JsonUnmappedMemberHandling.Disallow)]
record CreateImagingStudyRequest(string? Name, string? Modality);

[System.Text.Json.Serialization.JsonUnmappedMemberHandling(System.Text.Json.Serialization.JsonUnmappedMemberHandling.Disallow)]
record EditImagingStudyRequest(string? Name, string? Modality)
{
    public bool HasAnyField => Name is not null || Modality is not null;
}

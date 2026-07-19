using System.ComponentModel.DataAnnotations;
using System.Text.Json;
using Aurora.Core.Shared;

namespace Aurora.Core.MasterData;

/* ------------- Hospital Identity (Configuration, Aurora Core) -------------
   THE FOUNDATION of the Configuration area (Config Home + Hospital
   Identity design): the product was branded "AURORA GENERAL HOSPITAL" /
   "Unit 4B" in hardcoded strings across the print letterhead, app
   headers and the login screen — a hospital installing Aurora literally
   could not make the system say its own name, and no configuration
   table existed for it to live in.

   Hospital identity is ONE configuration record per install (one
   hospital per install — this is the install's own identity, not a
   catalogue of many), kept on the same proven discipline as the
   vocabularies: validated writes, append-only audit history
   (AMEND-NEVER-ERASE — changing a hospital's name is a significant,
   traceable act). There is no add/retire lifecycle because there is
   exactly one record; editing is the only mutation, and every edit
   lands on the permanent event history.

   SINGLE-UNIT BOUNDARY (design §5, the validator's decision): the unit
   NAME here kills the "Unit 4B" display hardcoding, but this is one
   configured unit, NOT a units catalogue — no picker, no per-unit
   scoping. A future multi-unit project extends by introducing a real
   units table and moving UnitName there; nothing in this record bakes
   the single-unit assumption deeper than the display strings it
   replaces (the data-layer unitId '4B' bed key is untouched — that is
   the beds tenant's concern, next PR).

   UNSET IS HONEST (design §4): a fresh production install has NO
   identity — the fields are empty and every surface renders a NEUTRAL
   placeholder, never "AURORA GENERAL HOSPITAL" (shipping every hospital
   branded as the demo hospital, or printing the demo name on a real
   discharge summary, would be a fabrication). The eventual first-run
   wizard populates this record; this PR builds the editable identity,
   not the wizard. */
class HospitalIdentityRow
{
    /* single-record table: the key is the constant "hospital" */
    [Key]
    public string Id { get; set; } = "hospital";
    public string Name { get; set; } = "";
    public string UnitName { get; set; } = "";
    public string ShortName { get; set; } = "";
    /* free-text address block for the print letterhead (design §2: real
       hospitals want it on printed documents; a LOGO IMAGE is the
       flagged fast-follow — upload/storage/print rendering — and does
       not block identity) */
    public string Address { get; set; } = "";
    /* append-only audit history — actor from the token, dated UTC
       (the Layer 3 convention) */
    public string EventsJson { get; set; } = "[]";

    public bool Configured =>
        Name.Length > 0 || UnitName.Length > 0 || ShortName.Length > 0 || Address.Length > 0;

    /* the PUBLIC identity (no history): served to the login screen
       pre-authentication — a hospital's name is its public face */
    public HospitalIdentityDto ToDto() => new(Name, UnitName, ShortName, Address, Configured);

    public HospitalIdentityWithHistoryDto ToHistoryDto() => new(Name, UnitName, ShortName, Address, Configured,
        JsonSerializer.Deserialize<List<FormularyEventDto>>(EventsJson, JsonOpts.Web)!);
}

/* ---------- wire contracts (camelCase over the wire) ---------- */

record HospitalIdentityDto(string Name, string UnitName, string ShortName, string Address, bool Configured);

record HospitalIdentityWithHistoryDto(string Name, string UnitName, string ShortName, string Address, bool Configured,
    List<FormularyEventDto> History);

[System.Text.Json.Serialization.JsonUnmappedMemberHandling(System.Text.Json.Serialization.JsonUnmappedMemberHandling.Disallow)]
record EditHospitalIdentityRequest(string? Name, string? UnitName, string? ShortName, string? Address);

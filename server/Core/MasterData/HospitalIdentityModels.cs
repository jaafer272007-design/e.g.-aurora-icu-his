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
       hospitals want it on printed documents) */
    public string Address { get; set; } = "";

    /* ---- BRANDING (Print Center branding build — the #135 flagged
       fast-follow, now built) ----
       HeaderText/FooterText: the hospital's OWN branding lines on every
       printed document (a tagline under the letterhead; an accreditation
       or legal line in the footer). Free text is SAFE here — this is the
       institution's administrative face, never clinical data (the
       hospital.configure split).
       LOGO — the system's FIRST binary/image capability. Stored ON-PREM
       IN THIS ROW (the appliance is an isolated install; an external
       image service would be a new dependency and an egress): base64
       text + mime, PNG or JPEG only, decoded size ≤ 512 KB (a letterhead
       logo, not an asset library), magic-byte validated at upload so the
       mime can never lie. LogoVersion increments on every set/clear —
       the client cache-busts the byte endpoint with it. */
    public string HeaderText { get; set; } = "";
    public string FooterText { get; set; } = "";
    public string LogoMime { get; set; } = "";
    public string LogoBase64 { get; set; } = "";
    public int LogoVersion { get; set; }

    /* append-only audit history — actor from the token, dated UTC
       (the Layer 3 convention) */
    public string EventsJson { get; set; } = "[]";

    public bool Configured =>
        Name.Length > 0 || UnitName.Length > 0 || ShortName.Length > 0 || Address.Length > 0;

    public bool HasLogo => LogoBase64.Length > 0;

    /* the PUBLIC identity (no history): served to the login screen
       pre-authentication — a hospital's name is its public face. The
       logo BYTES are not inlined here (a 512 KB base64 on every boot
       read would tax every app load) — hasLogo/logoVersion point the
       client at the dedicated byte endpoint. */
    public HospitalIdentityDto ToDto() =>
        new(Name, UnitName, ShortName, Address, HeaderText, FooterText, HasLogo, LogoVersion, Configured);

    public HospitalIdentityWithHistoryDto ToHistoryDto() =>
        new(Name, UnitName, ShortName, Address, HeaderText, FooterText, HasLogo, LogoVersion, Configured,
        JsonSerializer.Deserialize<List<FormularyEventDto>>(EventsJson, JsonOpts.Web)!);
}

/* ---------- wire contracts (camelCase over the wire) ---------- */

/* serverTimeZone/serverUtcOffsetMinutes (the Locale/Timezone design §1.3
   mechanism, stated): the MACHINE CLOCK rides the install's one anonymous
   boot read. Storage stays UTC everywhere — these two fields exist so the
   client can DISPLAY stored UTC stamps in the server's own zone ("the
   hospital's server is one machine in one place — its OS timezone IS the
   hospital's"). The IANA id comes from TimeZoneInfo.Local (the container's
   TZ env / OS setting — NOT a configured value, so it is computed at read,
   never stored on the identity row); the current offset is the fallback
   for a client whose Intl tables don't know the zone name. Only the
   PUBLIC read carries them (the history/edit responses are configuration
   surfaces, not the boot read) — the record defaults keep every other
   composition site unchanged. */
record HospitalIdentityDto(string Name, string UnitName, string ShortName, string Address,
    string HeaderText, string FooterText, bool HasLogo, int LogoVersion, bool Configured,
    string ServerTimeZone = "UTC", int ServerUtcOffsetMinutes = 0);

record HospitalIdentityWithHistoryDto(string Name, string UnitName, string ShortName, string Address,
    string HeaderText, string FooterText, bool HasLogo, int LogoVersion, bool Configured,
    List<FormularyEventDto> History);

[System.Text.Json.Serialization.JsonUnmappedMemberHandling(System.Text.Json.Serialization.JsonUnmappedMemberHandling.Disallow)]
record EditHospitalIdentityRequest(string? Name, string? UnitName, string? ShortName, string? Address,
    string? HeaderText, string? FooterText);

/* logo upload — JSON base64 (small bounded payload; no multipart
   machinery for one letterhead image). Disallow rejects unknown fields. */
[System.Text.Json.Serialization.JsonUnmappedMemberHandling(System.Text.Json.Serialization.JsonUnmappedMemberHandling.Disallow)]
record SetHospitalLogoRequest(string? Mime, string? DataBase64);

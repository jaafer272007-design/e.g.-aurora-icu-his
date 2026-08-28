using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace Aurora.Core.Adt;

/* ---- ICU Integration P1 — the patient correlation record ----

   THE GAP THIS CLOSES. Before this table there was NO field anywhere in
   the ICU schema for a foreign identifier: no OpenMRS patient uuid, no
   visit uuid, nothing. Correlation could only be INFERRED from shared
   human identifiers (national ID, file number, MRN), and inference is
   not a contract — it cannot be audited, and it cannot be undone.

   P1 CREATES THE SCHEMA AND WRITES NOTHING TO IT. That is the whole
   point of doing it now: the migration is the irreversible-ish part, so
   it lands early, empty, and reviewed — while the act of correlating a
   real patient stays a deliberate, staffed decision in a later phase.
   Nothing in P1 inserts, updates or deletes a row here:
     - the bridge does not touch it;
     - patients/match reads ICU patients and returns candidates, and is
       proven not to write anything at all;
     - the read-only gate refuses every write method outright.

   WHY THE COLUMNS ARE WHAT THEY ARE:
     - OpenmrsPatientUuid — the hospital's identity, the side that owns
       patient identity under the approved ownership split.
     - PatientId          — ICU's own key. UNIQUE, because one ICU
       patient may correspond to exactly one hospital patient; a second
       row for the same ICU patient is a data error, not a merge.
     - Source             — HOW the link was decided ("confirmed-match",
       "probable-match-confirmed-by-staff", …). A link established by an
       exact national-ID hit and one a human accepted from a probable
       list are different facts and must not read alike later.
     - ActorUsername / ActorJobTitle — WHO decided, and under which
       active role (the #104 discipline used by every other ICU audit).
     - CreatedAt / ConfirmedAt — dated UTC "yyyy-MM-dd HH:mm", the
       format every other ICU audit row uses.
     - Note               — free text for the human's reason; never a
       required field, never fabricated.

   AMEND, NEVER ERASE. A correlation that turns out to be wrong is
   RETIRED (Active=false) with a reason, never deleted: orders and
   observations were read under that link, and the fact that it once
   existed is part of the record. */
[Table("IcuPatientCorrelations")]
class PatientCorrelation
{
    [Key]
    public string CorrelationId { get; set; } = "";

    /** the hospital's patient uuid (OpenMRS). Indexed unique among
        ACTIVE rows — enforced in application logic when the confirm
        path lands, because a retired link must be allowed to coexist
        with its replacement. */
    public string OpenmrsPatientUuid { get; set; } = "";

    /** the ICU patient this maps to (AdtPatients.PatientId) */
    public string PatientId { get; set; } = "";

    /** how the link was established — never blank */
    public string Source { get; set; } = "";

    public string ActorUsername { get; set; } = "";
    public string ActorJobTitle { get; set; } = "";

    /** dated UTC "yyyy-MM-dd HH:mm" */
    public string CreatedAt { get; set; } = "";
    public string? ConfirmedAt { get; set; }

    public bool Active { get; set; } = true;
    public string? RetiredAt { get; set; }
    public string? RetiredReason { get; set; }

    public string? Note { get; set; }
}

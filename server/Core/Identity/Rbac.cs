using System.Security.Claims;
using Aurora.Core.Shared;

namespace Aurora.Core.Identity;

/* ---------- three-layer RBAC, server side (Stage 10 Phase 3) ----------
   Mirrors src/lib/session.ts: JobTitle → PermissionProfile → Permissions,
   ALWAYS computed at read time from the token's jobTitle claim — profiles
   and permissions are never stored, never carried in the token. */
static class Rbac
{
    static readonly Dictionary<string, string> TitleProfile = new()
    {
        /* Stage 11 F4 decision: the Consultant title derives the
           SeniorDoctor profile — Doctor's SUPERSET plus the Consultant-
           tier observation authorities (correct/configure). v1 maps
           Consultant alone; widening (e.g. Specialist) is a row edit. */
        ["Consultant"] = "SeniorDoctor", ["Specialist"] = "Doctor", ["Senior Resident"] = "Doctor",
        ["Resident"] = "Doctor", ["Intern"] = "Doctor",
        ["Pharmacist"] = "Pharmacist", ["Clinical Pharmacist"] = "Pharmacist",
        ["Staff Nurse"] = "Nurse", ["Charge Nurse"] = "Nurse", ["Head Nurse"] = "Nurse",
        ["Laboratory Technician"] = "Ancillary", ["Radiology Technician"] = "Ancillary",
        ["Respiratory Therapist"] = "RespiratoryTherapist",
        ["Physiotherapist"] = "AlliedHealth", ["Dietitian"] = "AlliedHealth",
        ["Receptionist"] = "Administrator", ["Billing Officer"] = "Administrator",
        ["Medical Records Officer"] = "Administrator", ["Hospital Administrator"] = "Administrator",
        /* User Management design (§5): the System Administrator is IT/
           system — they manage WHO EXISTS and WHAT ACCESS they have, and
           get NO clinical access, ever (they control who may reach patient
           data; they do not reach it). The seeded "IT Administrator" title
           moves to this profile (it was always the IT role; deriving the
           office profile — which carries patients.view — contradicted the
           new principle), and "System Administrator" is the design's name
           for the same authority. */
        ["IT Administrator"] = "SystemAdministrator",
        ["System Administrator"] = "SystemAdministrator",
    };

    static readonly Dictionary<string, string[]> ProfilePermissions = new()
    {
        /* observations.record (Stage 11 §4, F1): charting a bedside value
           is BEDSIDE CLINICIAN authority — any doctor or nurse.
           patients.measure (Patient Weight & Height Capture): recording /
           correcting the patient's reference weight & height is likewise
           BEDSIDE CLINICIAN authority — doctor or nurse, per the design's
           §2 ("the admitting / bedside clinician — doctor / nurse; not
           restricted to senior tiers, and not the office Administrator
           profile"). Admission-time capture itself rides adt.admit (the
           fields are part of the admission payload); this atom gates the
           later add/correct path. NEVER on the office Administrator
           profile (the same F2/F3-style hard constraint: clinical data is
           clinically governed). */
        /* codestatus.set (Code Status governed vocabulary — the SAFETY
           FIX): recording a patient's resuscitation instruction is
           PHYSICIAN authority — any doctor (the goals-of-care discussion
           is a physician act; nurses render and act on it, never set it).
           NEVER on the office Administrator profile (the F2/F3 hard
           constraint). Admission-time selection rides adt.admit exactly
           as weight/height do; this atom gates the bedside set/change
           path. */
        ["Doctor"] = ["patients.view", "orders.view", "orders.create", "orders.sign",
            "orders.modify", "orders.discontinue", "results.view", "results.acknowledge",
            "results.document", "notes.document", "ai.view", "adt.admit", "adt.discharge",
            "observations.record", "patients.measure", "codestatus.set"],
        /* SeniorDoctor (Stage 11 F4): Doctor's SUPERSET — everything a
           doctor may do, plus the Consultant-tier observation authorities:
           observations.correct (tier-2 retrospective correction, §8) and
           observations.configure (group enablement, §3). HARD CONSTRAINT
           (§4): these NEVER sit on the office Administrator profile —
           clinical data and clinical configuration are clinically
           governed. */
        /* results.correct (Lab Result Editing): the Tier-2 lab-correction
           authority — Consultant-tier ONLY, mirroring observations.correct
           (and the same F2/F3 hard constraint: never on office
           Administrator). Tier-1 self-correction needs no atom of its own —
           it is results.document + being the documenter + the 5-min window,
           all decided server-side.
           labcatalog.manage on SeniorDoctor (Catalogue Test Management /
           Option B): a FLAGGED reconciliation — the design asked for a "new"
           Consultant-tier permission, but the atom already existed on
           Ancillary (the recorded Layer-4 producing-service governance, with
           a deployed suite asserting lab-tech access). Resolved ADDITIVELY:
           SeniorDoctor gains the atom ALONGSIDE Ancillary — consistent with
           the design's own §1 ("reference ranges are owned by the
           laboratory / clinical staff"). Nurse, non-senior doctor and office
           Administrator remain 403 (the F2/F3 hard constraint). Flipping to
           Consultant-ONLY would be removing the atom from Ancillary below —
           a conscious governance reversal, not made silently here. */
        /* assignments.manage (Assignment Simplification — the opt-out
           coverage model): carving and restoring NURSE coverage
           exceptions (doctors have no assignment concept — every doctor
           covers every patient). Deciding who nurses a patient is a
           CLINICAL care decision, so it can never sit on the office or
           System Administrator profiles. The validator's interim stands
           unchanged: SeniorDoctor holds it — in a real ICU the CHARGE
           NURSE carves these exceptions, and the recorded follow-up is a
           SeniorNurse profile row holding this SAME atom (the atom is
           the model — no schema change when that lands). */
        /* codestatus.manage (Code Status governed vocabulary): maintaining
           the vocabulary a hospital's resuscitation instructions are
           selected from is CLINICAL GOVERNANCE — Consultant tier only,
           the observations.configure precedent, and the same hard
           constraint: NEVER on the office Administrator profile. */
        /* beds.manage (Bed Registry design §3/§8.1 — the FLAGGED authority,
           VALIDATOR'S DECISION): a DISTINCT atom held by BOTH the
           SeniorDoctor (unit command runs the unit's bed layout) and the
           office Administrator (facility configuration). Beds are PLACES,
           not patient data — the locked clinical exclusion is untouched
           either way. */
        /* dispositions.manage / isolation.manage / shifts.manage
           (Configuration Vocabularies design §5 — per-domain atoms,
           stated): the discharge-outcome, IPC-isolation-type and working-
           shift vocabularies are CLINICAL/OPERATIONAL governance →
           SeniorDoctor, the codestatus.manage precedent — and the same
           hard constraint: NEVER on the office Administrator, never on
           the System Administrator. Setting a PATIENT's isolation is the
           separate bedside write riding observations.record (any doctor
           or nurse — the bedside-clinician atom), exactly as
           codestatus.set is separate from codestatus.manage.
           frequencies.manage sits on Pharmacist below (medication
           scheduling is formulary governance). */
        ["SeniorDoctor"] = ["patients.view", "orders.view", "orders.create", "orders.sign",
            "orders.modify", "orders.discontinue", "results.view", "results.acknowledge",
            "results.document", "results.correct", "labcatalog.manage", "ordersets.manage",
            "notes.document", "ai.view", "adt.admit", "adt.discharge", "observations.record",
            "observations.correct", "observations.configure", "patients.measure",
            "assignments.manage", "codestatus.set", "codestatus.manage", "imagingcatalog.manage",
            "beds.manage", "dispositions.manage", "isolation.manage", "shifts.manage"],
        ["Nurse"] = ["patients.view", "orders.view", "orders.implement", "meds.administer",
            "notes.document", "handoff.document", "results.view", "results.document", "ai.view", "adt.transfer",
            "observations.record", "patients.measure"],
        /* users.manage MOVED to the System Administrator (User Management
           design §5: the atoms are held ONLY by that role) — the office
           Administrator (receptionist/billing/records) keeps the
           administrative landing + the operational patient list but no
           longer manages accounts. A FLAGGED authority change, stated in
           the PR — the office profile held users.manage since Layer 3
           only because no IT/system role existed yet.
           identity.correct (Structured Patient Name + National ID design
           §3 — the FLAGGED authority, stated): correcting a patient's
           legal name / national identity number / DOB is REGISTRATION
           work, and identity is NOT clinical data — it fits the office
           profile's locked scope exactly (the clinical exclusion is
           untouched: no clinical atom is granted). Clinical profiles do
           not hold it — a serious audited identity event belongs to the
           role whose job is the registry.
           hospital.configure (Config Home + Hospital Identity design §3
           — the FLAGGED authority, stated): the hospital's name, unit
           name, short name and letterhead address are the
           ADMINISTRATIVE FACE of the institution and carry NO clinical
           data — so managing them is legitimately the office profile's
           (the identity.correct precedent), and the locked clinical
           exclusion is untouched. The administrative/clinical split,
           confirmed: administrative configuration → office
           Administrator; clinical vocabularies (codestatus.manage) →
           SeniorDoctor. The System Administrator does NOT hold this —
           they govern accounts, not the hospital's public identity. */
        /* beds.manage — see the SeniorDoctor comment above: the validator's
           decision grants it to BOTH profiles (unit command + facility
           administration). Beds carry no clinical data. */
        ["Administrator"] = ["admin.view", "patients.view", "identity.correct", "hospital.configure",
            "beds.manage"],
        /* the highest-privilege authority in the system: whoever holds it
           controls who can reach patient data — while never reaching it
           themselves (NO clinical atoms, not even patients.view; the
           locked office-Administrator clinical exclusion applies a
           fortiori here) */
        ["SystemAdministrator"] = ["users.manage", "users.view"],
        /* formulary.manage (Layer 4): maintaining the drug formulary is
           PHARMACY's authority — the same polarity flip as results.create
           on Ancillary (doctor/nurse/administrator tokens are 403'd on
           every formulary mutation; every profile may read).
           ordersets.manage moved to SENIORDOCTOR (owner decision,
           2026-07-20): an order set is a CLINICAL PROTOCOL (a sepsis
           bundle, a DKA protocol) — authoring one is a senior medical
           decision, not a pharmacy one. The Layer 4 phase 2 record had
           placed it here provisionally ("a future profile split costs a
           table edit") — this was that table edit. Pharmacy governance
           still applies where it belongs: every drug a set references
           must exist in the formulary Pharmacy maintains. APPLYING a set
           stays clinician authority (orders.create/orders.sign) — any
           ordering clinician, unchanged. */
        ["Pharmacist"] = ["patients.view", "orders.view", "results.view", "formulary.manage",
            "frequencies.manage"],
        ["RespiratoryTherapist"] = ["patients.view", "orders.view", "results.view", "ai.view"],
        /* results.create (results audit PR): entering a result is the
           PRODUCING SERVICE's authority — lab/radiology technicians — not
           the prescriber's (doctor/nurse tokens are 403'd on create, the
           same polarity flip as implement/administer/transfer). This is the
           future LIS-integration authority (an automated feed produces the
           result); it is DISTINCT from results.document below.
           ── results.document (Lab Result-Entry design): a SEPARATE atom for
           the manual documentation/transcription path — the ICU bedside team
           (Doctor/SeniorDoctor/Nurse) transcribing a paper central-lab
           report or entering a bedside ABG. The two authorities were kept
           apart on a conscious reconciliation (the design's open item #1):
           results.create stays the producing-service/LIS authority, and the
           human documentation path gets its own grant rather than
           repurposing results.create. */
        /* labcatalog.manage (Layer 4 phase 2): maintaining the lab test
           catalogue is the LABORATORY's authority — the producing-service
           principle behind results.create, kept as its OWN atom: entering
           a transactional result and redefining reference data are
           different authorities even while both sit on this profile */
        /* imagingcatalog.manage (Imaging Catalogue design §2 — the FLAGGED
           decision, stated): maintaining the imaging study catalogue is
           CLINICAL, on the lab-catalogue gating — Ancillary + SeniorDoctor
           — and NEVER the office Administrator. A DISTINCT atom rather
           than reusing labcatalog.manage (recommendation followed):
           radiology and the laboratory are different producing services,
           and a hospital may govern them separately later — that split is
           then a row edit here, no schema change. */
        ["Ancillary"] = ["patients.view", "orders.view", "results.view", "results.create", "labcatalog.manage", "imagingcatalog.manage"],
        ["AlliedHealth"] = ["patients.view", "results.view"],
    };

    /** the derived profile for a JobTitle, or null when the title is not
        one of the 20 recognized titles (Layer 3 uses this to validate
        titles and to classify clinical vs administrative grants) */
    public static string? ProfileOf(string jobTitle) => TitleProfile.GetValueOrDefault(jobTitle);

    public static bool Has(ClaimsPrincipal user, string permission) =>
        TitleProfile.TryGetValue(user.FindFirst("jobTitle")?.Value ?? "", out var profile)
        && ProfilePermissions[profile].Contains(permission);

    /** null when permitted; a generic 403 otherwise (never explains which
        permission was missing) */
    public static IResult? Deny(ClaimsPrincipal user, string permission) =>
        Has(user, permission) ? null
        : Results.Json(new { error = "Insufficient permissions" }, JsonOpts.Web, statusCode: 403);
}

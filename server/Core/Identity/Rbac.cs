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
        ["IT Administrator"] = "Administrator",
    };

    static readonly Dictionary<string, string[]> ProfilePermissions = new()
    {
        /* observations.record (Stage 11 §4, F1): charting a bedside value
           is BEDSIDE CLINICIAN authority — any doctor or nurse. */
        ["Doctor"] = ["patients.view", "orders.view", "orders.create", "orders.sign",
            "orders.modify", "orders.discontinue", "results.view", "results.acknowledge",
            "results.document", "notes.document", "ai.view", "adt.admit", "adt.discharge",
            "observations.record"],
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
           all decided server-side. */
        ["SeniorDoctor"] = ["patients.view", "orders.view", "orders.create", "orders.sign",
            "orders.modify", "orders.discontinue", "results.view", "results.acknowledge",
            "results.document", "results.correct", "notes.document", "ai.view", "adt.admit",
            "adt.discharge", "observations.record", "observations.correct", "observations.configure"],
        ["Nurse"] = ["patients.view", "orders.view", "orders.implement", "meds.administer",
            "notes.document", "results.view", "results.document", "ai.view", "adt.transfer",
            "observations.record"],
        ["Administrator"] = ["admin.view", "patients.view", "users.manage"],
        /* formulary.manage (Layer 4): maintaining the drug formulary is
           PHARMACY's authority — the same polarity flip as results.create
           on Ancillary (doctor/nurse/administrator tokens are 403'd on
           every formulary mutation; every profile may read).
           ordersets.manage (Layer 4 phase 2): order sets are protocol
           authorship, stewarded with the formulary in this provisional
           model — a distinct permission atom so a future profile split
           costs a table edit. APPLYING a set is clinician authority
           (orders.create/orders.sign), never this. */
        ["Pharmacist"] = ["patients.view", "orders.view", "results.view", "formulary.manage", "ordersets.manage"],
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
        ["Ancillary"] = ["patients.view", "orders.view", "results.view", "results.create", "labcatalog.manage"],
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

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
        ["Consultant"] = "Doctor", ["Specialist"] = "Doctor", ["Senior Resident"] = "Doctor",
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
        ["Doctor"] = ["patients.view", "orders.view", "orders.create", "orders.sign",
            "orders.modify", "orders.discontinue", "results.view", "results.acknowledge",
            "notes.document", "ai.view", "adt.admit", "adt.discharge"],
        ["Nurse"] = ["patients.view", "orders.view", "orders.implement", "meds.administer",
            "notes.document", "results.view", "ai.view", "adt.transfer"],
        ["Administrator"] = ["admin.view", "patients.view"],
        ["Pharmacist"] = ["patients.view", "orders.view", "results.view"],
        ["RespiratoryTherapist"] = ["patients.view", "orders.view", "results.view", "ai.view"],
        ["Ancillary"] = ["patients.view", "orders.view", "results.view"],
        ["AlliedHealth"] = ["patients.view", "results.view"],
    };

    public static bool Has(ClaimsPrincipal user, string permission) =>
        TitleProfile.TryGetValue(user.FindFirst("jobTitle")?.Value ?? "", out var profile)
        && ProfilePermissions[profile].Contains(permission);

    /** null when permitted; a generic 403 otherwise (never explains which
        permission was missing) */
    public static IResult? Deny(ClaimsPrincipal user, string permission) =>
        Has(user, permission) ? null
        : Results.Json(new { error = "Insufficient permissions" }, JsonOpts.Web, statusCode: 403);
}

using System.Text.Json;
using Aurora.Core.Shared;

namespace Aurora.Core.Identity;

/* ---- ICU Integration P1 — the OpenMRS role → ICU job-title map ----

   THE ONE PLACE a hospital identity becomes an ICU authority. It is
   CONFIGURATION, never code: the map is supplied through
   OPENMRS_ROLE_MAP (a JSON object) or a file named by
   OPENMRS_ROLE_MAP_FILE, and it is VALIDATED AT BOOT against the exact
   title set Rbac recognises. A title Rbac does not know refuses the
   boot outright (the BootGuards discipline: a misconfigured process
   must be loudly unusable, never quietly permissive).

   DENY BY DEFAULT, AND THE DEFAULT IS EMPTY. With no configuration at
   all the map is EMPTY and the bridge issues NO tokens to anyone —
   including administrators. That is deliberate: an integration that
   silently granted access the first time it booted would be the exact
   failure this design exists to prevent.

   NO CLINICAL MAPPING SHIPS. The only mapping this file will accept
   without an explicit hospital decision is the SYSTEM-ADMINISTRATOR
   one, and even that must be switched on by configuration
   (ICU_BRIDGE_ALLOW_SYSADMIN_DEFAULT=true). It is safe to offer
   because the SystemAdministrator profile holds
   users.manage/users.view/backup.* and NOT ONE clinical atom — not
   even patients.view — so it can prove the bridge works without ever
   reaching patient data (and in P1 the proxy does not expose the
   user-management or backup routes at all).

   🔴 MAPPING A HOSPITAL ROLE TO A CLINICAL TITLE GRANTS THAT TITLE'S
   WHOLE ICU PERMISSION SET. `Consultant` derives SeniorDoctor —
   observations.correct, codestatus.manage, beds.manage and the rest.
   This map is therefore a privilege-granting artifact with the same
   weight as Rbac.cs and needs the same review. Every clinical row is
   the hospital's decision to record, not this file's to assume. */
public static class IcuRoleMap
{
    /* The System Developer role is OpenMRS's superuser. It is NEVER
       mapped implicitly — a superuser silently becoming an ICU
       clinician is precisely the accident the deny-by-default rule
       exists to stop. It appears here only as the KEY the optional
       administrator default uses. */
    public const string SystemDeveloperRole = "System Developer";
    public const string SystemAdministratorTitle = "System Administrator";

    static Dictionary<string, string> _map = new(StringComparer.Ordinal);
    static bool _loaded;

    /** the resolved map (role name → ICU job title); empty until Load */
    public static IReadOnlyDictionary<string, string> Current => _map;

    /** Boot-time load + validation. Throws on ANY malformed entry so
        Program.cs can refuse the boot — a half-understood privilege map
        must never serve. */
    public static void LoadAndValidate(Func<string, string?> env)
    {
        var raw = env("OPENMRS_ROLE_MAP");
        if (string.IsNullOrWhiteSpace(raw))
        {
            var file = env("OPENMRS_ROLE_MAP_FILE");
            if (!string.IsNullOrWhiteSpace(file))
            {
                if (!File.Exists(file))
                    throw new InvalidOperationException(
                        $"OPENMRS_ROLE_MAP_FILE points at '{file}', which does not exist. " +
                        "A role map that cannot be read must not be guessed at.");
                raw = File.ReadAllText(file);
            }
        }

        var map = new Dictionary<string, string>(StringComparer.Ordinal);
        if (!string.IsNullOrWhiteSpace(raw))
        {
            Dictionary<string, string>? parsed;
            try
            {
                parsed = JsonSerializer.Deserialize<Dictionary<string, string>>(raw, JsonOpts.Web);
            }
            catch (JsonException e)
            {
                throw new InvalidOperationException(
                    "the OpenMRS role map is not a JSON object of {\"<openmrs role>\": \"<ICU job title>\"}: " + e.Message);
            }
            foreach (var (role, title) in parsed ?? new())
            {
                if (string.IsNullOrWhiteSpace(role))
                    throw new InvalidOperationException("the role map contains an empty OpenMRS role name");
                if (string.IsNullOrWhiteSpace(title))
                    throw new InvalidOperationException(
                        $"the role map leaves OpenMRS role '{role}' without an ICU job title. " +
                        "Remove the row to deny it — an empty title is not a denial, it is an ambiguity.");
                /* THE GATE: only titles Rbac actually derives a profile
                   from. A typo would otherwise produce an account that
                   authenticates and then 403s on everything, which reads
                   as a broken integration rather than a broken config. */
                if (Rbac.ProfileOf(title) is null)
                    throw new InvalidOperationException(
                        $"the role map sends OpenMRS role '{role}' to ICU job title '{title}', which ICU does not recognise. " +
                        $"Recognised titles: {string.Join(", ", Rbac.RecognisedTitles)}.");
                map[role] = title;
            }
        }

        /* the OPTIONAL administrator default — off unless asked for, and
           it can never introduce a clinical grant */
        if (string.Equals(env("ICU_BRIDGE_ALLOW_SYSADMIN_DEFAULT"), "true", StringComparison.OrdinalIgnoreCase)
            && !map.ContainsKey(SystemDeveloperRole))
            map[SystemDeveloperRole] = SystemAdministratorTitle;

        _map = map;
        _loaded = true;
    }

    /** the ICU job title for a set of OpenMRS role names, or null when
        NONE of them is mapped (→ the bridge denies).

        DETERMINISTIC BY CONSTRUCTION: OpenMRS accounts routinely hold
        several roles while an ICU session carries exactly ONE jobTitle,
        so an ambiguous answer would silently pick a clinical authority.
        Resolution is therefore: collect every mapped title; if they all
        agree, use it; if they disagree, DENY and say so. Precedence
        ("most privileged wins") is deliberately NOT invented here — the
        hospital decides that, by not mapping two roles to conflicting
        titles. */
    public static RoleResolution Resolve(IEnumerable<string> openmrsRoles)
    {
        if (!_loaded)
            return RoleResolution.Denied("the ICU role map has not been loaded");
        var titles = openmrsRoles
            .Where(r => !string.IsNullOrWhiteSpace(r))
            .Select(r => _map.GetValueOrDefault(r))
            .Where(t => t is not null)
            .Select(t => t!)
            .Distinct(StringComparer.Ordinal)
            .ToList();
        if (titles.Count == 0)
            return RoleResolution.Denied("no ICU access is configured for this account's hospital roles");
        if (titles.Count > 1)
            return RoleResolution.Denied(
                "this account's hospital roles map to more than one ICU job title, which is ambiguous — " +
                "ICU acts as exactly one role per session. Ask an administrator to resolve the role map.");
        return RoleResolution.Allowed(titles[0]);
    }
}

public readonly record struct RoleResolution(string? JobTitle, string? Reason)
{
    public bool Ok => JobTitle is not null;
    public static RoleResolution Allowed(string title) => new(title, null);
    public static RoleResolution Denied(string reason) => new(null, reason);
}

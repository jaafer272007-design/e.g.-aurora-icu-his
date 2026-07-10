using System.Text.Json;
using Aurora.Core.MasterData;
using Aurora.Core.Persistence;
using Aurora.Core.Shared;
using Microsoft.EntityFrameworkCore;

namespace Aurora.Core.Orders;

/* ---------- SERVER-SIDE MEDICATION SAFETY (the safety.ts move) ----------
   The allergy/interaction/duplicate checks that ran only client-side
   (src/lib/api/safety.ts) are ENFORCED here at order creation — a client
   that skips its own check is still caught; the client's copy remains for
   immediate UX, the server is authoritative. Data comes from Layer 4
   master data: the drug's allergyBlock/allergyWarn tags and the pairwise
   InteractionRules table.

   THE MODEL (mirrors the client's semantics exactly):
   - HARD BLOCK, never overridable → 409: an allergyBlock tag matching
     the patient's documented allergy field, or a severity-"block"
     interaction rule against an ACTIVE medication order on the OPEN
     encounter (e.g. duplicate therapeutic anticoagulation). 409, not
     400: the block is resource state — updating the patient's allergy
     record or discontinuing the interacting order lets the same request
     succeed.
   - WARN, overridable with an audited justification → 409 WITHOUT an
     overrideJustification on the request; proceeds WITH one, and the
     override + every warning it acknowledges is appended to the order's
     audit history (the acknowledged-override pattern from Layer 3's
     clinical-title justification and the client's own ack flow):
     allergyWarn cross-reactivity tags, severity-"warn" interaction
     rules, and duplicate therapy (the same drug already active).

   Scope notes (documented): checks run on CREATE (incl. order-set apply,
   which calls the same path). The modify path validates formulary
   authority (unknown/inactive drugId) but does not re-run allergy/
   interaction screening — recorded follow-up scope. Duplicates are
   checked against PERSISTED active orders; two drafts for the same drug
   inside one batch do not see each other (the client-side check has the
   same property). */
static class SafetyLogic
{
    public record Issue(string Kind, string Severity, string Message);

    public static List<Issue> Check(AuroraDb db, string patientId, string openEncounterId, MedicationDto med)
    {
        var issues = new List<Issue>();
        var drug = FormularyLogic.Resolve(db, med.DrugId)!; // formulary authority guarantees resolution
        var allergyField = db.AdtPatients.AsNoTracking()
            .Where(p => p.PatientId == patientId).Select(p => p.Allergies).First();
        var allergies = !string.IsNullOrWhiteSpace(allergyField)
            && !allergyField.Contains("none known", StringComparison.OrdinalIgnoreCase)
            ? allergyField : "";

        if (allergies.Length > 0)
        {
            foreach (var tag in Tags(drug.AllergyBlockJson))
            {
                if (allergies.Contains(tag, StringComparison.OrdinalIgnoreCase))
                    issues.Add(new("allergy", "block",
                        $"Documented allergy: \"{allergyField}\" — {drug.Name} is contraindicated ({tag})."));
            }
            foreach (var tag in Tags(drug.AllergyWarnJson))
            {
                if (allergies.Contains(tag, StringComparison.OrdinalIgnoreCase))
                    issues.Add(new("allergy", "warn",
                        $"Documented allergy: \"{allergyField}\" — possible cross-reactivity with {drug.Name} ({tag})."));
            }
        }

        /* interactions + duplicates check the ACTIVE medication orders on
           the OPEN encounter (the encounter-aware working set — discharge
           already discontinues prior-episode actives) */
        var actives = db.Orders.AsNoTracking()
            .Where(o => o.PatientId == patientId && o.EncounterId == openEncounterId
                && o.Status == "active" && o.MedicationJson != null)
            .AsEnumerable()
            .Select(o => (o.OrderId, Med: JsonSerializer.Deserialize<MedicationDto>(o.MedicationJson!, JsonOpts.Web)!))
            .ToList();
        var rules = db.InteractionRules.AsNoTracking().OrderBy(r => r.Id).ToList();
        foreach (var (orderId, active) in actives)
        {
            if (active.DrugId == drug.DrugId)
            {
                issues.Add(new("duplicate", "warn",
                    $"Duplicate therapy: {active.Drug} {active.Dose} is already active ({orderId})."));
                continue;
            }
            foreach (var r in rules)
            {
                if ((r.A == drug.DrugId && r.B == active.DrugId) || (r.B == drug.DrugId && r.A == active.DrugId))
                    issues.Add(new("interaction", r.Severity,
                        $"Interaction with active {active.Drug}: {r.Note}"));
            }
        }
        return issues;
    }

    static List<string> Tags(string json) =>
        JsonSerializer.Deserialize<List<string>>(json, JsonOpts.Web)!;
}

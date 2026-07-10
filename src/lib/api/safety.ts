import type { FormularyDrug, InteractionRule, Order, SafetyIssue } from './types'

/* Medication safety checks — allergy, interaction, duplicate therapy.
   Runs client-side for immediate feedback; since the safety-enforcement
   PR the server RE-RUNS these checks on POST /orders (SafetyLogic) and
   is authoritative — a client that skips this screen is still caught
   (hard blocks 409, warn-level requires the audited override). */

const normalize = (s: string) => s.toLowerCase()

/** Match a formulary allergy tag against the patient's free-text allergy field. */
const allergyMatches = (allergyField: string, tag: string) =>
  normalize(allergyField).includes(normalize(tag))

export function checkMedicationSafety(
  drug: FormularyDrug,
  patientAllergies: string,
  activeOrders: Order[],
  rules: InteractionRule[],
): SafetyIssue[] {
  const issues: SafetyIssue[] = []
  const allergies = patientAllergies && !/none known/i.test(patientAllergies) ? patientAllergies : ''

  if (allergies) {
    for (const tag of drug.allergyBlock) {
      if (allergyMatches(allergies, tag)) {
        issues.push({
          kind: 'allergy', severity: 'block',
          message: `Documented allergy: "${patientAllergies}" — ${drug.name} is contraindicated (${tag}).`,
        })
      }
    }
    for (const tag of drug.allergyWarn) {
      if (allergyMatches(allergies, tag)) {
        issues.push({
          kind: 'allergy', severity: 'warn',
          message: `Documented allergy: "${patientAllergies}" — possible cross-reactivity with ${drug.name} (${tag}).`,
        })
      }
    }
  }

  const activeMeds = activeOrders.filter(o => o.status === 'active' && o.medication)
  for (const o of activeMeds) {
    const otherId = o.medication!.drugId
    if (otherId === drug.drugId) {
      issues.push({
        kind: 'duplicate', severity: 'warn',
        message: `Duplicate therapy: ${o.medication!.drug} ${o.medication!.dose} is already active (${o.orderId}).`,
      })
      continue
    }
    for (const r of rules) {
      if ((r.a === drug.drugId && r.b === otherId) || (r.b === drug.drugId && r.a === otherId)) {
        issues.push({
          kind: 'interaction', severity: r.severity,
          message: `Interaction with active ${o.medication!.drug}: ${r.note}`,
        })
      }
    }
  }

  /* blocks first, then warnings */
  return issues.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'block' ? -1 : 1))
}

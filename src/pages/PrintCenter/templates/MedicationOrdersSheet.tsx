import { MedTable, Section, SignatureBlock } from '../primitives'
import type { MedicationOrdersData } from '../types'

/** Contract #4 — Medication Orders. The current prescriptions in full
 *  detail (dose / route / frequency / duration / PRN, ordering
 *  clinician and time), rendered ONLY from the persisted order record —
 *  the byte-stability guarantee: deactivating a drug in the live
 *  formulary must not change this printout. Unsigned prescriptions
 *  print separately and are labeled as not in force. */
export function MedicationOrdersSheet({ data }: { data: MedicationOrdersData }) {
  const { context, activeMeds, pendingMeds } = data
  const mark = context.hasChartedTimes ? ' †' : ''
  return (
    <>
      <Section title={`Active medication orders${mark}`}>
        <MedTable meds={activeMeds} chartedMark={mark} />
      </Section>

      {pendingMeds.length > 0 && (
        <Section title={`Awaiting signature — NOT in force${mark}`}>
          <MedTable meds={pendingMeds} chartedMark={mark} />
        </Section>
      )}

      <Section title="Prescriber" keepTogether>
        <SignatureBlock role="Physician" />
      </Section>
    </>
  )
}

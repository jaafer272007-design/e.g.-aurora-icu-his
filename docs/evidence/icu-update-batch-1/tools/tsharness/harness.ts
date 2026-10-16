// Deterministic-clock harness over the REAL client modules: the mock
// adapter's write (applyAdministration) + read (deriveMarRows) and the
// Orders screen's next-dose chip (nextExpectedDose), all via lib/marSchedule.ts.
import { clock } from './clock'
import { readFileSync } from 'node:fs'
import { applyAdministration, applyModify, deriveMarRows, insertOrder } from '/home/user/e.g.-aurora-icu-his/src/lib/api/data/orders.ts'
import { nextExpectedDose } from '/home/user/e.g.-aurora-icu-his/src/lib/marSchedule.ts'
import type { MedAdministration } from '/home/user/e.g.-aurora-icu-his/src/lib/api/types.ts'

const ms = (s: string) => Date.parse(s.replace(' ', 'T') + ':00Z')
const scenarios = JSON.parse(readFileSync(process.argv[2], 'utf8'))
const out: unknown[] = []
let n = 0
for (const sc of scenarios) {
  const pid = `P-H${++n}`
  clock.now = ms(sc.signed)
  const prn = !!sc.prn
  const o = insertOrder({
    patientId: pid, category: 'Medication', priority: 'Routine',
    medication: { drugId: 'drug-x', drug: 'Synthetic Drug', dose: '1 mg', route: 'IV', frequency: sc.frequency, duration: 'ongoing', prn, prnIndication: prn ? 'pain' : undefined },
  } as never, 'Dr Synthetic', true, 'Harness Patient', 'B-T')
  /* dated therapy start (the mock's own insertOrder stamps bare HH:mm — the
     separate, out-of-scope timestamp finding; the server stamps dated) */
  o.history = [{ time: sc.signed, actor: 'Dr Synthetic', action: 'signed' }]
  if (sc.legacyFacts) o.administrations = sc.legacyFacts as MedAdministration[]
  const steps: unknown[] = []
  for (const st of sc.steps) {
    if (st.read) {
      clock.now = ms(st.read)
      const rows = deriveMarRows([pid]).map(r => ({
        adminId: r.adminId.startsWith('ADM') ? 'FACT' : r.adminId, scheduledTime: r.scheduledTime, status: r.status,
        documentedTime: r.documentedTime ?? null, missedEarlier: r.missedEarlier ?? null, scheduleAnchor: r.scheduleAnchor ?? null,
      }))
      steps.push({ read: st.read, rows, nextDose: nextExpectedDose(o, clock.now) })
    } else if (st.modify) {
      clock.now = ms(st.at)
      applyModify(o.orderId, { frequency: st.modify }, 'harness', 'Dr Synthetic')
      steps.push({ modify: st.modify })
    } else {
      clock.now = ms(st.at)
      const before = (o.administrations ?? []).length
      const r = applyAdministration(o.orderId, st.doc, st.action, 'Harness Nurse', st.reason, st.administeredAt)
      const fact = r ? r.administrations![before] : null
      steps.push({ doc: st.doc, action: st.action, at: st.at, result: r ? (fact?.scheduleAnchor ? `ok(anchor ${fact.scheduleAnchor})` : 'ok') : 'rejected' })
    }
  }
  out.push({ name: sc.name, steps })
}
console.log(JSON.stringify(out, null, 2))

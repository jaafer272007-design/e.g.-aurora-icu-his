// Deterministic-clock harness over the REAL client modules: the mock
// adapter's write (applyAdministration) + read (deriveMarRows) and the
// Orders screen's next-dose chip (nextExpectedDose), all via
// lib/marSchedule.ts currentRound — the client mirror of the server rule.
import { clock } from './clock'
import { readFileSync } from 'node:fs'
import { applyAdministration, applyDiscontinue, applyModify, deriveMarRows, insertOrder } from '/home/user/e.g.-aurora-icu-his/src/lib/api/data/orders.ts'
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
  if (sc.legacyFacts) o.administrations = JSON.parse(JSON.stringify(sc.legacyFacts)) as MedAdministration[]
  const rows = () => deriveMarRows([pid]).map(r => ({
    adminId: r.adminId.startsWith('ADM-') && !(sc.legacyFacts ?? []).some((f: MedAdministration) => f.adminId === r.adminId) ? 'FACT' : (r.adminId.startsWith('ADM-') ? 'FACT' : r.adminId),
    scheduledTime: r.scheduledTime, status: r.status,
    documentedTime: r.documentedTime ?? null, round: r.round ?? null,
    timerFrom: r.timerFrom ?? null, timerRule: r.timerRule ?? null,
  }))
  const steps: unknown[] = []
  let last: string | null = null
  for (const st of sc.steps) {
    if (st.read) {
      clock.now = ms(st.read)
      steps.push({ read: st.read, rows: rows(), nextDose: nextExpectedDose(o, clock.now) })
    } else if (st.modify) {
      clock.now = ms(st.at)
      applyModify(o.orderId, { frequency: st.modify }, 'harness', 'Dr Synthetic')
      steps.push({ modify: st.modify })
    } else if (st.discontinue) {
      clock.now = ms(st.at)
      applyDiscontinue(o.orderId, 'harness', 'Dr Synthetic')
      steps.push({ discontinue: true })
    } else if (st.csOnly) {
      /* a server-only rule (the delay reason — the MAR card enforces it
         client-side before calling); the mock adapter does not replay it */
      steps.push({ doc: st.doc, id: null, action: st.action, at: st.at, result: 'server-only', next: null, nextId: null })
    } else {
      clock.now = ms(st.at)
      const id = st.doc === 'current'
        ? deriveMarRows([pid]).find(r => r.status === 'scheduled' && r.adminId !== 'ondemand')?.adminId ?? 'none'
        : st.doc === 'last' ? (last as string) : st.doc
      const r = applyAdministration(o.orderId, id, st.action, 'Harness Nurse', st.reason, st.administeredAt)
      if (r) last = id
      const next = deriveMarRows([pid]).find(x => x.status === 'scheduled' && x.round !== undefined)
      steps.push({ doc: st.doc, id, action: st.action, at: st.at, result: r ? 'ok' : 'rejected', next: next?.scheduledTime ?? null, nextId: next?.adminId ?? null })
    }
  }
  out.push({ name: sc.name, steps })
}
console.log(JSON.stringify(out, null, 2))

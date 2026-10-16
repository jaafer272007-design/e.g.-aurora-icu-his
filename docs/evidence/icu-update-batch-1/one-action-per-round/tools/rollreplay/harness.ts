// Deterministic-clock harness over the REAL client modules: the mock
// adapter's write (applyAdministration) + read (deriveMarRows) and the
// Orders screen's next-dose chip (nextExpectedDose), all via
// lib/marSchedule.ts currentRound — the client mirror of the server rule.
// [2026-10-05 — superseding copy of correction/tools/rollts/harness.ts for
// ONE ACTION PER ROUND; the original is kept unchanged with its logs. Two
// changes, both in the documentation step: (1) applyAdministration now
// returns the refusal wording (a string) instead of null, so a string is
// read as REJECTED; (2) these 25 scenarios (2026-09-30) replay facts recorded
// under the earlier rules, which allowed a round to be documented before its
// time — such facts can be in stored data, and the unchanged timer rule must
// replay them unchanged. A step the new gate refuses ("is not due until") is
// therefore LOADED as the stored fact the pre-gate mock wrote (the same
// fields, the same audit wording — loadPreGateFact below) and counted in
// gateRefusedSteps. The C# side (correction/tools/rollharness) replays the
// pre-gate endpoint branches as before, so both sides replay identical facts.]
import { clock } from './clock'
import { readFileSync } from 'node:fs'
import { applyAdministration, applyDiscontinue, applyModify, deriveMarRows, insertOrder } from '/home/user/e.g.-aurora-icu-his/src/lib/api/data/orders.ts'
import { currentRound, firstDoseEpoch, instanceStamp, isFact, nextExpectedDose, parseFrequency, therapyStartEpoch, timerInstant } from '/home/user/e.g.-aurora-icu-his/src/lib/marSchedule.ts'
import { dueStateFor } from '/home/user/e.g.-aurora-icu-his/src/lib/time.ts'
import type { MedAdministration, Order } from '/home/user/e.g.-aurora-icu-his/src/lib/api/types.ts'

/* the pre-gate mock's write, verbatim in effect (src/lib/api/data/orders.ts
   applyAdministration at dacab4e, after its identity checks — which the
   gate's refusal proves passed): append the round's fact, then the audit
   entry with the same timer note */
let gateRefusedSteps = 0, preGateFactSeq = 0
function loadPreGateFact(o: Order, action: 'given' | 'held' | 'refused', actor: string, reason?: string, administeredAt?: string) {
  const nowMs = Date.now()
  const m = o.medication!
  const kind = parseFrequency(m)
  const hours = kind.kind === 'interval' ? kind.hours : 0   // the gate refuses only rounds, i.e. interval orders
  const first = firstDoseEpoch(therapyStartEpoch(o, nowMs) as number)
  const cur = currentRound(first, hours, (o.administrations ?? []).filter(isFact), nowMs)
  const time = instanceStamp(Math.floor(nowMs / 60_000) * 60_000)
  const fact = {
    adminId: `ADM-PG${++preGateFactSeq}`, scheduledTime: instanceStamp(cur.dueMs), status: action,
    documentedTime: action === 'given' && administeredAt ? administeredAt : time, documentedBy: actor,
    ...(reason?.trim() ? { reason: reason.trim() } : {}), round: cur.number,
  }
  o.administrations = [...(o.administrations ?? []), fact]
  const next = currentRound(first, hours, o.administrations.filter(isFact), nowMs)
  const from = timerInstant(fact) === next.timerFromMs && next.timerRule === (action === 'given' ? 'given' : 'skipped')
    ? (action === 'given' ? 'from the actual administration time' : "from the skipped dose's scheduled time")
    : `timer unchanged — ${next.timerRule === 'given' ? 'the administration at' : 'the skipped dose due'} ${instanceStamp(next.timerFromMs as number)} already set it; an older time never rewinds it`
  o.history.push({
    time, actor, action: action === 'given' ? 'administered' : action,
    detail: `${fact.scheduledTime} dose ${action} at ${fact.documentedTime} — round ${cur.number}; next round due ${instanceStamp(next.dueMs)} (${m.frequency} ${from})${reason?.trim() ? ` — ${reason.trim()}` : ''}`,
  })
}

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
      /* the MAR card's / Meds Due KPI's own due-count predicate */
      const dueCount = deriveMarRows([pid]).filter(r => r.status === 'scheduled' && !r.prn && dueStateFor(r.scheduledTime, new Date(clock.now)) !== 'upcoming').length
      steps.push({ read: st.read, rows: rows(), nextDose: nextExpectedDose(o, clock.now), dueCount })
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
      let ok = typeof r !== 'string'   // a refusal is its wording now (formerly null)
      if (!ok && (r as string).includes('is not due until')) {
        loadPreGateFact(o, st.action, 'Harness Nurse', st.reason, st.administeredAt)   // a stored pre-gate fact
        gateRefusedSteps++
        ok = true
      }
      if (ok) last = id
      const next = deriveMarRows([pid]).find(x => x.status === 'scheduled' && x.round !== undefined)
      steps.push({ doc: st.doc, id, action: st.action, at: st.at, result: ok ? 'ok' : 'rejected', next: next?.scheduledTime ?? null, nextId: next?.adminId ?? null, note: ok ? o.history[o.history.length - 1].detail ?? null : null })
    }
  }
  out.push({ name: sc.name, steps })
}
console.log(JSON.stringify(out, null, 2))
console.error(`gate-refused scenario steps loaded as stored pre-gate facts: ${gateRefusedSteps}`)

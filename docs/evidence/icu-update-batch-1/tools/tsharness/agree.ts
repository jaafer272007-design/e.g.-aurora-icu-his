// Agreement over a LIVE snapshot (real server + PostgreSQL): the server's
// GET /api/icu/mar vs the client's Orders next-dose chip (nextExpectedDose
// over GET /api/icu/orders), the Meds-Due count (NurseWorkspace/MarCard
// formula) and the printed MAR cells (PrintCenter buildMar's cell mapping).
import { clock } from './clock'
import { readFileSync } from 'node:fs'
import { nextExpectedDose } from '/home/user/e.g.-aurora-icu-his/src/lib/marSchedule.ts'
import { dueStateFor } from '/home/user/e.g.-aurora-icu-his/src/lib/time.ts'
import type { MarRow, Order } from '/home/user/e.g.-aurora-icu-his/src/lib/api/types.ts'
const snap = JSON.parse(readFileSync(process.argv[2], 'utf8')) as { now: string; mar: MarRow[]; orders: Order[] }
clock.now = Date.parse(snap.now.replace(' ', 'T') + ':00Z')
const now = new Date(clock.now)
let fails = 0
for (const o of snap.orders.filter(x => x.medication)) {
  const rows = snap.mar.filter(r => r.orderId === o.orderId)
  const pending = rows.filter(r => (r.status === 'scheduled' || r.status === 'missed-earlier') && r.adminId !== 'prn' && r.adminId !== 'ondemand')
  const serverEarliest = pending.length ? pending[0].scheduledTime : null
  const chip = nextExpectedDose(o, clock.now)
  /* print: buildMar's cells = administrations kept while active (facts) */
  const printCells = (o.administrations ?? []).filter(a => a.status !== 'scheduled' || o.status === 'active').map(a => `${a.scheduledTime}|${a.status}|${a.scheduleAnchor ?? ''}`)
  const marFacts = rows.filter(r => r.status === 'given' || r.status === 'held' || r.status === 'refused').map(r => `${r.scheduledTime}|${r.status}|${r.scheduleAnchor ?? ''}`)
  /* same facts; print keeps recording order, the MAR sorts by time (both pre-existing) */
  const ok = chip === serverEarliest && JSON.stringify([...printCells].sort()) === JSON.stringify([...marFacts].sort())
  if (!ok) fails++
  console.log(`${ok ? 'PASS' : 'FAIL'} ${o.orderId} ${o.medication!.frequency.padEnd(5)} status=${o.status.padEnd(12)} server-earliest=${serverEarliest} orders-chip=${chip} print-cells=${printCells.length}=mar-facts=${marFacts.length}`)
}
const due = snap.mar.filter(r => r.status === 'scheduled' && !r.prn && dueStateFor(r.scheduledTime, now) !== 'upcoming').length
console.log(`Meds-Due count over the live MAR at ${snap.now}: ${due} (MarCard aside + NurseWorkspace KPI use this same filter over these rows)`)
console.log(fails ? `AGREEMENT FAILED (${fails})` : 'AGREEMENT PASSED')
process.exit(fails ? 1 : 0)

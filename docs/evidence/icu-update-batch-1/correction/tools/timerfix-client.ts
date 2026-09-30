// The REAL client modules over orders + MAR rows returned by the live
// server (api-check-timerfix.py): the Orders screen's next-dose chip and the
// printed MAR's "next dose due" (both nextExpectedDose — PrintCenter
// selectors.ts buildMar calls it), the printed cells' rounds (buildMar maps
// each stored fact's round straight through), and the MAR card / Meds-Due
// KPI count predicate (dueStateFor).
import { readFileSync } from 'node:fs'
import { nextExpectedDose } from '/home/user/e.g.-aurora-icu-his/src/lib/marSchedule.ts'
import { dueStateFor } from '/home/user/e.g.-aurora-icu-his/src/lib/time.ts'
import type { MarRow, Order } from '/home/user/e.g.-aurora-icu-his/src/lib/api/types.ts'

const { orders, mar, nowMs } = JSON.parse(readFileSync(process.argv[2], 'utf8')) as { orders: Order[]; mar: MarRow[]; nowMs: number }
const next: Record<string, string | null> = {}
const printRounds: Record<string, (number | null)[]> = {}
for (const o of orders) {
  next[o.orderId] = nextExpectedDose(o, nowMs)
  printRounds[o.orderId] = (o.administrations ?? []).filter(a => a.status !== 'scheduled' || o.status === 'active').map(a => a.round ?? null)
}
const dueRows = mar.filter(r => r.status === 'scheduled' && !r.prn && dueStateFor(r.scheduledTime, new Date(nowMs)) !== 'upcoming').map(r => r.orderId)
console.log(JSON.stringify({ next, printRounds, dueCount: dueRows.length, dueRows }))

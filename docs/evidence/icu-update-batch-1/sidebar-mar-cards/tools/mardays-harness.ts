// Deterministic check of the DAILY PRESCRIPTION CARD rules over the REAL
// client modules (src/pages/NurseWorkspace/marDays.ts + src/lib/time.ts),
// hospital clock = Asia/Baghdad (UTC+3, as the server reports it), with
// explicit "now" instants either side of hospital midnight. Synthetic MAR
// rows only, shaped exactly like GET /api/icu/mar rows (UTC wire stamps).
import { setServerClock, dueStateFor } from '/home/user/e.g.-aurora-icu-his/src/lib/time.ts'
import { groupMarDays, stampOnCard, dayLabel, isActionable } from '/home/user/e.g.-aurora-icu-his/src/pages/NurseWorkspace/marDays.ts'
import type { MarRow } from '/home/user/e.g.-aurora-icu-his/src/lib/api/types.ts'

setServerClock('Asia/Baghdad', 180)
let passes = 0, fails = 0
const check = (c: boolean, m: string) => { console.log((c ? '  PASS ' : '  FAIL ') + m); c ? passes++ : fails++ }
const ms = (utc: string) => Date.parse(utc.replace(' ', 'T') + ':00Z')
const P = 'P-SYN'
const row = (orderId: string, adminId: string, scheduledTime: string, status: MarRow['status'], x: Partial<MarRow> = {}): MarRow => ({
  orderId, adminId, patientId: P, bedId: 'B-01', medication: x.medication ?? `Drug ${orderId}`, dose: '1 mg',
  route: x.route ?? 'IV · q4h', scheduledTime, prn: false, status, ...x,
})
// ---- synthetic rows (UTC wire stamps; hospital = UTC+3) ----
const rows: MarRow[] = [
  // A: q1h, three rounds inside hospital day 2026-10-05 whose UTC date is still 2026-10-04
  row('ORD-A', 'ADM-1', '2026-10-04 21:00', 'given', { round: 1, documentedTime: '2026-10-04 21:02', route: 'IV · q1h', medication: 'Noradrenaline-syn' }),
  row('ORD-A', 'ADM-2', '2026-10-04 22:02', 'held', { round: 2, documentedTime: '2026-10-04 22:00', reason: 'synthetic: MAP 92', route: 'IV · q1h', medication: 'Noradrenaline-syn' }),
  row('ORD-A', '2026-10-04T23:02~r3', '2026-10-04 23:02', 'scheduled', { round: 3, timerFrom: '2026-10-04 22:02', timerRule: 'skipped', route: 'IV · q1h', medication: 'Noradrenaline-syn' }),
  // B1/B2: two prescriptions, SAME medication name, same day
  row('ORD-B1', 'ADM-3', '2026-10-04 21:30', 'given', { round: 1, documentedTime: '2026-10-04 21:31', medication: 'Paracetamol-syn' }),
  row('ORD-B1', '2026-10-05 01:31~r2'.replace(' ', 'T'), '2026-10-05 01:31', 'scheduled', { round: 2, timerFrom: '2026-10-04 21:31', timerRule: 'given', medication: 'Paracetamol-syn' }),
  row('ORD-B2', 'ADM-4', '2026-10-04 22:00', 'given', { round: 1, documentedTime: '2026-10-04 22:00', medication: 'Paracetamol-syn' }),
  row('ORD-B2', '2026-10-05T02:00~r2', '2026-10-05 02:00', 'scheduled', { round: 2, timerFrom: '2026-10-04 22:00', timerRule: 'given', medication: 'Paracetamol-syn' }),
  // C: yesterday's OUTSTANDING round (due 22:00 hospital 10-04), round 1 given 18:00 hospital 10-04
  row('ORD-C', 'ADM-5', '2026-10-04 15:00', 'given', { round: 1, documentedTime: '2026-10-04 15:00', medication: 'Ceftriaxone-syn' }),
  row('ORD-C', '2026-10-04T19:00~r2', '2026-10-04 19:00', 'scheduled', { round: 2, timerFrom: '2026-10-04 15:00', timerRule: 'given', medication: 'Ceftriaxone-syn' }),
  // D: q24h given 01:30 hospital 10-05 → current round due TOMORROW 01:30 hospital 10-06
  row('ORD-D', 'ADM-6', '2026-10-04 22:00', 'given', { round: 1, documentedTime: '2026-10-04 22:30', route: 'PO · daily', medication: 'Aspirin-syn' }),
  row('ORD-D', '2026-10-05T22:30~r2', '2026-10-05 22:30', 'scheduled', { round: 2, timerFrom: '2026-10-04 22:30', timerRule: 'given', route: 'PO · daily', medication: 'Aspirin-syn' }),
  // E: scheduled 23:00 hospital 10-04, GIVEN 00:20 hospital 10-05 (late, reason) → stays in 10-04's card
  row('ORD-E', 'ADM-7', '2026-10-04 20:00', 'given', { round: 1, documentedTime: '2026-10-04 21:20', reason: 'synthetic: CT transfer', route: 'IV · q6h', medication: 'Pantoprazole-syn' }),
  row('ORD-E', '2026-10-05T03:20~r2', '2026-10-05 03:20', 'scheduled', { round: 2, timerFrom: '2026-10-04 21:20', timerRule: 'given', route: 'IV · q6h', medication: 'Pantoprazole-syn' }),
  // F: PRN — doses on two hospital days + today's availability
  row('ORD-F', 'ADM-8', '', 'given', { prn: true, documentedTime: '2026-10-04 18:00', route: 'IV · PRN — pain', medication: 'Morphine-syn' }),
  row('ORD-F', 'ADM-9', '', 'given', { prn: true, documentedTime: '2026-10-04 22:00', route: 'IV · PRN — pain', medication: 'Morphine-syn' }),
  row('ORD-F', 'prn', '', 'scheduled', { prn: true, route: 'IV · PRN — pain', medication: 'Morphine-syn' }),
  // G: continuous / on-demand — a dose on 10-03 hospital + today's availability
  row('ORD-G', 'ADM-10', '', 'given', { documentedTime: '2026-10-03 10:00', route: 'IV · continuous', medication: 'Insulin infusion-syn' }),
  row('ORD-G', 'ondemand', '', 'scheduled', { scheduleNote: 'continuous — no derivable schedule; document on demand', route: 'IV · continuous', medication: 'Insulin infusion-syn' }),
  // H: undated LEGACY history
  row('ORD-H', 'ADM-11', '08:00', 'given', { documentedTime: '08:05', route: 'PO · bid', medication: 'Legacy-syn' }),
  row('ORD-H', 'ADM-12', 'D-1 20:00', 'refused', { documentedTime: 'D-1 20:10', reason: 'synthetic: declined', route: 'PO · bid', medication: 'Legacy-syn' }),
  // I: discontinued order — history only
  row('ORD-I', 'ADM-13', '2026-10-02 06:00', 'given', { round: 1, documentedTime: '2026-10-02 06:01', medication: 'Stopped-syn' }),
]
const NOW_AFTER = ms('2026-10-04 23:12')   // 02:12 hospital, 2026-10-05
const NOW_BEFORE = ms('2026-10-04 20:59')  // 23:59 hospital, 2026-10-04
const cards = groupMarDays(rows, NOW_AFTER)
const of = (o: string) => cards.filter(c => c.orderId === o)
const byDay = (o: string, d: string | null) => cards.find(c => c.orderId === o && c.day === d)

console.log('[1] one card per prescription per hospital day; UTC date never used')
check(of('ORD-A').length === 1 && byDay('ORD-A', '2026-10-05')?.rows.length === 3, `ORD-A: 3 rounds (UTC dated 2026-10-04) -> ONE card "${dayLabel(of('ORD-A')[0])}" (${of('ORD-A').map(c => c.rows.length)} rows)`)
check(of('ORD-A')[0].rows.map(r => r.round).join() === '1,2,3', `ORD-A rows in round order: ${of('ORD-A')[0].rows.map(r => r.round)}`)
check(of('ORD-B1').length === 1 && of('ORD-B2').length === 1 && of('ORD-B1')[0].key !== of('ORD-B2')[0].key, `same medication name, two prescriptions -> two cards (${of('ORD-B1')[0].key} / ${of('ORD-B2')[0].key})`)

console.log('[2] yesterday outstanding round: controls stay on yesterday; today references it')
const cY = byDay('ORD-C', '2026-10-04'), cT = byDay('ORD-C', '2026-10-05')
check(!!cY && cY.pinnedOpen && cY.relation === 'yesterday' && cY.rows.some(isActionable), `ORD-C 2026-10-04 card: open, yesterday, holds the actionable round 2`)
check(!!cT && cT.rows.length === 0 && cT.reference?.direction === 'earlier' && cT.reference.targetKey === cY!.key, `ORD-C today card: no rows, reference -> ${cT?.reference?.targetKey}`)

console.log('[3] tomorrow current round: its own open card + today reference')
const dTom = byDay('ORD-D', '2026-10-06'), dT = byDay('ORD-D', '2026-10-05')
check(!!dTom && dTom.pinnedOpen && dTom.relation === 'tomorrow' && dTom.rows.length === 1 && isActionable(dTom.rows[0]), `ORD-D 2026-10-06 card: open, tomorrow, the current round only`)
check(!!dT && dT.rows.length === 1 && dT.rows[0].status === 'given' && dT.reference?.direction === 'later', `ORD-D today card: today's given dose + "next" reference`)

console.log('[4] scheduled before hospital midnight, given after: stays on the earlier day, actual date shown')
const eY = byDay('ORD-E', '2026-10-04')
check(!!eY && eY.rows.length === 1 && eY.rows[0].status === 'given' && !eY.pinnedOpen, `ORD-E: the given round sits on 2026-10-04 (history, collapsed by default)`)
check(stampOnCard(eY!.rows[0].documentedTime, eY!.day) === '2026-10-05 00:20', `ORD-E actual administration shown as "${stampOnCard(eY!.rows[0].documentedTime, eY!.day)}" (hospital; UTC was 2026-10-04 21:20)`)
check(stampOnCard('2026-10-04 21:02', '2026-10-05') === '00:02', `same-day stamp shows time only ("${stampOnCard('2026-10-04 21:02', '2026-10-05')}")`)

console.log('[5] PRN / on-demand: doses on their documentation day; availability on today')
check(byDay('ORD-F', '2026-10-04')?.rows.length === 1 && byDay('ORD-F', '2026-10-05')?.rows.length === 2 && byDay('ORD-F', '2026-10-05')!.rows[1].adminId === 'prn', `ORD-F: 21:00 hospital dose on 10-04; 01:00 dose + availability on today (availability last)`)
check(byDay('ORD-G', '2026-10-03')?.rows.length === 1 && byDay('ORD-G', '2026-10-05')?.rows[0].adminId === 'ondemand', `ORD-G: on-demand dose on 10-03; availability on today`)

console.log('[6] undated legacy history -> Date unavailable, never a guessed date')
const h = of('ORD-H')
check(h.length === 1 && h[0].day === null && dayLabel(h[0]) === 'Date unavailable' && h[0].rows.length === 2 && !h[0].pinnedOpen, `ORD-H: one "Date unavailable" card, 2 rows, collapsed`)
check(stampOnCard('D-1 20:10', null) === 'D-1 20:10' && stampOnCard('08:05', null) === '08:05', 'legacy stamps pass through exactly as stored')

console.log('[7] history only, no actionable row -> no today card')
check(of('ORD-I').length === 1 && of('ORD-I')[0].day === '2026-10-02' && !of('ORD-I')[0].pinnedOpen, `ORD-I: one collapsed 2026-10-02 card, no today card`)

console.log('[8] nothing generated, nothing duplicated; due count unchanged')
const all = cards.flatMap(c => c.rows)
check(all.length === rows.length && new Set(all).size === rows.length, `every server row appears exactly once across cards (${all.length}/${rows.length}); no generated rows`)
const act = all.filter(isActionable)
check(act.length === rows.filter(isActionable).length && cards.every(c => c.rows.filter(isActionable).length <= 1), `actionable rows (controls) appear once each: ${act.map(r => r.adminId).join(', ')}`)
const due = (rs: MarRow[], now: number) => rs.filter(r => r.status === 'scheduled' && !r.prn && dueStateFor(r.scheduledTime, new Date(now)) !== 'upcoming').length
check(due(all, NOW_AFTER) === due(rows, NOW_AFTER), `due count over rows = ${due(rows, NOW_AFTER)} (same predicate; cards do not change it: ${cards.length} cards)`)

console.log('[9] ordering + expansion defaults')
const tiers = cards.map(c => (c.pinnedOpen ? 0 : c.day === null ? 2 : 1))
check(tiers.every((t, i) => i === 0 || tiers[i - 1] <= t), `open cards first, then history, then Date unavailable: ${cards.map(c => `${c.orderId}@${c.day ?? '—'}${c.pinnedOpen ? '*' : ''}`).join(' ')}`)
const hist = cards.filter(c => !c.pinnedOpen && c.day !== null).map(c => c.day!)
check(hist.every((d, i) => i === 0 || hist[i - 1] >= d), `history newest first: ${hist.join(' ')}`)
check(cards.filter(c => c.relation === 'today').every(c => c.pinnedOpen), 'every today card is open')

console.log('[10] hospital midnight rollover (23:59 -> 02:12 hospital; same rows)')
const before = groupMarDays(rows, NOW_BEFORE)
const cB = before.filter(c => c.orderId === 'ORD-C')
check(cB.length === 1 && cB[0].day === '2026-10-04' && cB[0].relation === 'today' && !cB[0].reference, `23:59: ORD-C has only its today (10-04) card, controls inside`)
check(of('ORD-C').length === 2 && cT!.reference !== undefined, `02:12: 10-04 is "yesterday" (still open, controls) + a new today card with the reference`)
const fB = before.filter(c => c.orderId === 'ORD-F')
check(fB.find(c => c.rows.some(r => r.adminId === 'prn'))?.day === '2026-10-04' && byDay('ORD-F', '2026-10-05')!.rows.some(r => r.adminId === 'prn'), 'PRN availability follows today across midnight (10-04 -> 10-05)')

console.log('[11] stable keys across a poll (fresh row objects)')
const again = groupMarDays(JSON.parse(JSON.stringify(rows)), NOW_AFTER)
check(again.map(c => c.key).join() === cards.map(c => c.key).join(), `${again.length} identical keys, identical order`)

console.log(`\nRESULT: ${passes} passed, ${fails} failed`)
process.exit(fails ? 1 : 0)

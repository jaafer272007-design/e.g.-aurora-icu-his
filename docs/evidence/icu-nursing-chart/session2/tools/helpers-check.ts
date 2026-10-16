/* Session 2 — agreement checks for the chart's pure presentation helpers,
   run against the REAL modules (bundled with esbuild, run in node):

     npx esbuild docs/evidence/icu-nursing-chart/session2/tools/helpers-check.ts \
       --bundle --platform=node --outfile=<tmp>/helpers-check.cjs && node <tmp>/helpers-check.cjs

   The retired cards' own projections (bedside.ts projectVentilator /
   projectHemodynamics, unchanged) are the oracle: the combined card must
   show exactly the values those cards showed, minus the one duplicate. */
import { latestObservations, projectHemodynamics, projectVentilator } from '../../../../../src/lib/api/bedside'
import type { ImagingStudy, Observation, Order } from '../../../../../src/lib/api/types'
import {
  BEDSIDE, COMBINED_CODES, HEMODYNAMICS, VENTILATOR, combinedObservationGroups,
} from '../../../../../src/pages/MissionControl/chartObservations'
import { activeMedicationOrders, medicationKind, patientImagingStudies } from '../../../../../src/pages/MissionControl/chartResults'

let pass = 0, fail = 0
const check = (name: string, ok: boolean, detail = '') => {
  if (ok) { pass++; console.log(`PASS  ${name}`) } else { fail++; console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ''}`) }
}

let n = 0
const ob = (typeCode: string, value: string, clinicalTime: string, amended?: string): Observation => ({
  observationId: `O-${++n}`, patientId: 'P-T', encounterId: 'E-T', typeCode, value, unit: '', clinicalTime,
  source: 'manual', recordedBy: 'x', enteredAt: `${clinicalTime}:00`,
  amendments: amended ? [{ newValue: amended } as unknown as Observation['amendments'][number]] : [],
})

/* ---------- 1. reading lists ---------- */
check('every typeCode read exactly once', new Set(COMBINED_CODES).size === COMBINED_CODES.length)
check('I&O manual snapshot codes never read', !COMBINED_CODES.includes('io_current_intake_ml') && !COMBINED_CODES.includes('io_current_output_ml'))
const empty = new Map()
const ventLabels = projectVentilator(empty).tiles.map(t => t.label)
check('ventilator group = the retired card (Mode + its 11 tiles, same order)',
  JSON.stringify(VENTILATOR.map(r => r.label)) === JSON.stringify(['Mode', ...ventLabels]), JSON.stringify(ventLabels))
const hemoLabels = projectHemodynamics(empty, []).metrics.map(t => t.label)
check('hemodynamics group = the retired card minus CVP (the duplicate)',
  JSON.stringify(HEMODYNAMICS.map(r => r.label)) === JSON.stringify(hemoLabels.filter(l => l !== 'CVP')), JSON.stringify(hemoLabels))
check('CVP stays in the bedside group', BEDSIDE.some(r => r.label === 'CVP'))

/* ---------- 2. values agree with the retired projections ---------- */
const scenarios: { name: string; obs: Observation[] }[] = [
  { name: 'all charted, Pplat/PEEP same time', obs: [
    ob('vent_mode', 'PCV', '2026-10-15 08:00'), ob('fio2', '40', '2026-10-15 08:00'), ob('peep', '10', '2026-10-15 08:00'),
    ob('rr_set', '16', '2026-10-15 08:00'), ob('rr_measured', '19', '2026-10-15 08:00'), ob('vt_set', '420', '2026-10-15 08:00'),
    ob('vt_exhaled', '401', '2026-10-15 08:00'), ob('ppeak', '30', '2026-10-15 08:00'), ob('pplat', '26', '2026-10-15 08:00'),
    ob('minute_ventilation', '7.1', '2026-10-15 08:00'), ob('ie_ratio', '1:2', '2026-10-15 08:00'),
    ob('cardiac_output', '4.9', '2026-10-15 07:00'), ob('cardiac_index', '2.5', '2026-10-15 07:00'), ob('svr', '1100', '2026-10-15 07:00'),
    ob('cvp', '11', '2026-10-15 07:00'), ob('lactate_poc', '3.1', '2026-10-15 07:00'), ob('urine_output', '35', '2026-10-15 07:00'),
  ] },
  { name: 'Pplat/PEEP different times', obs: [ob('peep', '8', '2026-10-15 06:00'), ob('pplat', '25', '2026-10-15 08:00')] },
  { name: 'only PEEP', obs: [ob('peep', '8', '2026-10-15 06:00')] },
  { name: 'amended Pplat at the shared time', obs: [ob('peep', '6', '2026-10-15 06:00'), ob('pplat', '20', '2026-10-15 06:00', '22')] },
  { name: 'latest wins (two Pplat, newer one shares PEEP time)', obs: [
    ob('pplat', '30', '2026-10-15 05:00'), ob('peep', '5', '2026-10-15 06:00'), ob('pplat', '21', '2026-10-15 06:00')] },
  { name: 'nothing charted', obs: [] },
]
for (const sc of scenarios) {
  const latest = latestObservations(sc.obs)
  const groups = combinedObservationGroups(latest, null, '—')
  const vent = groups.find(g => g.key === 'ventilator')!.readings
  const hemo = groups.find(g => g.key === 'hemodynamics')!.readings
  const bedside = groups.find(g => g.key === 'bedside')!.readings
  const oldVent = projectVentilator(latest)
  const oldHemo = projectHemodynamics(latest, sc.obs)
  const ventOk = oldVent.tiles.every(t => vent.find(r => r.def.label === t.label)?.text === t.value)
    && vent.find(r => r.def.label === 'Mode')!.text === oldVent.mode
  const hemoOk = oldHemo.metrics.every(t => t.label === 'CVP'
    ? bedside.find(r => r.def.label === 'CVP')!.text === t.value
    : hemo.find(r => r.def.label === t.label)?.text === t.value)
  check(`${sc.name}: ventilator values identical to the retired card (incl. driving pressure)`, ventOk,
    JSON.stringify(oldVent.tiles.map(t => [t.label, t.value, vent.find(r => r.def.label === t.label)?.text])))
  check(`${sc.name}: hemodynamic values identical to the retired card (CVP via bedside)`, hemoOk)
  const dp = vent.find(r => r.def.label === 'Driving Pressure')!
  const oldDp = oldVent.tiles.find(t => t.label === 'Driving Pressure')!.value
  check(`${sc.name}: driving pressure ${oldDp === '—' ? 'not derived' : `derived = ${oldDp}`}`,
    oldDp === '—' ? dp.kind === 'blank' : dp.kind === 'derived' && dp.text === oldDp)
  check(`${sc.name}: every real value carries its time + source`,
    [...vent, ...hemo].filter(r => r.kind === 'real').every(r => !!r.clinicalTime && !!r.source))
}

/* bedside: real beats demo; demo only in the bedside group and never counted as real */
{
  const vitals = { hr: 90, sys: null, dia: null, map: null, nibpSys: null, nibpDia: null, spo2: 97, rr: null, temp: null, etco2: null, cvp: 7 }
  const g = combinedObservationGroups(latestObservations([ob('hr', '77', '2026-10-15 08:00')]), vitals, 'Sinus')
  const bed = g[0].readings
  check('bedside: a real charted value beats the demo snapshot', bed.find(r => r.def.label === 'Heart Rate')!.kind === 'real' && bed.find(r => r.def.label === 'Heart Rate')!.text === '77')
  check('bedside: demo snapshot only where nothing real exists, tagged demo', bed.find(r => r.def.label === 'SpO₂')!.kind === 'demo')
  check('ventilator/hemodynamics never use a demo fallback', g[1].readings.every(r => r.kind !== 'demo') && g[2].readings.every(r => r.kind !== 'demo'))
}

/* ---------- 3. active medication orders ---------- */
const order = (id: string, status: Order['status'], drug: string, freq: string, extra: Partial<Order['medication']> = {}, pid = 'P-T', category: Order['category'] = 'Medication'): Order => ({
  orderId: id, patientId: pid, bedId: '', patientName: '', category, summary: drug,
  medication: { drugId: drug, drug, dose: '1 g', route: 'IV', frequency: freq, duration: 'ongoing', prn: false, ...extra } as Order['medication'],
  priority: 'Routine', status, orderedBy: 'x', orderedTime: '', history: [],
})
const orders = [
  order('O1', 'active', 'Zeta', 'q8h'), order('O2', 'active', 'Zeta', 'q12h'),
  order('O3', 'active', 'Norad', 'continuous'), order('O4', 'active', 'Heparin', 'q8h', { infusion: { value: 18, massUnit: 'mg', timeBasis: 'hour' } }),
  order('O5', 'active', 'Para', 'q6h', { prn: true }), order('O6', 'active', 'Hydro', 'once'), order('O7', 'active', 'Insulin', 'sliding scale'),
  order('O8', 'pending', 'Pend', 'q8h'), order('O9', 'discontinued', 'Disc', 'q8h'), order('O10', 'completed', 'Comp', 'once'),
  order('O11', 'active', 'Other', 'q8h', {}, 'P-OTHER'), order('O12', 'active', 'Task', '', {}, 'P-T', 'Nursing'),
]
const active = activeMedicationOrders(orders, 'P-T')
check('active meds: only active Medication orders of this patient', JSON.stringify(active.map(o => o.orderId).sort()) === JSON.stringify(['O1', 'O2', 'O3', 'O4', 'O5', 'O6', 'O7']), JSON.stringify(active.map(o => o.orderId)))
check('active meds: two orders of one drug stay two rows', active.filter(o => o.medication!.drug === 'Zeta').length === 2)
check('active meds: continuous = frequency "continuous" or a structured infusion', medicationKind(orders[2]) === 'continuous' && medicationKind(orders[3]) === 'continuous')
check('active meds: PRN by its flag', medicationKind(orders[4]) === 'prn')
check('active meds: q8h / once / sliding scale are scheduled', ['O1', 'O6', 'O7'].every(id => medicationKind(orders.find(o => o.orderId === id)!) === 'scheduled'))
check('active meds: grouped continuous → scheduled → PRN', active.map(o => medicationKind(o)).join() === 'continuous,continuous,scheduled,scheduled,scheduled,scheduled,prn', active.map(o => medicationKind(o)).join())

/* ---------- 4. imaging ordering ---------- */
const st = (id: string, pid: string, orderedAt: string, reportedAt?: string): ImagingStudy => ({
  studyId: id, patientId: pid, bedId: '', patientName: '', modality: 'CXR', description: id, orderedAt, reportedAt,
  status: reportedAt ? 'final' : 'ordered', flag: '', acknowledged: false,
})
const studies = patientImagingStudies([
  st('S1', 'P-T', 'D-2 08:00', 'D-2 10:00'), st('S2', 'P-T', '2026-10-15 07:00'), st('S3', 'P-T', 'D-1 06:00', '2026-10-15 08:30'),
  st('S4', 'P-T', ''), st('S5', 'P-X', '2026-10-15 09:00'),
], 'P-T')
check('imaging: this patient only, newest activity first, undated last',
  studies.map(s => s.studyId).join() === 'S3,S2,S1,S4', studies.map(s => s.studyId).join())

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)

import type {
  AdministrationAction, MarRow, MedicationDetails, NewOrderDraft, Order,
} from '../types'
import { nowHm } from '../../time'
import {
  firstDoseEpoch, instanceIdentity, instanceStamp, intervalInstances, isFact,
  parseFrequency, therapyStartEpoch,
} from '../../marSchedule'

/* Canonical orders store — THE single source of truth for orders and
   medications. Doctor Workspace's "Orders to Sign", Nurse Workspace's MAR
   and "Orders to Implement", and the Orders & Medication screen all read
   and mutate this store through the api/index.ts service layer. In the
   real system this module is replaced by the ASP.NET Core orders service;
   the mutation functions below map 1:1 to its POST/PUT endpoints. */

const med = (
  drugId: string, drug: string, dose: string, route: string, frequency: string,
  duration: string, prn = false, prnIndication?: string,
): MedicationDetails => ({ drugId, drug, dose, route, frequency, duration, prn, prnIndication })

export const medSummary = (m: MedicationDetails) =>
  `${m.drug} ${m.dose} · ${m.route} · ${m.prn ? `PRN (${m.prnIndication ?? 'as required'})` : m.frequency}`

let seq = 100
const nextOrderId = () => `ORD-${++seq}`
let adminSeq = 500
const nextAdminId = () => `ADM-${++adminSeq}`


/* RETIRED (MAR derived-schedule safety fix): mock schedule generation is
   GONE, mirroring the server. Orders store no dose slots — administrations
   hold only documented FACTS, and expected instances derive at MAR read
   (deriveMarRows below, via lib/marSchedule.ts). Seed rows still carrying
   'scheduled' stubs are artefacts of the removed plan: ignored by the
   derivation, never facts. */

/* ---------------- seed data ----------------
   Content mirrors the previously separate Doctor Workspace / Nurse Workspace
   sample lists — now living in one model. */

const ORDERS: Order[] = [
  /* ===== P-1001 · Ahmed Al-Saadi · B-01 ===== */
  {
    orderId: 'ORD-2001', patientId: 'P-1001', bedId: 'B-01', patientName: 'Ahmed Al-Saadi',
    category: 'Medication', priority: 'Urgent', status: 'active',
    medication: med('noradrenaline', 'Noradrenaline', '0.32 µg/kg/min', 'IV infusion (central)', 'continuous', 'ongoing'),
    summary: 'Noradrenaline 0.32 µg/kg/min · IV infusion (central) · continuous',
    orderedBy: 'Dr. S. Rahman', orderedTime: 'D-3 21:10',
    administrations: [{ adminId: 'ADM-401', scheduledTime: '11:00', status: 'scheduled' }],
    history: [
      { time: 'D-3 21:10', actor: 'Dr. S. Rahman', action: 'created', detail: 'Start 0.1 µg/kg/min, titrate to MAP ≥ 65' },
      { time: 'D-3 21:12', actor: 'Dr. S. Rahman', action: 'signed' },
      { time: '09:31', actor: 'Dr. S. Rahman', action: 'modified', detail: 'Dose 0.24 → 0.32 µg/kg/min — MAP < 65 for 12 min' },
    ],
  },
  {
    orderId: 'ORD-2002', patientId: 'P-1001', bedId: 'B-01', patientName: 'Ahmed Al-Saadi',
    category: 'Medication', priority: 'Routine', status: 'active',
    medication: med('insulin-actrapid', 'Insulin (Actrapid)', '2.5 U/h', 'IV infusion', 'continuous', 'ongoing'),
    summary: 'Insulin (Actrapid) 2.5 U/h · IV infusion · continuous',
    orderedBy: 'Dr. S. Rahman', orderedTime: 'D-2 08:40',
    administrations: [{ adminId: 'ADM-402', scheduledTime: '11:30', status: 'scheduled' }],
    history: [
      { time: 'D-2 08:40', actor: 'Dr. S. Rahman', action: 'created', detail: 'Glucose check q1h while on infusion' },
      { time: 'D-2 08:41', actor: 'Dr. S. Rahman', action: 'signed' },
    ],
  },
  {
    orderId: 'ORD-2003', patientId: 'P-1001', bedId: 'B-01', patientName: 'Ahmed Al-Saadi',
    category: 'Medication', priority: 'Routine', status: 'active',
    medication: med('meropenem', 'Meropenem', '1 g', 'IV over 30 min', 'q8h', '7 days'),
    summary: 'Meropenem 1 g · IV over 30 min · q8h (day 4 of 7)',
    orderedBy: 'Dr. S. Rahman', orderedTime: 'D-4 02:15',
    administrations: [
      { adminId: 'ADM-403', scheduledTime: '04:00', status: 'given', documentedTime: '04:05', documentedBy: 'RN night shift' },
      { adminId: 'ADM-404', scheduledTime: '12:00', status: 'scheduled' },
    ],
    history: [
      { time: 'D-4 02:15', actor: 'Dr. S. Rahman', action: 'created', detail: 'Empiric cover, de-escalate per cultures' },
      { time: 'D-4 02:16', actor: 'Dr. S. Rahman', action: 'signed' },
      { time: '04:05', actor: 'RN night shift', action: 'administered', detail: '04:00 dose given' },
    ],
  },
  {
    orderId: 'ORD-2004', patientId: 'P-1001', bedId: 'B-01', patientName: 'Ahmed Al-Saadi',
    category: 'Medication', priority: 'Routine', status: 'active',
    medication: med('paracetamol', 'Paracetamol', '1 g', 'IV', 'q6h', 'ongoing', true, 'temp ≥ 38.3 °C'),
    summary: 'Paracetamol 1 g · IV · PRN (temp ≥ 38.3 °C)',
    orderedBy: 'Dr. S. Rahman', orderedTime: 'D-3 22:00',
    administrations: [{ adminId: 'ADM-405', scheduledTime: '', status: 'scheduled' }],
    history: [
      { time: 'D-3 22:00', actor: 'Dr. S. Rahman', action: 'created' },
      { time: 'D-3 22:01', actor: 'Dr. S. Rahman', action: 'signed' },
    ],
  },
  {
    orderId: 'ORD-2005', patientId: 'P-1001', bedId: 'B-01', patientName: 'Ahmed Al-Saadi',
    category: 'Medication', priority: 'Routine', status: 'active',
    medication: med('enoxaparin', 'Enoxaparin', '40 mg', 'SC', 'daily', 'ongoing'),
    summary: 'Enoxaparin 40 mg · SC · daily (18:00)',
    orderedBy: 'Dr. S. Rahman', orderedTime: 'D-3 21:20',
    administrations: [{ adminId: 'ADM-406', scheduledTime: '18:00', status: 'scheduled' }],
    history: [
      { time: 'D-3 21:20', actor: 'Dr. S. Rahman', action: 'created', detail: 'DVT prophylaxis' },
      { time: 'D-3 21:21', actor: 'Dr. S. Rahman', action: 'signed' },
    ],
  },
  {
    orderId: 'ORD-2006', patientId: 'P-1001', bedId: 'B-01', patientName: 'Ahmed Al-Saadi',
    category: 'Medication', priority: 'Urgent', status: 'pending',
    medication: med('noradrenaline', 'Noradrenaline', 'titrate, max 0.5 µg/kg/min', 'IV infusion (central)', 'continuous', 'ongoing'),
    summary: 'Noradrenaline — raise titration ceiling to 0.5 µg/kg/min, MAP target ≥ 65',
    orderedBy: 'Dr. S. Rahman', orderedTime: '09:31',
    history: [{ time: '09:31', actor: 'Dr. S. Rahman', action: 'created', detail: 'Ceiling change awaiting signature' }],
  },
  {
    orderId: 'ORD-2007', patientId: 'P-1001', bedId: 'B-01', patientName: 'Ahmed Al-Saadi',
    category: 'Medication', priority: 'Routine', status: 'pending',
    medication: med('meropenem', 'Meropenem', '1 g', 'IV over 30 min', 'q12h', '3 days'),
    summary: 'Meropenem de-escalation — narrow per culture sensitivities (ID rec)',
    orderedBy: 'Dr. S. Rahman', orderedTime: '07:40',
    history: [{ time: '07:40', actor: 'Dr. S. Rahman', action: 'created', detail: 'Per ID: de-escalate, day 4 of 7' }],
  },
  {
    orderId: 'ORD-2008', patientId: 'P-1001', bedId: 'B-01', patientName: 'Ahmed Al-Saadi',
    category: 'Lab', priority: 'STAT', status: 'active', requiresImplementation: true,
    summary: 'Repeat lactate + ScvO₂ with the 13:00 draw — sample from arterial line',
    orderedBy: 'Dr. S. Rahman', orderedTime: '09:42',
    history: [
      { time: '09:42', actor: 'Dr. S. Rahman', action: 'created' },
      { time: '09:42', actor: 'Dr. S. Rahman', action: 'signed' },
    ],
  },
  {
    orderId: 'ORD-2009', patientId: 'P-1001', bedId: 'B-01', patientName: 'Ahmed Al-Saadi',
    category: 'Nursing', priority: 'Routine', status: 'active', requiresImplementation: true,
    summary: 'Change right IJ central line dressing during day shift',
    orderedBy: 'Dr. S. Rahman', orderedTime: '07:50',
    history: [
      { time: '07:50', actor: 'Dr. S. Rahman', action: 'created' },
      { time: '07:50', actor: 'Dr. S. Rahman', action: 'signed' },
    ],
  },
  {
    orderId: 'ORD-2010', patientId: 'P-1001', bedId: 'B-01', patientName: 'Ahmed Al-Saadi',
    category: 'Medication', priority: 'Routine', status: 'discontinued',
    medication: med('midazolam', 'Midazolam', '2 mg/h', 'IV infusion', 'continuous', 'ongoing'),
    summary: 'Midazolam 2 mg/h · IV infusion · continuous',
    orderedBy: 'Dr. S. Rahman', orderedTime: 'D-3 21:30', statusReason: 'Paused for spontaneous awakening trial (SAT) per protocol',
    history: [
      { time: 'D-3 21:30', actor: 'Dr. S. Rahman', action: 'created' },
      { time: 'D-3 21:31', actor: 'Dr. S. Rahman', action: 'signed' },
      { time: '06:30', actor: 'Dr. S. Rahman', action: 'discontinued', detail: 'Paused for spontaneous awakening trial (SAT) per protocol' },
    ],
  },
  {
    orderId: 'ORD-2011', patientId: 'P-1001', bedId: 'B-01', patientName: 'Ahmed Al-Saadi',
    category: 'Medication', priority: 'Urgent', status: 'completed',
    medication: med('prbc', 'Packed red blood cells', '1 unit', 'IV transfusion', 'once', 'once'),
    summary: 'PRBC 1 unit · IV transfusion · once (Hgb 7.9)',
    orderedBy: 'Dr. S. Rahman', orderedTime: '02:30',
    history: [
      { time: '02:30', actor: 'Dr. S. Rahman', action: 'created', detail: 'Hgb 7.9 g/dL' },
      { time: '02:31', actor: 'Dr. S. Rahman', action: 'signed' },
      { time: '04:20', actor: 'RN night shift', action: 'completed', detail: 'Transfusion completed, post-count 8.8 g/dL' },
    ],
  },

  /* ===== P-1004 · Susan Wright · B-04 ===== */
  {
    orderId: 'ORD-2012', patientId: 'P-1004', bedId: 'B-04', patientName: 'Susan Wright',
    category: 'Medication', priority: 'Routine', status: 'active',
    medication: med('pantoprazole', 'Pantoprazole', '40 mg', 'IV', 'daily', 'ongoing'),
    summary: 'Pantoprazole 40 mg · IV · daily',
    orderedBy: 'Dr. S. Rahman', orderedTime: 'D-6 10:00',
    administrations: [{ adminId: 'ADM-407', scheduledTime: '08:00', status: 'given', documentedTime: '08:04', documentedBy: 'RN M. Chen' }],
    history: [
      { time: 'D-6 10:00', actor: 'Dr. S. Rahman', action: 'created' },
      { time: 'D-6 10:01', actor: 'Dr. S. Rahman', action: 'signed' },
      { time: '08:04', actor: 'RN M. Chen', action: 'administered', detail: '08:00 dose given' },
    ],
  },
  {
    orderId: 'ORD-2013', patientId: 'P-1004', bedId: 'B-04', patientName: 'Susan Wright',
    category: 'Medication', priority: 'Routine', status: 'active',
    medication: med('calcium-gluconate', 'Calcium gluconate', '10 mL 10%', 'IV', 'per CRRT protocol', 'ongoing'),
    summary: 'Calcium gluconate 10 mL 10% · IV · per CRRT protocol',
    orderedBy: 'Dr. S. Rahman', orderedTime: 'D-2 14:20',
    administrations: [{ adminId: 'ADM-408', scheduledTime: '10:00', status: 'given', documentedTime: '10:12', documentedBy: 'RN M. Chen' }],
    history: [
      { time: 'D-2 14:20', actor: 'Dr. S. Rahman', action: 'created' },
      { time: 'D-2 14:21', actor: 'Dr. S. Rahman', action: 'signed' },
      { time: '10:12', actor: 'RN M. Chen', action: 'administered', detail: '10:00 dose given' },
    ],
  },
  {
    orderId: 'ORD-2014', patientId: 'P-1004', bedId: 'B-04', patientName: 'Susan Wright',
    category: 'Medication', priority: 'Routine', status: 'active',
    medication: med('phosphate', 'Phosphate (K-Phos)', '15 mmol', 'IV over 4 h', 'once', 'once'),
    summary: 'Phosphate (K-Phos) 15 mmol · IV over 4 h · once',
    orderedBy: 'Dr. S. Rahman', orderedTime: '06:10',
    administrations: [{ adminId: 'ADM-409', scheduledTime: '12:00', status: 'scheduled' }],
    history: [
      { time: '06:10', actor: 'Dr. S. Rahman', action: 'created', detail: 'PO₄ 0.5 mmol/L on AM labs' },
      { time: '06:11', actor: 'Dr. S. Rahman', action: 'signed' },
    ],
  },
  {
    orderId: 'ORD-2015', patientId: 'P-1004', bedId: 'B-04', patientName: 'Susan Wright',
    category: 'Medication', priority: 'Routine', status: 'active',
    medication: med('metoprolol', 'Metoprolol', '25 mg', 'PO', 'bid', 'ongoing'),
    summary: 'Metoprolol 25 mg · PO · bid — hold if HR < 60 or SBP < 100',
    orderedBy: 'Dr. S. Rahman', orderedTime: 'D-5 09:00',
    administrations: [{ adminId: 'ADM-410', scheduledTime: '12:00', status: 'scheduled' }],
    history: [
      { time: 'D-5 09:00', actor: 'Dr. S. Rahman', action: 'created', detail: 'Rate control, AFib' },
      { time: 'D-5 09:01', actor: 'Dr. S. Rahman', action: 'signed' },
    ],
  },
  {
    orderId: 'ORD-2016', patientId: 'P-1004', bedId: 'B-04', patientName: 'Susan Wright',
    category: 'Nursing', priority: 'Urgent', status: 'pending', requiresImplementation: true,
    summary: 'CRRT prescription renewal — 24 h renewal due, filter change anticipated 22:00',
    orderedBy: 'Dr. S. Rahman', orderedTime: '08:55',
    history: [{ time: '08:55', actor: 'Dr. S. Rahman', action: 'created', detail: 'Awaiting signature' }],
  },
  {
    orderId: 'ORD-2017', patientId: 'P-1004', bedId: 'B-04', patientName: 'Susan Wright',
    category: 'Nursing', priority: 'Urgent', status: 'active', requiresImplementation: true,
    summary: 'Prime and stage CRRT filter change kit at bedside before 22:00',
    orderedBy: 'Dr. S. Rahman', orderedTime: '08:55',
    history: [
      { time: '08:55', actor: 'Dr. S. Rahman', action: 'created' },
      { time: '08:55', actor: 'Dr. S. Rahman', action: 'signed' },
    ],
  },
  {
    orderId: 'ORD-2018', patientId: 'P-1004', bedId: 'B-04', patientName: 'Susan Wright',
    category: 'Nursing', priority: 'Routine', status: 'active', requiresImplementation: true,
    summary: 'Daily weight on bed scale before 08:00 tomorrow',
    orderedBy: 'Dr. S. Rahman', orderedTime: '08:30',
    history: [
      { time: '08:30', actor: 'Dr. S. Rahman', action: 'created' },
      { time: '08:30', actor: 'Dr. S. Rahman', action: 'signed' },
    ],
  },

  /* ===== P-1007 · Robert Miller · B-07 ===== */
  {
    orderId: 'ORD-2019', patientId: 'P-1007', bedId: 'B-07', patientName: 'Robert Miller',
    category: 'Nursing', priority: 'Urgent', status: 'pending', requiresImplementation: true,
    summary: 'Proning protocol — P/F 176, RT requesting order to proceed',
    orderedBy: 'Dr. S. Rahman', orderedTime: '07:15',
    history: [{ time: '07:15', actor: 'Dr. S. Rahman', action: 'created', detail: 'Awaiting signature' }],
  },
]

/* ---------------- store accessors & mutators ---------------- */

export const allOrders = (): Order[] => ORDERS

export function insertOrder(
  draft: NewOrderDraft, actor: string, sign: boolean, patientName: string, bedId: string, note?: string,
): Order {
  const time = nowHm()
  const order: Order = {
    orderId: nextOrderId(),
    patientId: draft.patientId,
    bedId,
    patientName,
    category: draft.category,
    summary: draft.summary ?? (draft.medication ? medSummary(draft.medication) : ''),
    medication: draft.medication,
    priority: draft.priority,
    status: sign ? 'active' : 'pending',
    orderedBy: actor,
    orderedTime: time,
    requiresImplementation: draft.requiresImplementation,
    history: [{ time, actor, action: 'created', detail: note }],
  }
  /* DERIVED SCHEDULE: signing stores no dose slots — the signed event is
     the therapy start the MAR derives expected instances from */
  if (sign) order.history.push({ time, actor, action: 'signed' })
  ORDERS.push(order)
  return order
}

export function applySign(orderId: string, actor: string): Order | null {
  const o = ORDERS.find(x => x.orderId === orderId && x.status === 'pending')
  if (!o) return null
  o.status = 'active'
  o.history.push({ time: nowHm(), actor, action: 'signed' })
  return o
}

export function applyModify(
  orderId: string, changes: Partial<MedicationDetails>, reason: string, actor: string,
): Order | null {
  const o = ORDERS.find(x => x.orderId === orderId && (x.status === 'active' || x.status === 'pending'))
  if (!o || !o.medication || !reason.trim()) return null
  const before = { ...o.medication }
  o.medication = { ...o.medication, ...changes }
  o.summary = medSummary(o.medication)
  const diff = (Object.keys(changes) as (keyof MedicationDetails)[])
    .filter(k => changes[k] !== undefined && changes[k] !== before[k])
    .map(k => `${k}: ${String(before[k])} → ${String(changes[k])}`)
    .join(', ')
  o.history.push({ time: nowHm(), actor, action: 'modified', detail: `${diff || 'no field change'} — ${reason.trim()}` })
  return o
}

export function applyDiscontinue(orderId: string, reason: string, actor: string): Order | null {
  const o = ORDERS.find(x => x.orderId === orderId && (x.status === 'active' || x.status === 'pending'))
  if (!o || !reason.trim()) return null
  o.status = 'discontinued'
  o.statusReason = reason.trim()
  /* remaining scheduled administrations are cancelled with the order */
  o.administrations = o.administrations?.filter(a => a.status !== 'scheduled')
  o.history.push({ time: nowHm(), actor, action: 'discontinued', detail: reason.trim() })
  return o
}

export function applyImplementation(orderId: string, actor: string): Order | null {
  const o = ORDERS.find(x => x.orderId === orderId && x.status === 'active' && x.requiresImplementation)
  if (!o) return null
  o.status = 'completed'
  o.history.push({ time: nowHm(), actor, action: 'implemented' }, { time: nowHm(), actor, action: 'completed' })
  return o
}

/** Document a dose — APPENDS an administration FACT (nothing stored is
    consumed; mirrors the real endpoint). adminId is the derived instance
    identity ("yyyy-MM-ddTHH:mm"), "prn", or "ondemand". */
export function applyAdministration(
  orderId: string, adminId: string, action: AdministrationAction, actor: string, reason?: string,
): Order | null {
  const o = ORDERS.find(x => x.orderId === orderId)
  if (!o || !o.medication || o.status !== 'active') return null
  const scheduledStamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(adminId) ? adminId.replace('T', ' ') : ''
  const already = (o.administrations ?? []).some(a => isFact(a) && scheduledStamp !== '' && a.scheduledTime === scheduledStamp)
  if (already) return null
  const now = new Date()
  const time = `${now.toISOString().slice(0, 10)} ${nowHm()}`
  const fact = {
    adminId: nextAdminId(), scheduledTime: scheduledStamp, status: action,
    documentedTime: time, documentedBy: actor,
    ...(reason?.trim() ? { reason: reason.trim() } : {}),
  }
  o.administrations = [...(o.administrations ?? []), fact]
  const verb = action === 'given' ? 'administered' : action
  o.history.push({
    time, actor, action: verb,
    detail: `${scheduledStamp || (o.medication.prn ? 'PRN' : `unscheduled (${o.medication.frequency})`)} dose ${action} at ${time}${reason?.trim() ? ` — ${reason.trim()}` : ''}`,
  })
  return o
}

/** Derived MAR view (mirrors the server's MarLogic.MarRowsFor): every
    documented FACT (any order status — the record), plus, for ACTIVE
    orders, the expected instances the schedule derives that no fact
    covers. Stored 'scheduled' stubs are ignored — not facts. */
export function deriveMarRows(patientIds: string[]): MarRow[] {
  const nowMs = Date.now()
  const rows: { sort: number; row: MarRow }[] = []
  for (const o of ORDERS) {
    if (!o.medication || !patientIds.includes(o.patientId)) continue
    const m = o.medication
    const route = `${m.route} · ${m.prn ? `PRN — ${m.prnIndication ?? 'as required'}` : m.frequency}`
    const row = (adminId: string, scheduledTime: string, status: MarRow['status'],
      extra: Partial<MarRow> = {}): MarRow => ({
      orderId: o.orderId, adminId, patientId: o.patientId, bedId: o.bedId,
      medication: m.drug, dose: m.dose, route, scheduledTime, prn: m.prn, status, ...extra,
    })
    const facts = (o.administrations ?? []).filter(isFact)
    for (const a of facts)
      rows.push({
        sort: Date.parse((a.scheduledTime.includes('-') ? a.scheduledTime : a.documentedTime ?? '').replace(' ', 'T') + ':00Z') || nowMs,
        row: row(a.adminId, a.scheduledTime, a.status, { documentedTime: a.documentedTime }),
      })
    if (o.status !== 'active') continue
    const kind = parseFrequency(m)
    if (kind.kind === 'prn') { rows.push({ sort: nowMs, row: row('prn', '', 'scheduled') }); continue }
    if (kind.kind === 'underivable') {
      rows.push({ sort: nowMs, row: row('ondemand', '', 'scheduled', { scheduleNote: `no derivable dose schedule — '${m.frequency}'; document on demand` }) })
      continue
    }
    const anchor = therapyStartEpoch(o, nowMs)
    if (anchor === null) {
      rows.push({ sort: nowMs, row: row('ondemand', '', 'scheduled', { scheduleNote: 'no derivable dose schedule — therapy start is not parseable; document on demand' }) })
      continue
    }
    const first = firstDoseEpoch(anchor)
    const documented = new Set(facts.map(a => a.scheduledTime))
    if (kind.kind === 'once') {
      if (!documented.has(instanceStamp(first)))
        rows.push({ sort: first, row: row(instanceIdentity(first), instanceStamp(first), 'scheduled') })
      continue
    }
    const { aggregatedMissed, oldestAggregatedMs, renderableMs } =
      intervalInstances(first, kind.hours, documented, nowMs)
    if (aggregatedMissed > 0 && oldestAggregatedMs !== null)
      rows.push({ sort: oldestAggregatedMs, row: row('missed-earlier', instanceStamp(oldestAggregatedMs), 'missed-earlier', { missedEarlier: aggregatedMissed }) })
    for (const t of renderableMs)
      rows.push({ sort: t, row: row(instanceIdentity(t), instanceStamp(t), 'scheduled') })
  }
  return rows.sort((a, b) => a.sort - b.sort).map(r => r.row)
}

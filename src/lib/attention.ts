import type { Encounter, ImagingStudy, Observation, Order, ResultInboxItem } from './api/types'
import { computeNews2 } from './scoring'
import { enumObsSamples } from './scoring/sources'
import { datedEpoch } from './time'

/* Alerts — the Clinical Attention Center (docs/design/
   alerts-attention-center-design.md). PURE derivation, COMPUTED AT RENDER
   from the canonical reads — NO stored alert entities, NO parallel
   "alert acknowledged" state (a result is acknowledged exactly as in the
   inbox — one truth), and NO notifications/pop-ups/paging (the
   validator's locked D6 decision: alerting workflows are v2; this is a
   board you look at).

   Every item is real or the page shows an explicit "not tracked yet"
   placeholder — never fabricated. Abnormal vitals use NEWS2's VALIDATED
   parameter thresholds by reading the score's own computed components
   (never re-implemented thresholds): a parameter scoring ≥2 is abnormal;
   3 is NEWS2's own single-parameter escalation trigger. */

export type AttentionSeverity = 'critical' | 'high' | 'medium' | 'info'

export interface AttentionItem {
  severity: AttentionSeverity
  patientId: string
  bedId: string
  patientName: string
  title: string
  detail: string
  /** stored time string (dated / legacy convention) — display via displayStamp */
  time: string
  /** the responsible clinician WHERE THE SOURCE HAS ONE — null means the
   *  source genuinely records none (flagged, never invented) */
  clinician: string | null
  /** present ONLY where a real acknowledgment exists (critical labs +
   *  unacknowledged results — the existing inbox acknowledgment) */
  ack?: { kind: 'lab' | 'imaging'; id: string }
  /** open-patient navigation target */
  openPath: string
}

export interface AttentionGroup {
  key: string
  title: string
  /** ordering rank — groups render worst-first (the stated presentation
   *  choice: grouped by source, groups ordered by severity, because the
   *  available ACTIONS differ per source) */
  rank: number
  items: AttentionItem[]
  /** an honest scope note shown under the group header */
  note?: string
}

export interface PatientAttentionBundle {
  patientId: string
  encounter: Encounter
  observations: Observation[] | null
  imaging: ImagingStudy[] | null
}

const sevRank: Record<AttentionSeverity, number> = { critical: 0, high: 1, medium: 2, info: 3 }
const byWorst = (a: AttentionItem, b: AttentionItem) => sevRank[a.severity] - sevRank[b.severity]

/* ---------- §2.1 critical labs + §2.3 unacknowledged results ----------
   BOTH straight from the unit-wide results inbox (already exactly
   "unacknowledged"); the split keeps critical at the top with its own
   urgency. The inbox item does not record who documented/resulted it —
   clinician: null (flagged, not invented). */
export function criticalLabItems(inbox: ResultInboxItem[]): AttentionItem[] {
  return inbox.filter(i => i.flag === 'critical').map(i => ({
    severity: 'critical' as const,
    patientId: i.patientId, bedId: i.bedId, patientName: i.patientName,
    title: i.title, detail: i.detail, time: i.time, clinician: null,
    ack: { kind: i.kind, id: i.id },
    openPath: `/labs/${i.patientId}`,
  }))
}

export function unackedResultItems(inbox: ResultInboxItem[]): AttentionItem[] {
  return inbox.filter(i => i.flag !== 'critical').map(i => ({
    severity: i.flag === 'abnormal' ? ('medium' as const) : ('info' as const),
    patientId: i.patientId, bedId: i.bedId, patientName: i.patientName,
    title: i.title, detail: i.detail, time: i.time, clinician: null,
    ack: { kind: i.kind, id: i.id },
    openPath: `/labs/${i.patientId}`,
  })).sort(byWorst)
}

/* ---------- §2.4 orders pending signature ---------- */
export function pendingOrderItems(pending: Order[]): AttentionItem[] {
  return pending.map(o => ({
    severity: 'info' as const,
    patientId: o.patientId, bedId: o.bedId, patientName: o.patientName,
    title: `${o.summary} — awaiting signature`,
    detail: `${o.priority} · ${o.category} · ${o.orderId}`,
    time: o.orderedTime,
    clinician: o.orderedBy,
    openPath: `/orders/${o.patientId}`,
  }))
}

/* ---------- §2.2 abnormal vitals — NEWS2's OWN component scores ----------
   The thresholds are the score definition's, read from its computed
   components — never re-implemented here. Recency: NEWS2's validated
   24 h window (the score's own windowing decision; the recorded flag
   that a shorter window may suit a current-state score stands). A
   missing parameter is ABSENCE, not abnormality — INCOMPLETE is the
   score's concern, not an alert. Observations carry no single
   responsible clinician on the read — clinician: null (flagged). */
export function abnormalVitalItems(bundles: PatientAttentionBundle[], now: Date): AttentionItem[] {
  const items: AttentionItem[] = []
  for (const b of bundles) {
    if (b.observations === null) continue
    const news2 = computeNews2({ observations: b.observations, now })
    for (const c of news2.result.components) {
      if (c.score === null || c.score < 2) continue
      const src = c.contributors[0]
      items.push({
        severity: c.score >= 3 ? 'high' : 'medium',
        patientId: b.patientId, bedId: b.encounter.bedId, patientName: b.encounter.patientName,
        title: `${c.label} — NEWS2 parameter scores ${c.score}${c.score >= 3 ? ' (single-parameter trigger)' : ''}`,
        detail: c.detail,
        time: src?.timeLabel ?? '',
        clinician: null,
        openPath: `/observations/${b.patientId}`,
      })
    }
  }
  return items.sort(byWorst)
}

/* ---------- §2.5 pending imaging reports ---------- */
export function pendingImagingItems(bundles: PatientAttentionBundle[]): AttentionItem[] {
  const items: AttentionItem[] = []
  for (const b of bundles) {
    for (const s of b.imaging ?? []) {
      if (s.status !== 'in-progress' && s.status !== 'preliminary') continue
      items.push({
        severity: 'info',
        patientId: b.patientId, bedId: s.bedId, patientName: s.patientName,
        title: `${s.modality} ${s.description} — report ${s.status}`,
        detail: s.status === 'preliminary' ? 'preliminary report available — final pending' : 'study in progress',
        time: s.performedAt || s.orderedAt,
        /* the imaging study read records no performing/reporting clinician
           on the pending statuses — null, never invented */
        clinician: null,
        openPath: `/labs/${b.patientId}`,
      })
    }
  }
  return items
}

/* ---------- §2.6 ventilation duration — honestly derived ----------
   Time-on-support from the CHARTED resp_support history only (dated
   clinicalTime, amendment-aware via the scoring source helper). The
   duration is the current CONTIGUOUS run of "Yes" charting: from the
   oldest "Yes" not preceded by a "No", up to now — provided the LATEST
   charted value is "Yes". If support was never charted (or the latest
   says "No"), NO duration is claimed. */
export interface VentDuration {
  patientId: string
  bedId: string
  patientName: string
  /** dated stamp of the first observation of the current support run */
  since: string
  /** hours on support — null when `since` is not a dated stamp (a legacy
   *  charting form can't give an honest duration; the stamp is shown) */
  hours: number | null
  /** the latest charted vent_mode within the run, if any */
  mode: string | null
}

export function ventDurations(bundles: PatientAttentionBundle[], now: Date): AttentionItem[] {
  const items: AttentionItem[] = []
  for (const b of bundles) {
    if (b.observations === null) continue
    const supports = enumObsSamples(b.observations, 'resp_support', now)
      .slice()
      .sort((a, s) => a.minutesAgo - s.minutesAgo) // most recent first
    if (supports.length === 0 || supports[0].value !== 'Yes') continue
    /* walk back the contiguous Yes-run (most-recent-first order) */
    let runStart = supports[0]
    for (const s of supports) {
      if (s.value !== 'Yes') break
      runStart = s
    }
    const sinceMs = datedEpoch(runStart.timeLabel)
    const hours = sinceMs === null ? null : Math.round(((now.getTime() - sinceMs) / 3_600_000) * 10) / 10
    const modes = enumObsSamples(b.observations, 'vent_mode', now)
      .filter(m => m.minutesAgo <= runStart.minutesAgo)
      .sort((a, m) => a.minutesAgo - m.minutesAgo)
    items.push({
      severity: 'info',
      patientId: b.patientId, bedId: b.encounter.bedId, patientName: b.encounter.patientName,
      title: hours === null
        ? 'On respiratory support — charted since a pre-dated stamp'
        : `On respiratory support for ${hours} h`,
      detail: `charted support since ${runStart.timeLabel}${modes[0] ? ` · latest mode ${modes[0].value}` : ''} — derived from the charting history only`,
      time: runStart.timeLabel,
      clinician: null,
      openPath: `/observations/${b.patientId}`,
    })
  }
  return items
}

/* ---------- assembly ---------- */

export interface AttentionInputs {
  inbox: ResultInboxItem[]
  pendingOrders: Order[]
  bundles: PatientAttentionBundle[]
  now: Date
}

export function buildAttentionGroups(inputs: AttentionInputs): AttentionGroup[] {
  const { inbox, pendingOrders, bundles, now } = inputs
  return [
    { key: 'critical-labs', title: 'Critical laboratory results', rank: 0, items: criticalLabItems(inbox), note: 'unacknowledged critical results — acknowledging here IS the results-inbox acknowledgment (one truth)' },
    { key: 'abnormal-vitals', title: 'Abnormal vital signs', rank: 1, items: abnormalVitalItems(bundles, now), note: "NEWS2's validated parameter thresholds (a parameter scoring ≥2; 3 is NEWS2's own single-parameter trigger) within the score's 24 h window — informational, no acknowledgment concept exists" },
    { key: 'unacked-results', title: 'Unacknowledged results', rank: 2, items: unackedResultItems(inbox), note: 'the unit-wide results inbox (non-critical) — same acknowledgment as the inbox' },
    { key: 'pending-orders', title: 'Orders pending signature', rank: 3, items: pendingOrderItems(pendingOrders), note: 'signing happens in the ordering flow — not duplicated here' },
    { key: 'pending-imaging', title: 'Pending imaging reports', rank: 4, items: pendingImagingItems(bundles), note: 'studies in progress or with a preliminary report — informational' },
    { key: 'vent-duration', title: 'Ventilation duration', rank: 5, items: ventDurations(bundles, now), note: 'derived from the charted respiratory-support history only — never inferred' },
  ]
}

/** the REAL attention count (replaces the hardcoded nav badge) */
export const attentionCount = (groups: AttentionGroup[]): number =>
  groups.reduce((n, g) => n + g.items.length, 0)

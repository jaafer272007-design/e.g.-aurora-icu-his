import type { ImagingStudy, Order } from '../../lib/api/types'
import { timestampMinutes } from '../../lib/time'

/* Pure presentation helpers for the chart's Active Medication Orders and
   Imaging Results cards (ICU update 2026-10-15, owner's plan §3). Nothing
   here fetches, stores or recomputes a clinical fact: rows are the
   canonical order / imaging records verbatim, filtered and ordered. */

export type MedicationKind = 'continuous' | 'scheduled' | 'prn'

/** PRN first by its own flag; continuous = the structured infusion entry
 *  or the 'continuous' frequency (the ordering form's infusion mode);
 *  everything else — q<n>h, named, once, sliding scale, per protocol — is
 *  a scheduled prescription shown with its frequency text verbatim */
export function medicationKind(o: Order): MedicationKind {
  const m = o.medication
  if (m?.prn) return 'prn'
  if (m?.infusion || m?.frequency === 'continuous') return 'continuous'
  return 'scheduled'
}

export const KIND_ORDER: MedicationKind[] = ['continuous', 'scheduled', 'prn']
export const KIND_LABEL: Record<MedicationKind, string> = {
  continuous: 'Continuous', scheduled: 'Scheduled', prn: 'PRN',
}

/** the patient's ACTIVE medication prescriptions — signed and not
 *  completed/discontinued (pending = unsigned, never active). One row per
 *  ORDER, even when two orders name the same drug: each is its own
 *  prescription with its own dose, route and frequency. The patientId
 *  check is defence in depth (the read is already patient-scoped). */
export function activeMedicationOrders(orders: Order[], patientId: string): Order[] {
  return orders
    .filter(o => o.patientId === patientId && o.category === 'Medication' && o.status === 'active' && !!o.medication)
    .sort((a, b) =>
      KIND_ORDER.indexOf(medicationKind(a)) - KIND_ORDER.indexOf(medicationKind(b))
      || a.medication!.drug.localeCompare(b.medication!.drug)
      || a.orderId.localeCompare(b.orderId))
}

/** the order's signing stamp (the `signed` audit event), if recorded */
export const signedTimeOf = (o: Order): string | null =>
  o.history.find(e => e.action === 'signed')?.time ?? null

/** the study's most recent clinical stamp: reported → performed → ordered */
export const imagingStamp = (s: ImagingStudy): string =>
  s.reportedAt || s.performedAt || s.orderedAt || ''

const stampKey = (s: ImagingStudy): number => {
  const t = imagingStamp(s)
  return t ? timestampMinutes(t) : Number.MIN_SAFE_INTEGER
}

/** the patient's recorded studies, newest first (patientId re-checked) */
export function patientImagingStudies(studies: ImagingStudy[], patientId: string): ImagingStudy[] {
  return studies
    .filter(s => s.patientId === patientId)
    .sort((a, b) => stampKey(b) - stampKey(a) || b.studyId.localeCompare(a.studyId))
}

import type { ComponentType } from 'react'
import { ActiveOrdersSheet } from './templates/ActiveOrdersSheet'
import { AdmissionNote } from './templates/AdmissionNote'
import { ConsultReport } from './templates/ConsultReport'
import { DailyProgressNote } from './templates/DailyProgressNote'
import { DischargeSummary } from './templates/DischargeSummary'
import { FaceSheet } from './templates/FaceSheet'
import { ImagingReport } from './templates/ImagingReport'
import { LabReport } from './templates/LabReport'
import { MedicationOrdersSheet } from './templates/MedicationOrdersSheet'
import { SbarSheet } from './templates/SbarSheet'
import { TransferSummary } from './templates/TransferSummary'
import { MarSheet } from './templates/MarSheet'
import { VentDeviceReport } from './templates/VentDeviceReport'
import { VitalsFlowsheet } from './templates/VitalsFlowsheet'
import {
  buildActiveOrders, buildAdmissionNote, buildConsultReport, buildDailyProgress,
  buildDischargeSummary, buildFaceSheet, buildImagingReport, buildLabReport,
  buildMar, buildMedicationOrders, buildSbar, buildTransferSummary, buildVentDeviceReport,
  buildVitalsFlowsheet,
} from './selectors'
import type { PrintContext } from './types'

/* ==================== Template registry ====================
   The single place a printable document is defined: id (the route
   segment), display metadata, page orientation, the read-only data
   builder, and the rendering component. Adding one of the remaining ten
   templates is one selector + one component + one entry here — the
   route, hub card, layout, print CSS and loading path are all shared. */

export interface PrintTemplateDef {
  id: string
  title: string
  description: string
  orientation: 'portrait' | 'landscape'
  /** whether the hub offers discharged encounters as targets */
  encounterScope: 'open' | 'any'
  /** prepared read-only data; null = the patient/encounter resolves to
   *  nothing (the locked not-found rule applies) */
  load: (patientId: string, encounterId?: string) => Promise<{ context: PrintContext } | null>
  Component: ComponentType<{ data: never }>
}

const def = <T extends { context: PrintContext }>(t: {
  id: string
  title: string
  description: string
  orientation: 'portrait' | 'landscape'
  encounterScope: 'open' | 'any'
  load: (patientId: string, encounterId?: string) => Promise<T | null>
  Component: ComponentType<{ data: T }>
}): PrintTemplateDef => t as unknown as PrintTemplateDef

export const PRINT_TEMPLATES: PrintTemplateDef[] = [
  /* ---- Print Center Contract v1.0 (docs/print-center-contract.md) ----
     hub order follows the contract enumeration; the Phase-1 ICU
     Admission Note is retained as an implemented additional document
     (flagged in the contract for the validator's next review). */
  def({
    id: 'face-sheet',
    title: 'Patient Face Sheet',
    description: 'Registration-style identity and encounter summary — the file-open / transfer banner document; next-of-kin and payer as write-ins (not recorded by the system).',
    orientation: 'portrait',
    encounterScope: 'any',
    load: buildFaceSheet,
    Component: FaceSheet,
  }),
  def({
    id: 'admission-note',
    title: 'ICU Admission Note',
    description: 'Identity, admission diagnosis, allergies, bedside snapshot, medication orders and investigations this encounter, structured write-in assessment/plan.',
    orientation: 'portrait',
    encounterScope: 'any',
    load: buildAdmissionNote,
    Component: AdmissionNote,
  }),
  def({
    id: 'daily-progress',
    title: 'Daily Progress Note',
    description: 'Interval events, bedside snapshot, active problems, ventilation flag, active medications, latest labs per panel, write-in assessment and plan.',
    orientation: 'portrait',
    encounterScope: 'open',
    load: buildDailyProgress,
    Component: DailyProgressNote,
  }),
  def({
    id: 'active-orders',
    title: 'Active Orders Sheet',
    description: 'All active physician orders, every category, from the persisted order record; pending-signature orders labeled separately as not in force.',
    orientation: 'portrait',
    encounterScope: 'open',
    load: buildActiveOrders,
    Component: ActiveOrdersSheet,
  }),
  def({
    id: 'medication-orders',
    title: 'Medication Orders',
    description: 'Current medication prescriptions in full detail (dose, route, frequency, duration, PRN) from the persisted orders — never the live formulary.',
    orientation: 'portrait',
    encounterScope: 'open',
    load: buildMedicationOrders,
    Component: MedicationOrdersSheet,
  }),
  def({
    id: 'lab-report',
    title: 'Laboratory Report',
    description: 'All laboratory results this encounter with reference ranges, flags, and acknowledgment status.',
    orientation: 'portrait',
    encounterScope: 'any',
    load: buildLabReport,
    Component: LabReport,
  }),
  def({
    id: 'imaging-report',
    title: 'Imaging Report',
    description: 'All imaging studies this encounter with report and impression text as persisted, status progression, and acknowledgment status.',
    orientation: 'portrait',
    encounterScope: 'any',
    load: buildImagingReport,
    Component: ImagingReport,
  }),
  def({
    id: 'sbar',
    title: 'Nursing Notes / SBAR',
    description: 'Nursing handoff sheet: S/B/A/R write-ins with real identity, active-medication context, and the nursing documentation the feed carries.',
    orientation: 'portrait',
    encounterScope: 'open',
    load: buildSbar,
    Component: SbarSheet,
  }),
  def({
    id: 'consult-report',
    title: 'Consultation Report',
    description: 'Specialist consultations in chronological order as the record carries them, plus a write-in for paper-documented consultations.',
    orientation: 'portrait',
    encounterScope: 'any',
    load: buildConsultReport,
    Component: ConsultReport,
  }),
  def({
    id: 'transfer-summary',
    title: 'Transfer / Referral Summary',
    description: 'For moving the patient to another unit or hospital: identity, ADT record, active medications at transfer, latest labs, and handover write-ins.',
    orientation: 'portrait',
    encounterScope: 'open',
    load: buildTransferSummary,
    Component: TransferSummary,
  }),
  def({
    id: 'discharge-summary',
    title: 'Discharge Summary',
    description: 'Course, medications at discharge (from the discharge-cascade audit record), medications stopped during admission with reasons, changes, follow-up.',
    orientation: 'portrait',
    encounterScope: 'any',
    load: buildDischargeSummary,
    Component: DischargeSummary,
  }),
  /* ---- Stage 11 templates (contract #11/#12/#13 — the deferred three,
     now built on the real Observation model + persisted administrations) ---- */
  def({
    id: 'mar',
    title: 'Medication Administration Record',
    description: 'Doses administered this encounter — each medication’s own scheduled slots with given/held/refused status, actual time, administering nurse, and the recorded reason when a dose was not given.',
    orientation: 'portrait',
    encounterScope: 'any',
    load: buildMar,
    Component: MarSheet,
  }),
  def({
    id: 'vitals-flowsheet',
    title: 'Vital Signs / Observation Flowsheet',
    description: '24 hours of charted observations as an hourly grid — vital signs, neurological assessment and fluid balance, with per-hour computed totals (Net Balance, Total I/O, GCS Total). Landscape.',
    orientation: 'landscape',
    encounterScope: 'any',
    load: buildVitalsFlowsheet,
    Component: VitalsFlowsheet,
  }),
  def({
    id: 'ventilator-device-report',
    title: 'Ventilator & Device Report',
    description: 'Current ventilator setup from the latest charted settings (with derived Driving Pressure), plus device sections — infusion pumps, ECMO, CRRT, ICP — honestly empty until device observations exist.',
    orientation: 'portrait',
    encounterScope: 'any',
    load: buildVentDeviceReport,
    Component: VentDeviceReport,
  }),
]

export const templateById = (id: string | undefined): PrintTemplateDef | undefined =>
  PRINT_TEMPLATES.find(t => t.id === id)

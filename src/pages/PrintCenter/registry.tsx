import type { ComponentType } from 'react'
import { AdmissionNote } from './templates/AdmissionNote'
import { DailyProgressNote } from './templates/DailyProgressNote'
import { DischargeSummary } from './templates/DischargeSummary'
import { buildAdmissionNote, buildDailyProgress, buildDischargeSummary } from './selectors'
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
    id: 'discharge-summary',
    title: 'Discharge Summary',
    description: 'Course, medications at discharge (from the discharge-cascade audit record), medications stopped during admission with reasons, changes, follow-up.',
    orientation: 'portrait',
    encounterScope: 'any',
    load: buildDischargeSummary,
    Component: DischargeSummary,
  }),
]

export const templateById = (id: string | undefined): PrintTemplateDef | undefined =>
  PRINT_TEMPLATES.find(t => t.id === id)

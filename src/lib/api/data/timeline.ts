import type {
  LabDraw, LabResultItem, Order, OrderEvent, TimelineCategory, TimelineEvent,
} from '../types'
import { timestampMinutes } from '../../time'
import { allOrders } from './orders'
import { imagingFor, labDrawsFor } from './results'
import { IO_ENTRIES, NURSING_TASKS } from './nursing'
import { consultsFor } from './consults'
import { notesFor } from './notes'

/* Timeline aggregation — Screen 7. This is a DERIVATION, not a store: every
   event below is read from a canonical source (order audit history, lab
   draws, imaging studies, nursing tasks, I&O, consults, clinical notes) at
   call time. Nothing here is persisted, duplicated, or mutated — the feed
   is read-only and always reflects the current state of the sources. */

const CATEGORY_LABEL: Record<TimelineCategory, string> = {
  order: 'ORDER', med: 'MED', lab: 'LAB', imaging: 'IMAGING',
  task: 'TASK', io: 'I&O', consult: 'CONSULT', note: 'NOTE',
}

const ORDER_ACTION_TITLE: Record<OrderEvent['action'], string> = {
  created: 'Order placed',
  signed: 'Order signed',
  modified: 'Order modified',
  implemented: 'Order implemented',
  administered: 'Dose given',
  held: 'Dose held',
  refused: 'Dose refused',
  completed: 'Order completed',
  discontinued: 'Order discontinued',
}

const fmt = (v: number): string => (Number.isInteger(v) ? String(v) : v.toFixed(1))

const abnormalSummary = (items: LabResultItem[]): string => {
  const flagged = items.filter(i => i.flag !== 'normal')
  if (!flagged.length) return 'All values within reference range'
  return flagged.map(i => `${i.analyte} ${fmt(i.value)}${i.unit ? ` ${i.unit}` : ''}`).join(' · ')
}

function orderEvents(o: Order): TimelineEvent[] {
  const category: TimelineCategory = o.category === 'Medication' ? 'med' : 'order'
  return o.history.map((ev, i) => ({
    id: `${o.orderId}-h${i}`,
    patientId: o.patientId,
    time: ev.time,
    category,
    categoryLabel: CATEGORY_LABEL[category],
    title: `${ORDER_ACTION_TITLE[ev.action]} — ${o.summary}`,
    detail: ev.detail,
    actor: ev.actor,
    link: `/orders/${o.patientId}`,
    refId: o.orderId,
  }))
}

function labEvents(d: LabDraw): TimelineEvent[] {
  const events: TimelineEvent[] = [{
    id: `${d.labId}-res`,
    patientId: d.patientId,
    time: d.resultedAt,
    category: 'lab',
    categoryLabel: CATEGORY_LABEL.lab,
    title: `${d.panel} panel resulted`,
    detail: d.note ? `${abnormalSummary(d.items)} — ${d.note}` : abnormalSummary(d.items),
    flag: d.flag,
    link: `/labs/${d.patientId}`,
    refId: d.labId,
  }]
  if (d.acknowledged && d.acknowledgedAt && d.acknowledgedBy) {
    events.push({
      id: `${d.labId}-ack`,
      patientId: d.patientId,
      time: d.acknowledgedAt,
      category: 'lab',
      categoryLabel: CATEGORY_LABEL.lab,
      title: `${d.panel} results acknowledged`,
      actor: d.acknowledgedBy,
      link: `/labs/${d.patientId}`,
      refId: d.labId,
    })
  }
  return events
}

function imagingEvents(patientId: string): TimelineEvent[] {
  const events: TimelineEvent[] = []
  for (const s of imagingFor(patientId)) {
    const base = {
      patientId, category: 'imaging' as const, categoryLabel: CATEGORY_LABEL.imaging,
      link: `/labs/${patientId}`, refId: s.studyId,
    }
    events.push({ ...base, id: `${s.studyId}-ord`, time: s.orderedAt, title: `${s.description} — ordered` })
    if (s.performedAt)
      events.push({ ...base, id: `${s.studyId}-perf`, time: s.performedAt, title: `${s.description} — performed` })
    if (s.reportedAt)
      events.push({
        ...base, id: `${s.studyId}-rep`, time: s.reportedAt,
        title: `${s.description} — ${s.status === 'final' ? 'final report' : 'preliminary report'}`,
        detail: s.impression, flag: s.flag,
      })
    if (s.acknowledged && s.acknowledgedAt && s.acknowledgedBy)
      events.push({
        ...base, id: `${s.studyId}-ack`, time: s.acknowledgedAt,
        title: `${s.description} — report acknowledged`, actor: s.acknowledgedBy,
      })
  }
  return events
}

/** GET /api/icu/patients/:patientId/timeline — newest first. */
export function deriveTimeline(patientId: string): TimelineEvent[] {
  const events: TimelineEvent[] = [
    ...allOrders().filter(o => o.patientId === patientId).flatMap(orderEvents),
    ...labDrawsFor(patientId).flatMap(labEvents),
    ...imagingEvents(patientId),
    ...NURSING_TASKS
      .filter(t => t.patientId === patientId && t.done && t.completedAt)
      .map(t => ({
        id: `${t.taskId}-done`, patientId, time: t.completedAt!,
        category: 'task' as const, categoryLabel: CATEGORY_LABEL.task,
        title: `${t.label} — completed`, detail: `due ${t.dueTime} · ${t.recurrence}`,
        actor: t.completedBy, link: '/nurse', refId: t.taskId,
      })),
    ...IO_ENTRIES
      .filter(e => e.patientId === patientId)
      .map(e => ({
        id: e.entryId, patientId, time: e.time,
        category: 'io' as const, categoryLabel: CATEGORY_LABEL.io,
        title: `${e.kind === 'intake' ? 'Intake' : 'Output'} — ${e.category} ${e.volumeMl} mL`,
        link: '/nurse', refId: e.entryId,
      })),
    ...consultsFor(patientId).map(c => ({
      id: c.consultId, patientId, time: c.time,
      category: 'consult' as const, categoryLabel: CATEGORY_LABEL.consult,
      title: `${c.specialty} consult`, detail: c.message,
      link: '/workspace', refId: c.consultId,
    })),
    ...notesFor(patientId).map(n => ({
      id: n.noteId, patientId, time: n.time,
      category: 'note' as const, categoryLabel: n.kind.toUpperCase(),
      title: n.text, actor: n.author, refId: n.noteId,
    })),
  ]
  return events.sort((a, b) => timestampMinutes(b.time) - timestampMinutes(a.time))
}

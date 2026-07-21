import { useEffect, useState } from 'react'
import './NurseWorkspace.css'
import { AppHeader, type KpiSpec } from '../../components/AppHeader'
import { NavSidebar } from '../../components/NavSidebar'
import { Toast, useToast } from '../../components/Toast'
import { displayStamp, dueStateFor, nowHm, useNow } from '../../lib/time'
import { IconCheck, IconPencil, IconUsers } from '../../components/icons'
import {
  completeImplementation, documentAdministration, getImplementationQueue, getIoEntries,
  getHandoffEntries, getMarRows, getNurseWorklist, getNursingTasks, recordIoEntry, toggleNursingTask, writeHandoff,
} from '../../lib/api'
import type {
  AdministrationAction, AssignedPatient, IoEntry, IoKind, MarRow, MineWorklist, NursingTask, Order,
  HandoffEntry,
} from '../../lib/api/types'
import { getSession, initialsOf, profileOf } from '../../lib/session'
import { AssignedPatientsCard } from './AssignedPatientsCard'
import { MarCard } from './MarCard'
import { OrdersCard } from './OrdersCard'
import { TasksCard } from './TasksCard'
import { IoCard } from './IoCard'
import { SbarCard, type SbarNote } from './SbarCard'



/** Screen 4 — Nurse Workspace. RBAC (locked decision): administer + document
 *  only. No order origination anywhere on this screen. MAR and Orders to
 *  Implement are derived views over the canonical Order model (Screen 5). */
export function NurseWorkspace() {
  /* behind RequireSession(meds.administer) — session is present */
  const session = getSession()!
  const { toast, showToast } = useToast()
  /* the OPT-OUT worklist (Assignment Simplification): every nurse covers
     every patient by default — the list is ALL open patients minus this
     nurse's carved removals. No setup needed; no Unassigned panel exists
     (the server refuses removing the last covering nurse, so an
     uncovered patient is impossible, not merely visible). */
  const [worklist, setWorklist] = useState<{ mine: MineWorklist; patients: AssignedPatient[] } | null>(null)
  const [mar, setMar] = useState<MarRow[] | null>(null)
  const [orders, setOrders] = useState<Order[] | null>(null)
  const [implementedIds, setImplementedIds] = useState<Set<string>>(new Set())
  /* undefined = loading · null = NOT A DOMAIN YET (production honest-empty,
     Phase 3 PR 1) · value = data */
  const [tasks, setTasks] = useState<NursingTask[] | null | undefined>(undefined)
  const [io, setIo] = useState<IoEntry[] | null | undefined>(undefined)
  /* the SBAR handoff series per selected patient — REAL data from the
     append-only store (undefined = loading, null = unreachable). The
     old page-local Record<pid, note> that silently discarded every
     save on navigation is DELETED — the data-loss bug this replaces. */
  const [handoffs, setHandoffs] = useState<Record<string, HandoffEntry[] | null | undefined>>({})
  const [handoffBusy, setHandoffBusy] = useState(false)

  const loadHandoffs = (patientId: string) => {
    if (!patientId) return
    setHandoffs(prev => ({ ...prev, [patientId]: prev[patientId] ?? undefined }))
    getHandoffEntries(patientId).then(entries =>
      setHandoffs(prev => ({ ...prev, [patientId]: entries })))
  }

  useEffect(() => {
    getNurseWorklist(session.name, session.jobTitle).then(w => {
      setWorklist(w)
      const ids = w.patients.map(p => p.patientId)
      getMarRows(ids).then(setMar)
      getImplementationQueue(ids).then(setOrders)
      if (ids[0]) loadHandoffs(ids[0])
    })
    getNursingTasks().then(setTasks)
    getIoEntries().then(setIo)
  }, [session.name, session.jobTitle])

  const patients = worklist?.patients ?? []
  const patientName = (patientId: string) => patients.find(p => p.patientId === patientId)?.name ?? patientId

  /* MAR: documentation APPENDS an administration fact on the canonical
     order (derived schedule — nothing stored is consumed), so the honest
     next state is a fresh derivation: re-fetch rather than patch rows */
  const documentMar = (orderId: string, adminId: string, action: AdministrationAction, reason?: string, administeredAt?: string) => {
    const row = mar?.find(r => r.orderId === orderId && r.adminId === adminId)
    documentAdministration(orderId, adminId, action, session.name, session.jobTitle, reason, administeredAt).then(updated => {
      if (!updated) return
      const facts = updated.administrations?.filter(a => a.status === action) ?? []
      const fact = facts[facts.length - 1]
      getMarRows(patients.map(p => p.patientId)).then(setMar)
      if (row) showToast('Documented', `${row.medication} — ${action} ${displayStamp(fact?.documentedTime) || nowHm()} · ${patientName(row.patientId)}`)
    })
  }

  const completeOrder = (orderId: string) => {
    const order = orders?.find(o => o.orderId === orderId)
    completeImplementation(orderId, session.name, session.jobTitle).then(updated => {
      if (!updated) return
      setImplementedIds(prev => new Set(prev).add(orderId))
      if (order) showToast('Order implemented', `${order.priority} · ${patientName(order.patientId)} · ${nowHm()}`)
    })
  }

  /* both write to the nursing store via the service layer (not page-local
     state) so derived views — e.g. the Timeline — see them */
  const toggleTask = (taskId: string) => {
    toggleNursingTask(taskId, session.name, session.jobTitle).then(updated => {
      if (!updated) return
      setTasks(prev => prev && prev.map(t => (t.taskId === taskId ? updated : t)))
    }).catch((e: Error) => {
      /* the SBAR lesson: a write that stores nothing must be SEEN to
         fail — a rejected action the nurse reads, never a silent no-op
         and never the full-screen overlay */
      showToast('Task NOT recorded', e.message)
    })
  }

  const recordIo = (patientId: string, kind: IoKind, category: string, volumeMl: number) => {
    recordIoEntry({ patientId, kind, category, volumeMl }, session.jobTitle).then(entry => {
      if (!entry) return
      setIo(prev => prev && [...prev, entry])
      showToast('I&O recorded', `${kind === 'intake' ? '+' : '−'}${volumeMl} mL ${category} · ${patientName(patientId)} · ${entry.time}`)
    }).catch((e: Error) => {
      /* same SBAR lesson as toggleTask above: visibly refused */
      showToast('I&O NOT recorded', e.message)
    })
  }

  /* append ONE immutable entry — the toast fires only on the server's
     confirmation (the old fixture toasted while saving nothing) */
  const saveSbar = async (patientId: string, note: SbarNote): Promise<boolean> => {
    setHandoffBusy(true)
    try {
      const res = await writeHandoff(patientId, note)
      if (res.kind === 'ok') {
        showToast('Handoff recorded', `${res.data.handoffId} · ${patientName(patientId)} · ${res.data.recordedAt}`)
        loadHandoffs(patientId)
        return true
      }
      showToast('Handoff NOT recorded', res.kind === 'rejected' ? res.error : 'the server is not reachable — nothing was saved')
      return false
    } finally {
      setHandoffBusy(false)
    }
  }

  const now = useNow()
  const medsDue = mar?.filter(
    r => r.status === 'scheduled' && !r.prn && dueStateFor(r.scheduledTime, now) !== 'upcoming',
  ).length
  const ordersPending = orders ? orders.filter(o => !implementedIds.has(o.orderId)).length : undefined
  const tasksOpen = tasks ? tasks.filter(t => !t.done).length : undefined

  const kpis: KpiSpec[] = [
    { icon: <IconUsers size={14} stroke="var(--blue)" />, iconBg: 'rgba(var(--blue-rgb),.15)', value: worklist ? patients.length : '—', label: 'My Patients' },
    {
      icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--cyan)" strokeWidth="2" strokeLinecap="round"><rect x="7" y="2" width="10" height="20" rx="4" /><path d="M7 9h10M7 15h10" /></svg>,
      iconBg: 'rgba(var(--cyan-rgb),.13)', value: medsDue ?? '—', label: 'Meds Due',
      valueStyle: medsDue ? { color: 'var(--amber)' } : undefined,
    },
    { icon: <IconPencil size={14} stroke="var(--amber)" />, iconBg: 'rgba(var(--amber-rgb),.14)', value: ordersPending ?? '—', label: 'Orders to Impl.' },
    { icon: <IconCheck size={14} stroke="var(--green)" strokeWidth={2} />, iconBg: 'rgba(var(--green-rgb),.13)', value: tasksOpen ?? '—', label: 'Tasks Open' },
  ]

  return (
    <div className="app-frame nw">
      <AppHeader
        subtitle="Nurse Workspace"
        kpis={kpis}
        user={{ initials: initialsOf(session.name), name: session.name, role: `${session.jobTitle} · ${profileOf(session.jobTitle)} profile` }}
      />
      <div className="shell">
        <NavSidebar
          active="dashboard"
          alertCount={3}
          footerLines={['Role: Nurse profile', 'Administer + document only']}
        />
        <main>
          <div className="col">
            {worklist && <AssignedPatientsCard patients={patients} />}
            {mar && worklist && <MarCard rows={mar} patients={patients} onDocument={documentMar} />}
            {io !== undefined && worklist && <IoCard entries={io} patients={patients} onRecord={recordIo} />}
          </div>
          <div className="col">
            {orders && <OrdersCard orders={orders} completedIds={implementedIds} onComplete={completeOrder} />}
            {tasks !== undefined && <TasksCard tasks={tasks} onToggle={toggleTask} />}
            {worklist && <SbarCard patients={patients} entriesByPatient={handoffs} busy={handoffBusy} onSelect={loadHandoffs} onSave={saveSbar} />}
          </div>
        </main>
      </div>
      <Toast state={toast} accent="green" />
    </div>
  )
}

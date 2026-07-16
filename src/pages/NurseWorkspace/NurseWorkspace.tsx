import { useEffect, useState } from 'react'
import './NurseWorkspace.css'
import { AppHeader, type KpiSpec } from '../../components/AppHeader'
import { NavSidebar } from '../../components/NavSidebar'
import { Toast, useToast } from '../../components/Toast'
import { displayStamp, dueStateFor, nowHm, useNow } from '../../lib/time'
import { IconCheck, IconPencil, IconUsers } from '../../components/icons'
import {
  completeImplementation, documentAdministration, getImplementationQueue, getIoEntries,
  getMarRows, getNurseWorklist, getNursingTasks, getUnassignedPatients, recordIoEntry, toggleNursingTask,
} from '../../lib/api'
import type {
  AdministrationAction, AssignedPatient, Assignment, IoEntry, IoKind, MarRow, NursingTask, Order,
  UnassignedPatient,
} from '../../lib/api/types'
import { getSession, initialsOf, profileOf } from '../../lib/session'
import { AssignedPatientsCard } from './AssignedPatientsCard'
import { UnassignedCard } from '../../components/UnassignedCard'
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
  /* the REAL worklist (Patient Assignment & Responsibility): the signed-in
     nurse's ACTIVE assignments — bound to the USER + active role (#104),
     never a fixture. Zero assignments is a valid, honest state: the cards
     render empty and the Unassigned panel is the safety net. */
  const [worklist, setWorklist] = useState<{ assignments: Assignment[]; patients: AssignedPatient[] } | null>(null)
  const [unassigned, setUnassigned] = useState<UnassignedPatient[] | null>(null)
  const [mar, setMar] = useState<MarRow[] | null>(null)
  const [orders, setOrders] = useState<Order[] | null>(null)
  const [implementedIds, setImplementedIds] = useState<Set<string>>(new Set())
  const [tasks, setTasks] = useState<NursingTask[] | null>(null)
  const [io, setIo] = useState<IoEntry[] | null>(null)
  const [sbarNotes, setSbarNotes] = useState<Record<string, SbarNote>>({})

  useEffect(() => {
    getNurseWorklist(session.name, session.jobTitle).then(w => {
      setWorklist(w)
      const ids = w.patients.map(p => p.patientId)
      getMarRows(ids).then(setMar)
      getImplementationQueue(ids).then(setOrders)
    })
    /* the Unassigned panel (unit-level safety view): open encounters with
       no active NURSE — so no patient silently falls through */
    getUnassignedPatients().then(u => setUnassigned(u.nurse)).catch(() => setUnassigned([]))
    getNursingTasks().then(setTasks)
    getIoEntries().then(setIo)
  }, [session.name, session.jobTitle])

  const patients = worklist?.patients ?? []
  /* the shift LABEL(s) on my active assignments — chosen by the assigner,
     shown as-is (no fabricated hours) */
  const shifts = [...new Set((worklist?.assignments ?? []).map(a => a.shift))]
  const patientName = (patientId: string) => patients.find(p => p.patientId === patientId)?.name ?? patientId

  /* MAR: documentation APPENDS an administration fact on the canonical
     order (derived schedule — nothing stored is consumed), so the honest
     next state is a fresh derivation: re-fetch rather than patch rows */
  const documentMar = (orderId: string, adminId: string, action: AdministrationAction, reason?: string) => {
    const row = mar?.find(r => r.orderId === orderId && r.adminId === adminId)
    documentAdministration(orderId, adminId, action, session.name, session.jobTitle, reason).then(updated => {
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
    })
  }

  const recordIo = (patientId: string, kind: IoKind, category: string, volumeMl: number) => {
    recordIoEntry({ patientId, kind, category, volumeMl }, session.jobTitle).then(entry => {
      if (!entry) return
      setIo(prev => prev && [...prev, entry])
      showToast('I&O recorded', `${kind === 'intake' ? '+' : '−'}${volumeMl} mL ${category} · ${patientName(patientId)} · ${entry.time}`)
    })
  }

  const saveSbar = (patientId: string, note: SbarNote) => {
    setSbarNotes(prev => ({ ...prev, [patientId]: note }))
    showToast('Handoff saved', `SBAR note for ${patientName(patientId)} · ${nowHm()}`)
  }

  const now = useNow()
  const medsDue = mar?.filter(
    r => r.status === 'scheduled' && !r.prn && dueStateFor(r.scheduledTime, now) !== 'upcoming',
  ).length
  const ordersPending = orders ? orders.filter(o => !implementedIds.has(o.orderId)).length : undefined
  const tasksOpen = tasks?.filter(t => !t.done).length

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
        user={{ initials: initialsOf(session.name), name: session.name, role: `${session.jobTitle} · ${profileOf(session.jobTitle)} profile${shifts.length > 0 ? ` · ${shifts.join('/')} shift` : ''}` }}
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
            {io && worklist && <IoCard entries={io} patients={patients} onRecord={recordIo} />}
          </div>
          <div className="col">
            {/* the safety net: nurse-unassigned open encounters, visible to
                everyone — zero assignments is allowed but never silent */}
            {unassigned && <UnassignedCard kind="nurse" patients={unassigned} />}
            {orders && <OrdersCard orders={orders} completedIds={implementedIds} onComplete={completeOrder} />}
            {tasks && <TasksCard tasks={tasks} onToggle={toggleTask} />}
            {worklist && <SbarCard patients={patients} notes={sbarNotes} onSave={saveSbar} />}
          </div>
        </main>
      </div>
      <Toast state={toast} accent="green" />
    </div>
  )
}

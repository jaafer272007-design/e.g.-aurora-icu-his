import { useEffect, useState } from 'react'
import './NurseWorkspace.css'
import { AppHeader, type KpiSpec } from '../../components/AppHeader'
import { NavSidebar } from '../../components/NavSidebar'
import { Toast, useToast } from '../../components/Toast'
import { IconCheck, IconPencil, IconUsers } from '../../components/icons'
import {
  getIoEntries, getMarEntries, getNurseAssignment, getNursingTasks, getOrdersToImplement,
} from '../../lib/api'
import type {
  ImplementOrder, IoEntry, IoKind, MarAction, MarEntry, NurseAssignmentResponse, NursingTask,
} from '../../lib/api/types'
import { AssignedPatientsCard } from './AssignedPatientsCard'
import { MarCard } from './MarCard'
import { OrdersCard } from './OrdersCard'
import { TasksCard } from './TasksCard'
import { IoCard } from './IoCard'
import { SbarCard, type SbarNote } from './SbarCard'

const nowHm = () => new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })

/** Screen 4 — Nurse Workspace. RBAC (locked decision): administer + document
 *  only. No order origination anywhere on this screen. */
export function NurseWorkspace() {
  const { toast, showToast } = useToast()
  const [assignment, setAssignment] = useState<NurseAssignmentResponse | null>(null)
  const [mar, setMar] = useState<MarEntry[] | null>(null)
  const [orders, setOrders] = useState<ImplementOrder[] | null>(null)
  const [tasks, setTasks] = useState<NursingTask[] | null>(null)
  const [io, setIo] = useState<IoEntry[] | null>(null)
  const [sbarNotes, setSbarNotes] = useState<Record<string, SbarNote>>({})

  useEffect(() => {
    getNurseAssignment().then(setAssignment)
    getMarEntries().then(setMar)
    getOrdersToImplement().then(setOrders)
    getNursingTasks().then(setTasks)
    getIoEntries().then(setIo)
  }, [])

  const patients = assignment?.patients ?? []
  const patientName = (patientId: string) => patients.find(p => p.patientId === patientId)?.name ?? patientId

  /* MAR: document administration (POST /nursing/mar/:marId/administration later) */
  const documentMar = (marId: string, action: MarAction) => {
    const time = nowHm()
    setMar(prev => prev && prev.map(e => (e.marId === marId ? { ...e, status: action, documentedTime: time } : e)))
    const entry = mar?.find(e => e.marId === marId)
    if (entry) showToast('Documented', `${entry.medication} — ${action} ${time} · ${patientName(entry.patientId)}`)
  }

  const completeOrder = (orderId: string) => {
    setOrders(prev => prev && prev.map(o => (o.orderId === orderId ? { ...o, done: true } : o)))
    const order = orders?.find(o => o.orderId === orderId)
    if (order) showToast('Order implemented', `${order.priority} · ${patientName(order.patientId)} · ${nowHm()}`)
  }

  const toggleTask = (taskId: string) => {
    setTasks(prev => prev && prev.map(t => (t.taskId === taskId ? { ...t, done: !t.done } : t)))
  }

  const recordIo = (patientId: string, kind: IoKind, category: string, volumeMl: number) => {
    const time = nowHm()
    setIo(prev => prev && [...prev, { entryId: `IO-LOCAL-${Date.now()}`, patientId, kind, category, volumeMl, time }])
    showToast('I&O recorded', `${kind === 'intake' ? '+' : '−'}${volumeMl} mL ${category} · ${patientName(patientId)} · ${time}`)
  }

  const saveSbar = (patientId: string, note: SbarNote) => {
    setSbarNotes(prev => ({ ...prev, [patientId]: note }))
    showToast('Handoff saved', `SBAR note for ${patientName(patientId)} · ${nowHm()}`)
  }

  const medsDue = mar?.filter(e => e.status === 'due' || e.status === 'overdue').length
  const ordersPending = orders?.filter(o => !o.done).length
  const tasksOpen = tasks?.filter(t => !t.done).length

  const kpis: KpiSpec[] = [
    { icon: <IconUsers size={14} stroke="var(--blue)" />, iconBg: 'rgba(77,163,255,.15)', value: assignment ? patients.length : '—', label: 'My Patients' },
    {
      icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--cyan)" strokeWidth="2" strokeLinecap="round"><rect x="7" y="2" width="10" height="20" rx="4" /><path d="M7 9h10M7 15h10" /></svg>,
      iconBg: 'rgba(53,224,208,.13)', value: medsDue ?? '—', label: 'Meds Due',
      valueStyle: medsDue ? { color: 'var(--amber)' } : undefined,
    },
    { icon: <IconPencil size={14} stroke="var(--amber)" />, iconBg: 'rgba(255,180,84,.14)', value: ordersPending ?? '—', label: 'Orders to Impl.' },
    { icon: <IconCheck size={14} stroke="var(--green)" strokeWidth={2} />, iconBg: 'rgba(61,232,160,.13)', value: tasksOpen ?? '—', label: 'Tasks Open' },
  ]

  return (
    <div className="app-frame nw">
      <AppHeader
        subtitle="Nurse Workspace"
        kpis={kpis}
        bellCount={3}
        onBellClick={() => showToast('Alerts', '3 active notifications for your patients')}
        user={{
          initials: assignment?.nurse.initials ?? '—',
          name: assignment?.nurse.name ?? '—',
          role: assignment ? `${assignment.nurse.role} · ${assignment.nurse.shift}` : '—',
        }}
      />
      <div className="shell">
        <NavSidebar
          active="dashboard"
          dashboardRoute="/nurse"
          alertCount={3}
          footerLines={['Role: Nurse', 'Administer + document only']}
        />
        <main>
          <div className="col">
            {assignment && <AssignedPatientsCard patients={patients} />}
            {mar && assignment && <MarCard entries={mar} patients={patients} onDocument={documentMar} />}
            {io && assignment && <IoCard entries={io} patients={patients} onRecord={recordIo} />}
          </div>
          <div className="col">
            {orders && <OrdersCard orders={orders} onComplete={completeOrder} />}
            {tasks && <TasksCard tasks={tasks} onToggle={toggleTask} />}
            {assignment && <SbarCard patients={patients} notes={sbarNotes} onSave={saveSbar} />}
          </div>
        </main>
      </div>
      <Toast state={toast} accent="green" />
    </div>
  )
}

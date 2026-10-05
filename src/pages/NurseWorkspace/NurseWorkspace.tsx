import { useEffect, useRef, useState } from 'react'
import './NurseWorkspace.css'
import { AppHeader, type KpiSpec } from '../../components/AppHeader'
import { NavSidebar } from '../../components/NavSidebar'
import { Toast, useToast } from '../../components/Toast'
import { displayFullStamp, displayStamp, dueStateFor, nowHm, useNow } from '../../lib/time'
import { IconCheck, IconPencil, IconUsers } from '../../components/icons'
import {
  completeImplementation, documentAdministration, getImplementationQueue, getIoEntries,
  getHandoffEntries, getMarRows, getMarRowsAuthoritative, getNurseWorklist, getNursingTasks, recordIoEntry, toggleNursingTask, writeHandoff,
} from '../../lib/api'
import type {
  AdministrationAction, AssignedPatient, IoEntry, IoKind, MarRow, MineWorklist, NursingTask, Order,
  HandoffEntry,
} from '../../lib/api/types'
import { getSession, initialsOf, profileOf } from '../../lib/session'
import { DataAge } from '../../components/DataAge'
import { usePollTick } from '../../hooks/useLive'
import { AssignedPatientsCard } from './AssignedPatientsCard'
import { MarCard } from './MarCard'
import { OrdersCard } from './OrdersCard'
import { TasksCard } from './TasksCard'
import { IoCard } from './IoCard'
import { SbarCard, type SbarNote } from './SbarCard'

/* an UNCERTAIN documentation (no answer) is settled as NOT recorded only by
   a server read started at least this long after the failure — a request
   still queued on the server (e.g. waiting for the order lock) gets the
   time to land first; a recorded one is confirmed by the first read */
const UNCERTAIN_SETTLE_MS = 15_000

/* server refusals carry UTC wire stamps — the nurse reads hospital time */
const localizeStamps = (s: string) =>
  s.replace(/(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})/g, (_m, d: string, t: string) => displayFullStamp(`${d} ${t}`))

/** one order's documentation, from the click until a fresh SERVER read
 *  settles it: 'saving' while the request runs, then 'settling' */
interface MarLock {
  phase: 'saving' | 'settling'
  /** the order's fact ids before the click — what settles an uncertain outcome */
  before: Set<string>
  uncertain: boolean
  failedAt: number
  label: string
  action: AdministrationAction
}

const factIdsOf = (rows: MarRow[] | null, orderId: string) =>
  new Set((rows ?? []).filter(r => r.orderId === orderId && r.status !== 'scheduled').map(r => r.adminId))



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

  /* LIVE (step 2): the assigned-patient worklist, its MAR rows and the
     implementation queue re-read on the shared poll tick — a dose given or
     an order placed at another station shows here without a reload. */
  const tick = usePollTick()
  const [listAt, setListAt] = useState<number | null>(null)
  /* MAR reads are applied in the order they STARTED: a poll that began
     before a documentation committed can never overwrite the fresher read
     that settled it (which would re-show a resolved round as current) */
  const marSeq = useRef({ started: 0, applied: 0 })
  const applyMar = (seq: number, rows: MarRow[]) => {
    if (seq <= marSeq.current.applied) return
    marSeq.current.applied = seq
    setMar(rows)
  }
  const marIds = useRef<string[]>([])
  useEffect(() => {
    getNurseWorklist(session.name, session.jobTitle).then(w => {
      setWorklist(w)
      setListAt(Date.now())
      const ids = w.patients.map(p => p.patientId)
      marIds.current = ids
      const seq = ++marSeq.current.started
      getMarRows(ids).then(rows => applyMar(seq, rows))
      /* an order still waiting on an unsettled outcome retries here */
      if ([...marLocks.current.values()].some(l => l.phase === 'settling')) void settleMar()
      getImplementationQueue(ids).then(setOrders)
      if (ids[0]) loadHandoffs(ids[0])
    })
    getNursingTasks().then(setTasks)
    getIoEntries().then(setIo)
  }, [session.name, session.jobTitle, tick])

  const patients = worklist?.patients ?? []
  const patientName = (patientId: string) => patients.find(p => p.patientId === patientId)?.name ?? patientId

  /* MAR: documentation APPENDS an administration fact on the canonical
     order (derived schedule — nothing stored is consumed), so the honest
     next state is a fresh derivation: re-fetch rather than patch rows.
     ONE ACTION PER ROUND — SUBMISSION PROTECTION (owner's correction,
     2026-10-05): an order with a documentation in flight, or whose outcome
     a fresh SERVER read has not yet settled, accepts nothing — Given,
     Held, Refused and the reason dialog's confirm alike stay disabled
     through the save AND the authoritative refresh. The ref is the
     immediate guard (a second click in the same frame sees it before
     React re-renders); the state drives the disabled buttons and their
     "saving / checking" line. A refusal is shown with the server's reason.
     An UNCERTAIN outcome (no answer) is settled by comparing the order's
     facts before the click with a fresh server read — never by a blind
     retry; while the server cannot be read the order stays locked and
     the next poll tries again. */
  const marLocks = useRef(new Map<string, MarLock>())
  const [marBusy, setMarBusy] = useState<ReadonlyMap<string, 'saving' | 'checking'>>(() => new Map())
  const syncMarBusy = () => setMarBusy(new Map(
    [...marLocks.current].map(([id, l]) => [id, l.phase === 'saving' ? 'saving' : 'checking'] as const)))
  /* the last refusal per order, shown on its row until it is documented again */
  const [marNotices, setMarNotices] = useState<Record<string, string>>({})
  const setNotice = (orderId: string, text: string | null) => setMarNotices(prev => {
    const next = { ...prev }
    if (text === null) delete next[orderId]; else next[orderId] = text
    return next
  })

  const settleMar = async () => {
    const waiting = [...marLocks.current].filter(([, l]) => l.phase === 'settling')
    if (!waiting.length) return
    const startedAt = Date.now()
    const seq = ++marSeq.current.started
    const fresh = await getMarRowsAuthoritative(marIds.current)
    if (!fresh) return   // the server cannot be read: these orders stay locked; the next poll retries
    applyMar(seq, fresh)
    for (const [orderId, l] of waiting) {
      if (marLocks.current.get(orderId) !== l) continue
      if (l.uncertain) {
        const recorded = [...factIdsOf(fresh, orderId)].some(id => !l.before.has(id)
          && fresh.some(r => r.orderId === orderId && r.adminId === id && r.status === l.action))
        if (!recorded && startedAt - l.failedAt < UNCERTAIN_SETTLE_MS) continue   // too soon to call it — stay locked
        if (recorded) {
          showToast('Documented — confirmed', `${l.label}: a ${l.action} dose is on the record since your attempt`)
        } else {
          showToast('Dose NOT recorded', `${l.label}: the server did not record it — it can be documented again`, 6000)
          setNotice(orderId, 'Not recorded — the server did not answer and has no record of it; document it again if it is still needed.')
        }
      }
      marLocks.current.delete(orderId)
    }
    syncMarBusy()
  }

  const documentMar = async (orderId: string, adminId: string, action: AdministrationAction, reason?: string, administeredAt?: string) => {
    if (marLocks.current.has(orderId)) return   // immediate: one documentation per order at a time
    const row = mar?.find(r => r.orderId === orderId && r.adminId === adminId)
    const label = row ? `${row.medication} · ${patientName(row.patientId)}` : orderId
    const lock: MarLock = { phase: 'saving', before: factIdsOf(mar, orderId), uncertain: false, failedAt: 0, label, action }
    marLocks.current.set(orderId, lock)
    setNotice(orderId, null)
    syncMarBusy()
    const res = await documentAdministration(orderId, adminId, action, session.name, session.jobTitle, reason, administeredAt)
    if (res.kind === 'ok') {
      const facts = res.order.administrations?.filter(a => a.status === action) ?? []
      const fact = facts[facts.length - 1]
      if (row) showToast('Documented', `${row.medication} — ${action} ${displayStamp(fact?.documentedTime) || nowHm()} · ${patientName(row.patientId)}`)
    } else if (res.kind === 'rejected') {
      const why = localizeStamps(res.error)
      showToast('Dose NOT recorded', `${label}: ${why}`, 6000)
      setNotice(orderId, `Not recorded — ${why}`)
    } else {
      lock.uncertain = true
      lock.failedAt = Date.now()
      showToast('Checking the record', `${label}: ${res.error} — the MAR is re-read before this dose can be documented again`, 6000)
      window.setTimeout(() => void settleMar(), UNCERTAIN_SETTLE_MS + 500)
    }
    lock.phase = 'settling'
    syncMarBusy()
    await settleMar()
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
        dataAge={<DataAge at={listAt} live label="Lists" what="The assigned-patient worklist, MAR rows and implementation queue" />}
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
            {mar && worklist && <MarCard rows={mar} patients={patients} busy={marBusy} notices={marNotices} onDocument={documentMar} />}
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

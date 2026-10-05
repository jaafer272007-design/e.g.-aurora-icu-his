import { useEffect, useRef, useState } from 'react'
import './NurseWorkspace.css'
import { AppHeader, type KpiSpec } from '../../components/AppHeader'
import { NavSidebar } from '../../components/NavSidebar'
import { Toast, useToast } from '../../components/Toast'
import { datedEpoch, displayFullStamp, displayStamp, dueStateFor, nowHm, useNow } from '../../lib/time'
import { instanceStamp } from '../../lib/marSchedule'
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
import { MarCard, type MarBusy } from './MarCard'
import { OrdersCard } from './OrdersCard'
import { TasksCard } from './TasksCard'
import { IoCard } from './IoCard'
import { SbarCard, type SbarNote } from './SbarCard'

/* [2026-10-05, SAFE RETRY — mar-derived-schedule.md ### F: the former
   UNCERTAIN_SETTLE_MS rule (an empty server read 15 s after a failure
   declared the dose NOT recorded and reopened it) is retired. Codex
   reproduced it recording a dose twice when the original request committed
   after that read, and settling on a stale read that arrived after a newer
   one. Elapsed time plus an absent fact proves nothing; see MarLock.] */

/* while a save is unconfirmed (or awaiting its refresh), the record is
   re-read this often — the shared poll is 20 s */
const MAR_RECHECK_MS = 5_000

/* server refusals carry UTC wire stamps — the nurse reads hospital time */
const localizeStamps = (s: string) =>
  s.replace(/(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})/g, (_m, d: string, t: string) => displayFullStamp(`${d} ${t}`))

/** ONE documentation attempt: its identity and the documentation it
 *  carries, unchanged until the server's record settles it */
interface MarAttempt {
  attemptId: string
  orderId: string
  adminId: string
  action: AdministrationAction
  reason?: string
  administeredAt?: string
  /** the minute it was documented (UTC wire) — a retry of an on-time Given
   *  sends it as the actual administration time, so saving late never
   *  moves when the dose was given */
  clickedAt: string
  /** what it documents: the round number, or the 'once' dose's stamp
   *  (null for PRN / on-demand, which have no round to settle on) */
  round: number | null
  onceStamp: string | null
  label: string
}

/** one order's documentation, from the click until the server's record settles it:
 *  - 'saving': the attempt's request is in flight;
 *  - 'settling': answered (recorded or refused) — held until a server read
 *    STARTED AFTER the answer is applied (afterSeq), so the controls never
 *    reopen on rows older than the answer;
 *  - 'unconfirmed': no answer. Only the record settles it: a fact carrying
 *    this attempt's id (recorded), or its round / 'once' dose documented by
 *    another fact (it can never be recorded — a round takes one). Elapsed
 *    time and an absent fact prove nothing — the original request may
 *    still commit. The nurse may RETRY SAVING the same attempt: same id,
 *    same documentation, which the server answers with the existing record
 *    if either copy already landed. */
interface MarLock {
  phase: 'saving' | 'settling' | 'unconfirmed'
  attempt: MarAttempt
  afterSeq: number
}

/** a fresh attempt id — 32 hex chars from getRandomValues (randomUUID needs
 *  a secure context; the appliance may be served over plain LAN http) */
const newAttemptId = (): string =>
  [...crypto.getRandomValues(new Uint8Array(16))].map(b => b.toString(16).padStart(2, '0')).join('')



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
  /* a read older than one already applied is discarded WHOLE — neither
     shown nor used to settle anything (Codex's out-of-order case); only a
     server read (authoritative) settles a documentation */
  const applyMar = (seq: number, rows: MarRow[], authoritative: boolean) => {
    if (seq <= marSeq.current.applied) return
    marSeq.current.applied = seq
    setMar(rows)
    if (authoritative) settleFrom(seq, rows)
  }
  /** start a server read now (null result: unreadable — locks stay) */
  const refreshMar = async () => {
    if (!marIds.current.length) return   // the worklist is not loaded yet
    const seq = ++marSeq.current.started
    const rows = await getMarRowsAuthoritative(marIds.current)
    if (rows) applyMar(seq, rows, true)
  }
  const marIds = useRef<string[]>([])
  useEffect(() => {
    getNurseWorklist(session.name, session.jobTitle).then(w => {
      setWorklist(w)
      setListAt(Date.now())
      const ids = w.patients.map(p => p.patientId)
      marIds.current = ids
      /* with a documentation in progress the poll reads the server's own
         record — the only read that settles one */
      if (locks.size) void refreshMar()
      else {
        const seq = ++marSeq.current.started
        getMarRows(ids).then(rows => applyMar(seq, rows, false))
      }
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
     SAFE RETRY (2026-10-05, ### F): every documentation is one ATTEMPT with
     its own id, sent with it and stored on the fact it creates. An
     UNANSWERED save stays unconfirmed until the record settles it
     (MarLock) — never by elapsed time — and is never re-sent blindly: the
     nurse may retry SAVING the same attempt, which can never record twice.
     Unconfirmed attempts survive a page reload (sessionStorage, this tab,
     this nurse). Documenting again later is a new attempt. */
  const pendingKey = `aurora.marUnconfirmed:${session.name}`
  const marLocks = useRef<Map<string, MarLock> | null>(null)
  if (marLocks.current === null) {
    marLocks.current = new Map()
    try {
      for (const a of JSON.parse(sessionStorage.getItem(pendingKey) ?? '[]') as MarAttempt[])
        marLocks.current.set(a.orderId, { phase: 'unconfirmed', attempt: a, afterSeq: 0 })
    } catch { /* storage unavailable or unreadable — nothing to restore */ }
  }
  const locks = marLocks.current
  const busyOf = () => new Map([...locks].map(([id, l]) => [id, {
    phase: l.phase === 'settling' ? 'checking' : l.phase,
    action: l.attempt.action,
    at: displayStamp(l.attempt.administeredAt ?? l.attempt.clickedAt),
  } satisfies MarBusy] as const))
  const [marBusy, setMarBusy] = useState<ReadonlyMap<string, MarBusy>>(busyOf)
  const syncMarBusy = () => {
    setMarBusy(busyOf())
    /* an attempt whose outcome is not known yet is kept across a reload */
    try {
      const open = [...locks.values()].filter(l => l.phase !== 'settling').map(l => l.attempt)
      if (open.length) sessionStorage.setItem(pendingKey, JSON.stringify(open)); else sessionStorage.removeItem(pendingKey)
    } catch { /* private mode — in-memory only */ }
  }
  /* the last refusal per order, shown on its row until it is documented again */
  const [marNotices, setMarNotices] = useState<Record<string, string>>({})
  const setNotice = (orderId: string, text: string | null) => setMarNotices(prev => {
    const next = { ...prev }
    if (text === null) delete next[orderId]; else next[orderId] = text
    return next
  })

  /** settle what an applied SERVER read can settle (called only for a read
   *  newer than every read already applied) */
  const settleFrom = (seq: number, rows: MarRow[]) => {
    let changed = false
    for (const [orderId, l] of locks) {
      if (l.phase === 'saving') continue
      if (l.phase === 'settling') {
        if (seq > l.afterSeq) { locks.delete(orderId); changed = true }
        continue
      }
      const a = l.attempt
      const facts = rows.filter(r => r.orderId === orderId && r.status !== 'scheduled')
      if (facts.some(r => r.attemptId === a.attemptId)) {
        locks.delete(orderId); changed = true
        showToast('Saved — confirmed', `${a.label}: your ${a.action} documentation (${displayStamp(a.administeredAt ?? a.clickedAt)}) is on the record`)
        continue
      }
      const other = a.round !== null ? facts.find(r => r.round === a.round)
        : a.onceStamp !== null ? facts.find(r => r.scheduledTime === a.onceStamp) : undefined
      if (other) {
        locks.delete(orderId); changed = true
        const why = `this dose was already documented as ${other.status} by another documentation — your ${a.action} was not saved, and cannot be`
        showToast('Documentation NOT saved', `${a.label}: ${why}`, 6000)
        setNotice(orderId, `Not saved — ${why}.`)
      }
      /* otherwise it stays unconfirmed: an absent fact is not proof */
    }
    if (changed) syncMarBusy()
  }

  /** send one attempt (first time, or a retry of the same attempt) */
  const sendAttempt = async (a: MarAttempt, retry: boolean) => {
    const lock: MarLock = { phase: 'saving', attempt: a, afterSeq: Infinity }
    locks.set(a.orderId, lock)
    setNotice(a.orderId, null)
    syncMarBusy()
    /* a retried on-time Given carries the minute it was documented as its
       actual time (Held/Refused carry no administration time) */
    const pinned = retry && a.action === 'given' && !a.administeredAt
    const send = (at?: string) =>
      documentAdministration(a.orderId, a.adminId, a.action, session.name, session.jobTitle, a.reason, at, a.attemptId)
    let res = await send(pinned ? a.clickedAt : a.administeredAt)
    /* only the pinned time can make a retry fail validation where the
       original would pass (a device clock ahead of the server, or a day
       gone by): a 400 then re-sends the ORIGINAL request exactly, so any
       refusal below is the original's own and the original, still in
       flight, can never commit after it */
    if (pinned && res.kind === 'rejected' && res.status === 400 && locks.get(a.orderId) === lock) res = await send(undefined)
    if (locks.get(a.orderId) !== lock) return
    if (res.kind === 'ok') {
      const all = res.order.administrations ?? []
      const fact = all.find(f => f.attemptId === a.attemptId) ?? all.filter(f => f.status === a.action).pop()
      showToast(retry ? 'Saved — confirmed' : 'Documented', `${a.label} — ${a.action} ${displayStamp(fact?.documentedTime) || nowHm()}`)
      lock.phase = 'settling'
    } else if (res.kind === 'rejected' && !(retry && res.status === 401)) {
      /* the server answered: this attempt is not on the record — on a
         retry, judged after the server looked for it, so nothing in flight
         can still record it */
      const why = localizeStamps(res.error)
      showToast(retry ? 'Documentation NOT saved' : 'Dose NOT recorded', `${a.label}: ${why}`, 6000)
      setNotice(a.orderId, `${retry ? 'Not saved' : 'Not recorded'} — ${why}`)
      lock.phase = 'settling'
    } else {
      /* no answer (or, on a retry, a session that must sign in again —
         the server never looked): the outcome is unknown */
      lock.phase = 'unconfirmed'
      const what = res.kind === 'rejected' ? 'your session has expired — sign in again, then retry saving' : res.error
      showToast('Save not confirmed',
        `${a.label}: ${what} — your ${a.action} documentation is kept and may already be on the record. `
        + 'It is confirmed from the server\'s record; "Retry saving" re-sends the same documentation and can never record it twice.', 8000)
    }
    lock.afterSeq = marSeq.current.started
    syncMarBusy()
    await refreshMar()
  }

  const documentMar = (orderId: string, adminId: string, action: AdministrationAction, reason?: string, administeredAt?: string) => {
    if (locks.has(orderId)) return   // immediate: one documentation per order at a time
    const row = mar?.find(r => r.orderId === orderId && r.adminId === adminId)
    void sendAttempt({
      attemptId: newAttemptId(), orderId, adminId, action, reason, administeredAt,
      clickedAt: instanceStamp(Math.floor(Date.now() / 60_000) * 60_000),
      round: row?.round ?? null,
      onceStamp: row && row.round == null && datedEpoch(row.scheduledTime) !== null ? row.scheduledTime : null,
      label: row ? `${row.medication} · ${patientName(row.patientId)}` : orderId,
    }, false)
  }

  /** "Retry saving": the SAME attempt again — only while it is unconfirmed */
  const retryMar = (orderId: string) => {
    const l = locks.get(orderId)
    if (l?.phase === 'unconfirmed') void sendAttempt(l.attempt, true)
  }

  /* while anything is unconfirmed or awaiting its refresh, re-read the
     record more often than the shared poll */
  const marWaiting = [...marBusy.values()].some(b => b.phase !== 'saving')
  useEffect(() => {
    if (!marWaiting) return
    const t = window.setInterval(() => void refreshMar(), MAR_RECHECK_MS)
    return () => window.clearInterval(t)
  }, [marWaiting])

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
            {mar && worklist && <MarCard rows={mar} patients={patients} busy={marBusy} notices={marNotices} onDocument={documentMar} onRetry={retryMar} />}
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

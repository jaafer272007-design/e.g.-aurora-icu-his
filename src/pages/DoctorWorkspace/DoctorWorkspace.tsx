import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import './DoctorWorkspace.css'
import { AppHeader, type KpiSpec } from '../../components/AppHeader'
import { NavSidebar } from '../../components/NavSidebar'
import { Card } from '../../components/Card'
import { NotYetAvailable } from '../../components/NotYetAvailable'
import { BedChip, TagList } from '../../components/Tag'
import { Toast, useToast } from '../../components/Toast'
import { IconFlask, IconNote, IconPencil, IconUsers } from '../../components/icons'
import { News2Pill } from '../../components/News2Pill'
import {
  acknowledgeResult, getActionQueues, getConsults, getPendingOrders,
  getResultInbox, getRoundingWorklist, signOrder,
} from '../../lib/api'
import type {
  ActionQueueItem, Consult, MineWorklist, Order, QueueKey, ResultInboxItem,
  RoundingPatient,
} from '../../lib/api/types'
import { getSession, initialsOf, profileOf } from '../../lib/session'
import { displayStamp } from '../../lib/time'

const QUEUE_LABEL: Record<QueueKey, string> = {
  orders: 'Orders to Sign',
  results: 'Results to Acknowledge',
  notes: 'Notes Due',
}

const QUEUE_ICON: Record<QueueKey, JSX.Element> = {
  orders: <IconPencil size={15} stroke="var(--amber)" />,
  results: <IconFlask size={15} stroke="var(--red)" />,
  notes: <IconNote size={15} stroke="var(--green)" />,
}

interface QueueRow extends ActionQueueItem {
  leaving: boolean
}

export function DoctorWorkspace() {
  /* behind RequireSession(orders.sign) — session is present */
  const session = getSession()!
  const navigate = useNavigate()
  const { toast, showToast } = useToast()
  /* the rounding list is the CENSUS (Assignment Simplification): doctors
     have NO assignment concept — every doctor covers every patient, so
     the list is simply all open admissions. */
  const [rounding, setRounding] = useState<{ mine: MineWorklist; patients: RoundingPatient[] } | null>(null)
  /* "Orders to Sign" is a derived view over the canonical Order model
     (Screen 5, status === 'pending'); "Results to Acknowledge" over the
     canonical results store (Screen 6). Only "notes" remains workspace-local. */
  const [pendingOrders, setPendingOrders] = useState<(Order & { leaving?: boolean })[] | null>(null)
  const [results, setResults] = useState<(ResultInboxItem & { leaving?: boolean })[] | null>(null)
  /* undefined = loading · null = NOT A DOMAIN YET (production honest-empty,
     Phase 3 PR 1) · value = data */
  const [queues, setQueues] = useState<Record<'notes', QueueRow[]> | null | undefined>(undefined)
  const [consults, setConsults] = useState<Consult[] | null | undefined>(undefined)
  const [qtab, setQtab] = useState<QueueKey>('orders')

  useEffect(() => {
    getRoundingWorklist(session.name, session.jobTitle).then(setRounding)
    getPendingOrders().then(setPendingOrders)
    getResultInbox().then(setResults)
    getActionQueues().then(q =>
      setQueues(q ? { notes: q.notes.map(i => ({ ...i, leaving: false })) } : null))
    getConsults().then(setConsults)
  }, [])

  /* doctor RBAC: signing activates the order in the canonical store */
  const signPending = (orderId: string) => {
    const order = pendingOrders?.find(o => o.orderId === orderId)
    signOrder(orderId, session.name, session.jobTitle).then(updated => {
      if (!updated) return
      setPendingOrders(prev => prev && prev.map(o => (o.orderId === orderId ? { ...o, leaving: true } : o)))
      setTimeout(() => setPendingOrders(prev => prev && prev.filter(o => o.orderId !== orderId)), 280)
      if (order) showToast('Order signed', `${order.summary} · ${order.patientName}`)
    })
  }

  /* doctor RBAC: acknowledging writes to the canonical results store */
  const ackResult = (item: ResultInboxItem) => {
    acknowledgeResult(item.kind, item.id, session.name, session.jobTitle).then(ok => {
      if (!ok) return
      setResults(prev => prev && prev.map(r => (r.id === item.id ? { ...r, leaving: true } : r)))
      setTimeout(() => setResults(prev => prev && prev.filter(r => r.id !== item.id)), 280)
      showToast('Result acknowledged', item.title)
    })
  }

  const completeNote = (title: string) => {
    setQueues(prev => prev && ({ notes: prev.notes.map(i => (i.title === title ? { ...i, leaving: true } : i)) }))
    setTimeout(() => {
      setQueues(prev => prev && ({ notes: prev.notes.filter(i => i.title !== title) }))
    }, 280)
  }

  const queueCount = (k: QueueKey) =>
    k === 'orders' ? pendingOrders?.filter(o => !o.leaving).length ?? 0
    : k === 'results' ? results?.filter(r => !r.leaving).length ?? 0
    : queues?.notes.length ?? 0

  const kpis: KpiSpec[] = [
    { icon: <IconUsers size={14} stroke="var(--blue)" />, iconBg: 'rgba(var(--blue-rgb),.15)', value: rounding ? rounding.patients.length : '—', label: 'My Patients' },
    { icon: <IconPencil size={14} stroke="var(--amber)" />, iconBg: 'rgba(var(--amber-rgb),.14)', value: pendingOrders ? queueCount('orders') : '—', label: 'Orders to Sign' },
    { icon: <IconFlask size={14} stroke="var(--red)" />, iconBg: 'rgba(var(--red-rgb),.14)', value: results ? queueCount('results') : '—', label: 'Results to Ack.' },
    /* the notes DOMAIN may not exist (production, Phase 3 PR 1) — a
       concept with no domain doesn't render a KPI at all (decision (b)) */
    ...(queues === null ? [] : [{ icon: <IconNote size={14} stroke="var(--green)" />, iconBg: 'rgba(var(--green-rgb),.13)', value: queues ? queueCount('notes') : '—', label: 'Notes Due' } as KpiSpec]),
  ]

  return (
    <div className="app-frame dw">
      <AppHeader
        subtitle="Doctor Workspace"
        kpis={kpis}
        user={{ initials: initialsOf(session.name), name: session.name, role: `${session.jobTitle} · ${profileOf(session.jobTitle)} profile` }}
      />
      <div className="shell">
        <NavSidebar active="dashboard" alertCount={5} footerLines={['Role: Doctor profile', 'Full order/med authority']} />

        <main>
          <div className="col">
            <Card headId="rlHead" icon={<IconUsers size={15} stroke="var(--blue)" />} title="Rounding List — All Patients"
              aside={rounding ? `${rounding.patients.length} patients` : '— patients'}>
              <div className="rlist" role="list">
                {rounding && rounding.patients.length === 0 && (
                  <div className="rlempty">
                    No open admissions — the unit census is empty. Every doctor
                    covers every patient; there is no doctor assignment to manage.
                  </div>
                )}
                {rounding?.patients.map(p => (
                  <div
                    key={p.patientId}
                    className={`rcard sev-${p.severity}`}
                    role="listitem"
                    tabIndex={0}
                    aria-label={`Open chart ${p.name}, bed ${p.bedId}`}
                    onClick={() => navigate(`/patients/${p.patientId}`)}
                    onKeyDown={e => { if (e.key === 'Enter') navigate(`/patients/${p.patientId}`) }}
                  >
                    <BedChip bedId={p.bedId} />
                    <div className="rinfo">
                      <div className="rn">{p.name}</div>
                      <div className="rd">{p.diagnosis}</div>
                      <div className="rflags"><TagList flags={p.flags} size="sm" /></div>
                    </div>
                    <div className="ract">
                      {/* real computed NEWS2 (early-warning) — replaces the
                          fabricated SOFA; display-only, no alerts */}
                      <News2Pill patientId={p.patientId} />
                      {/* REAL ordering only: this navigates to the canonical
                          Orders & Meds screen for this patient. The former
                          "+ Order" quick-action opened a toast-only demo
                          drawer that never created an order — removed per
                          the owner's decision (the recorded wire-or-retire
                          open question, resolved: retire). */}
                      <button className="orderbtn" onClick={e => { e.stopPropagation(); navigate(`/orders/${p.patientId}`) }}>Orders →</button>
                    </div>
                  </div>
                ))}
              </div>
            </Card>


            <Card
              icon={<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--violet)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" /></svg>}
              title="Incoming Consults" aside={consults ? `${consults.length} pending` : undefined}
            >
              {/* shared consult store (patient linkage structured, not free text) —
                  the Timeline reads the same records. NULL = consults are
                  not a domain yet — say so, never render a blank that
                  reads as "no consults" (owner's condition 2). */}
              {consults === null && <NotYetAvailable what="Consults" />}
              <div>
                {consults?.map(c => (
                  <div className="consult" key={c.consultId}>
                    <span className="cav">{c.specialty.split(' ').map(w => w[0]).slice(0, 2).join('')}</span>
                    <div className="ct"><b>{c.specialty}</b> — Re: {c.bedId} {c.patientName} — {c.message}<small>{c.time}</small></div>
                  </div>
                ))}
              </div>
            </Card>
          </div>

          <div className="col">
            <Card title="Action Queue" aside="Tap ✓ to complete">
              <div className="qtabs" role="tablist">
                {(Object.keys(QUEUE_LABEL) as QueueKey[]).map(k => (
                  <button key={k} className={`qtab${k === qtab ? ' on' : ''}`} role="tab" aria-selected={k === qtab} onClick={() => setQtab(k)}>
                    {QUEUE_LABEL[k]}<span className="n">{queueCount(k)}</span>
                  </button>
                ))}
              </div>
              <div className="qlist" role="tabpanel">
                {/* order matters: an ABSENT notes domain must never fall
                    into the "caught up" empty — "nothing to do" is a
                    clinical claim; "not a domain yet" is not (owner's
                    condition 2) */}
                {qtab === 'notes' && queues === null ? (
                  <NotYetAvailable what="The clinical-notes queue" />
                ) : queueCount(qtab) === 0 ? (
                  <div className="qempty">Nothing pending — you're caught up.</div>
                ) : qtab === 'orders' ? (
                  (pendingOrders ?? []).map(o => (
                    <div className={`qrow${o.leaving ? ' done' : ''}`} key={o.orderId}>
                      <span className="qi">{QUEUE_ICON.orders}</span>
                      <div className="qt">
                        <b>{o.summary} — {o.bedId} {o.patientName}</b><br />
                        {o.priority} · {o.category}
                        <small>{displayStamp(o.orderedTime)} · {o.orderedBy} · {o.orderId}</small>
                      </div>
                      <button className="qbtn" aria-label={`Sign: ${o.summary}`} onClick={() => signPending(o.orderId)}>✓</button>
                    </div>
                  ))
                ) : qtab === 'results' ? (
                  (results ?? []).map(item => (
                    <div className={`qrow${item.leaving ? ' done' : ''}`} key={item.id}>
                      <span className="qi">{QUEUE_ICON.results}</span>
                      <div className="qt"><b>{item.title}</b><br />{item.detail}<small>{displayStamp(item.time)} · {item.flag.toUpperCase()}</small></div>
                      <button className="qbtn" aria-label={`Acknowledge: ${item.title}`} onClick={() => ackResult(item)}>✓</button>
                    </div>
                  ))
                ) : (
                  (queues?.notes ?? []).map(item => (
                    <div className={`qrow${item.leaving ? ' done' : ''}`} key={item.title}>
                      <span className="qi">{QUEUE_ICON.notes}</span>
                      <div className="qt"><b>{item.title}</b><br />{item.detail}{item.time && <small>{item.time}</small>}</div>
                      <button className="qbtn" aria-label={`Complete: ${item.title}`} onClick={() => completeNote(item.title)}>✓</button>
                    </div>
                  ))
                )}
              </div>
            </Card>
          </div>
        </main>
      </div>

      <Toast state={toast} accent="green" />
    </div>
  )
}

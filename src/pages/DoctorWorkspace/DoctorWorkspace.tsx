import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import './DoctorWorkspace.css'
import { AppHeader, type KpiSpec } from '../../components/AppHeader'
import { NavSidebar } from '../../components/NavSidebar'
import { Card } from '../../components/Card'
import { BedChip, TagList } from '../../components/Tag'
import { Toast, useToast } from '../../components/Toast'
import { IconFlask, IconNote, IconPencil, IconUsers } from '../../components/icons'
import { getActionQueues, getConsults, getOrderSets, getRoundingList } from '../../lib/api'
import type {
  ActionQueueItem, Consult, OrderSetsResponse, QueueKey, RoundingListResponse,
} from '../../lib/api/types'
import { OrderDrawer } from './OrderDrawer'

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

const sofaColor = (v: number) => (v >= 10 ? 'var(--red)' : v >= 6 ? 'var(--amber)' : 'var(--green)')

export function DoctorWorkspace() {
  const navigate = useNavigate()
  const { toast, showToast } = useToast()
  const [rounding, setRounding] = useState<RoundingListResponse | null>(null)
  const [queues, setQueues] = useState<Record<QueueKey, QueueRow[]> | null>(null)
  const [consults, setConsults] = useState<Consult[] | null>(null)
  const [orderSets, setOrderSets] = useState<OrderSetsResponse | null>(null)
  const [qtab, setQtab] = useState<QueueKey>('orders')
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [drawerFor, setDrawerFor] = useState<string | undefined>()
  const fabRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    getRoundingList().then(setRounding)
    getActionQueues().then(q =>
      setQueues({
        orders: q.orders.map(i => ({ ...i, leaving: false })),
        results: q.results.map(i => ({ ...i, leaving: false })),
        notes: q.notes.map(i => ({ ...i, leaving: false })),
      }))
    getConsults().then(setConsults)
    getOrderSets().then(setOrderSets)
  }, [])

  const completeItem = (key: QueueKey, title: string) => {
    setQueues(prev => prev && ({ ...prev, [key]: prev[key].map(i => (i.title === title ? { ...i, leaving: true } : i)) }))
    setTimeout(() => {
      setQueues(prev => prev && ({ ...prev, [key]: prev[key].filter(i => i.title !== title) }))
    }, 280)
  }

  const openDrawer = (forName?: string) => {
    setDrawerFor(forName)
    setDrawerOpen(true)
  }
  const closeDrawer = () => {
    setDrawerOpen(false)
    fabRef.current?.focus()
  }

  const kpis: KpiSpec[] = [
    { icon: <IconUsers size={14} stroke="var(--blue)" />, iconBg: 'rgba(77,163,255,.15)', value: rounding ? rounding.patients.length : '—', label: 'My Patients' },
    { icon: <IconPencil size={14} stroke="var(--amber)" />, iconBg: 'rgba(255,180,84,.14)', value: queues ? queues.orders.length : '—', label: 'Orders to Sign' },
    { icon: <IconFlask size={14} stroke="var(--red)" />, iconBg: 'rgba(255,93,108,.14)', value: queues ? queues.results.length : '—', label: 'Results to Ack.' },
    { icon: <IconNote size={14} stroke="var(--green)" />, iconBg: 'rgba(61,232,160,.13)', value: queues ? queues.notes.length : '—', label: 'Notes Due' },
  ]

  const items = queues?.[qtab] ?? []

  return (
    <div className="app-frame dw">
      <AppHeader
        subtitle="Doctor Workspace"
        kpis={kpis}
        bellCount={5}
        onBellClick={() => showToast('Alerts', '5 active notifications across your panel')}
        user={{ initials: 'SR', name: 'Dr. Sara Rahman', role: 'Intensivist · Panel: Pod A/B' }}
      />
      <div className="shell">
        <NavSidebar active="dashboard" alertCount={5} footerLines={['Role: Physician', 'Full order/med authority']} />

        <main>
          <div className="col">
            <Card headId="rlHead" icon={<IconUsers size={15} stroke="var(--blue)" />} title="My Rounding List"
              aside={rounding ? `${rounding.patients.length} patients` : '— patients'}>
              <div className="rlist" role="list">
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
                      <span className="sofa" style={{ color: sofaColor(p.sofa) }}>{p.sofa}</span>
                      <span className="sk">SOFA</span>
                      <button className="orderbtn" onClick={e => { e.stopPropagation(); openDrawer(p.name) }}>+ Order</button>
                    </div>
                  </div>
                ))}
              </div>
            </Card>

            <Card
              icon={<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--violet)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" /></svg>}
              title="Incoming Consults" aside={consults ? `${consults.length} pending` : '—'}
            >
              <div>
                {consults?.map(c => (
                  <div className="consult" key={c.specialty}>
                    <span className="cav">{c.specialty.split(' ').map(w => w[0]).slice(0, 2).join('')}</span>
                    <div className="ct"><b>{c.specialty}</b> — {c.message}<small>{c.time}</small></div>
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
                    {QUEUE_LABEL[k]}<span className="n">{queues?.[k].length ?? 0}</span>
                  </button>
                ))}
              </div>
              <div className="qlist" role="tabpanel">
                {items.length === 0 ? (
                  <div className="qempty">Nothing pending — you're caught up.</div>
                ) : (
                  items.map(item => (
                    <div className={`qrow${item.leaving ? ' done' : ''}`} key={item.title}>
                      <span className="qi">{QUEUE_ICON[qtab]}</span>
                      <div className="qt"><b>{item.title}</b><br />{item.detail}{item.time && <small>{item.time}</small>}</div>
                      <button className="qbtn" aria-label={`Complete: ${item.title}`} onClick={() => completeItem(qtab, item.title)}>✓</button>
                    </div>
                  ))
                )}
              </div>
            </Card>
          </div>
        </main>
      </div>

      <button ref={fabRef} className="fab" aria-label="New order" title="New order" onClick={() => openDrawer()}>
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#06121f" strokeWidth="2.4" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
      </button>

      <OrderDrawer
        open={drawerOpen}
        patients={rounding?.patients ?? []}
        orderSets={orderSets}
        forName={drawerFor}
        onClose={closeDrawer}
        onSign={(t, pt) => { showToast('Order signed', `${t} order for ${pt}`, 2600); closeDrawer() }}
      />
      <Toast state={toast} accent="green" />
    </div>
  )
}

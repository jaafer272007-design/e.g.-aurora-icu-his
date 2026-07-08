import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import './BedOverview.css'
import { AppHeader, type KpiSpec } from '../../components/AppHeader'
import { NavSidebar } from '../../components/NavSidebar'
import { getSession, initialsOf, profileOf } from '../../lib/session'
import { AlertRow } from '../../components/AlertRow'
import { VitalTile } from '../../components/VitalTile'
import { Toast, useToast } from '../../components/Toast'
import { IconAlertTriangle, IconBed, IconSearch, IconStats, IconVent } from '../../components/icons'
import { useReducedMotion } from '../../hooks/useClock'
import { getBeds, getUnitSummary } from '../../lib/api'
import type { Bed, BedsResponse, UnitSummaryResponse } from '../../lib/api/types'
import { BedCard } from './BedCard'

interface Filters {
  q: string
  doc: string
  area: string
  vent: boolean
  iso: boolean
  crit: boolean
}

const RING_CIRC = 169.6

function visible(b: Bed, f: Filters): boolean {
  const p = b.patient
  if (!p) return !f.q && !f.doc && !f.vent && !f.iso && !f.crit && (!f.area || b.area === f.area)
  if (f.q && !(p.name + b.bedId + p.diagnosis).toLowerCase().includes(f.q)) return false
  if (f.doc && p.attending !== f.doc) return false
  if (f.area && b.area !== f.area) return false
  if (f.vent && !p.flags.includes('vent')) return false
  if (f.iso && !p.isolation) return false
  if (f.crit && p.severity !== 'crit') return false
  return true
}

type JitterMap = Record<string, { hr: number; map: number; spo2: number }>

export function BedOverview() {
  /* behind RequireSession(patients.view) */
  const session = getSession()!
  const navigate = useNavigate()
  const reduced = useReducedMotion()
  const { toast, showToast } = useToast()
  const [data, setData] = useState<BedsResponse | null>(null)
  const [summary, setSummary] = useState<UnitSummaryResponse | null>(null)
  const [filters, setFilters] = useState<Filters>({ q: '', doc: '', area: '', vent: false, iso: false, crit: false })
  const [jitter, setJitter] = useState<JitterMap>({})
  const [ringOffset, setRingOffset] = useState(RING_CIRC)

  useEffect(() => {
    getBeds().then(setData)
    getUnitSummary().then(setSummary)
  }, [])

  /* live jitter of HR / MAP / SpO₂ display values */
  useEffect(() => {
    if (!data || reduced) return
    const seed: JitterMap = {}
    data.beds.forEach(b => {
      if (b.patient) seed[b.bedId] = { hr: b.patient.vitals.hr, map: b.patient.vitals.map, spo2: b.patient.vitals.spo2 }
    })
    setJitter(seed)
    const t = setInterval(() => {
      setJitter(prev => {
        const next: JitterMap = {}
        for (const [k, v] of Object.entries(prev)) {
          next[k] = {
            hr: Math.round(v.hr + (Math.random() - 0.5) * 1.6),
            map: Math.round(v.map + (Math.random() - 0.5) * 1.6),
            spo2: Math.round(v.spo2 + (Math.random() - 0.5) * 1.6),
          }
        }
        return next
      })
    }, 3000)
    return () => clearInterval(t)
  }, [data, reduced])

  const occupied = useMemo(() => (data ? data.beds.filter(b => b.patient) : []), [data])
  const stats = useMemo(() => {
    if (!data || occupied.length === 0) return null
    const n = occupied.length
    return {
      n,
      avail: data.capacity - n,
      crit: occupied.filter(b => b.patient!.severity === 'crit').length,
      vent: occupied.filter(b => b.patient!.flags.includes('vent')).length,
      sofa: (occupied.reduce((s, b) => s + b.patient!.sofa, 0) / n).toFixed(1),
      map: Math.round(occupied.reduce((s, b) => s + b.patient!.vitals.map, 0) / n),
      los: (occupied.reduce((s, b) => s + b.patient!.los, 0) / n).toFixed(1),
      pct: n / data.capacity,
    }
  }, [data, occupied])

  /* animate occupancy ring once stats are known */
  useEffect(() => {
    if (!stats) return
    const raf = requestAnimationFrame(() =>
      requestAnimationFrame(() => setRingOffset(RING_CIRC * (1 - stats.pct))))
    return () => cancelAnimationFrame(raf)
  }, [stats])

  const visibleBeds = data ? data.beds.filter(b => visible(b, filters)) : []
  const critAlerts = summary ? summary.highPriorityAlerts.filter(a => a.severity === 'crit').length : 0
  const bellCount = summary ? summary.highPriorityAlerts.length : 0

  const kpis: KpiSpec[] = [
    { icon: <IconBed size={14} stroke="var(--blue)" />, iconBg: 'rgba(77,163,255,.15)', value: stats ? `${stats.n} / ${data!.capacity}` : '—', label: 'Occupied' },
    {
      icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--green)" strokeWidth="2" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>,
      iconBg: 'rgba(61,232,160,.13)', value: stats ? stats.avail : '—', label: 'Available',
    },
    { icon: <IconAlertTriangle size={14} stroke="var(--red)" />, iconBg: 'rgba(255,93,108,.14)', value: stats ? stats.crit : '—', label: 'Critical', valueStyle: { color: 'var(--red)' } },
    { icon: <IconVent size={14} stroke="var(--blue)" />, iconBg: 'rgba(77,163,255,.15)', value: stats ? stats.vent : '—', label: 'Ventilated' },
    { icon: <IconStats size={14} stroke="var(--amber)" />, iconBg: 'rgba(255,180,84,.14)', value: stats ? stats.sofa : '—', label: 'Avg SOFA' },
  ]

  const toggle = (k: 'vent' | 'iso' | 'crit') => setFilters(f => ({ ...f, [k]: !f[k] }))

  return (
    <div className="app-frame bo">
      <AppHeader
        subtitle="Mission Control · Bed Overview"
        kpis={kpis}
        bellCount={bellCount}
        onBellClick={() => showToast('Alerts', `${bellCount} active notifications`)}
        user={{ initials: initialsOf(session.name), name: session.name, role: `${session.jobTitle} · ${profileOf(session.jobTitle)} profile` }}
      />
      <div className="shell">
        <NavSidebar active="beds" alertCount={bellCount || 5} footerLines={['Unit 4B · 16 beds', 'Sync: live']} />

        <main>
          <div className="fbar">
            <div className="searchbox">
              <IconSearch size={14} stroke="var(--faint)" />
              <input
                placeholder="Search patient, bed, diagnosis…"
                aria-label="Search patient, bed, diagnosis"
                value={filters.q}
                onChange={e => setFilters(f => ({ ...f, q: e.target.value.trim().toLowerCase() }))}
              />
            </div>
            <select className="sel" aria-label="Filter by physician" value={filters.doc} onChange={e => setFilters(f => ({ ...f, doc: e.target.value }))}>
              <option value="">All physicians</option>
              {data?.physicians.map(d => <option key={d}>{d}</option>)}
            </select>
            <select className="sel" aria-label="Filter by area" value={filters.area} onChange={e => setFilters(f => ({ ...f, area: e.target.value }))}>
              <option value="">All areas</option>
              {(data?.areas ?? ['Pod A', 'Pod B']).map(a => <option key={a}>{a}</option>)}
            </select>
            <button className={`fchip${filters.vent ? ' on' : ''}`} aria-pressed={filters.vent} onClick={() => toggle('vent')}>
              <IconVent size={13} />Ventilated
            </button>
            <button className={`fchip${filters.iso ? ' on' : ''}`} aria-pressed={filters.iso} onClick={() => toggle('iso')}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="9" /><path d="M12 3v18M3 12h18" /></svg>
              Isolation
            </button>
            <button className={`fchip${filters.crit ? ' on red' : ''}`} aria-pressed={filters.crit} onClick={() => toggle('crit')}>
              <IconAlertTriangle size={13} plain />Critical
            </button>
            <span className="showing">
              Showing <b>{data ? visibleBeds.filter(b => b.patient).length : '—'}</b> of <b>{data ? occupied.length : '—'}</b> occupied beds
            </span>
          </div>

          <div className="gridwrap">
            <div className="bgrid">
              {!data
                ? Array.from({ length: 8 }, (_, i) => <div key={i} className="skel" />)
                : visibleBeds.length === 0
                  ? <div className="nomatch">No beds match the current filters.</div>
                  : visibleBeds.map((b, i) => (
                      <BedCard key={b.bedId} bed={b} index={i} jitter={jitter[b.bedId]} onOpen={id => navigate(`/patients/${id}`)} />
                    ))}
            </div>
          </div>

          <div className="bottom">
            {summary?.stats.map(s => (
              <div className="bs" key={s.label}>
                <div><div className="v">{s.value}</div><div className="k">{s.label}</div></div>
                <span className={`delta ${s.trend}`}>{s.delta}</span>
              </div>
            ))}
          </div>
        </main>

        <aside className="rp">
          <h3><span className="live" />Real-Time ICU Summary</h3>
          <div className="ring">
            <svg width="66" height="66" viewBox="0 0 66 66">
              <circle cx="33" cy="33" r="27" fill="none" stroke="rgba(130,170,230,.14)" strokeWidth="7" />
              <circle
                cx="33" cy="33" r="27" fill="none" stroke="url(#occ-ring-grad)" strokeWidth="7" strokeLinecap="round"
                strokeDasharray={RING_CIRC} strokeDashoffset={ringOffset} transform="rotate(-90 33 33)"
                style={{ transition: 'stroke-dashoffset 1s cubic-bezier(.2,.7,.2,1)' }}
              />
              <defs>
                <linearGradient id="occ-ring-grad" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0" stopColor="#4da3ff" /><stop offset="1" stopColor="#35e0d0" />
                </linearGradient>
              </defs>
              <text x="33" y="38" textAnchor="middle" fill="#e9f1fb" fontSize="14" fontWeight="700" fontFamily="SF Mono,ui-monospace,monospace">
                {stats ? `${Math.round(stats.pct * 100)}%` : '—'}
              </text>
            </svg>
            <div>
              <div className="rv">{stats ? stats.n : '—'}<small style={{ fontSize: 11, color: 'var(--dim)' }}> / {data?.capacity ?? 16} beds</small></div>
              <div className="rl">Unit occupancy<br /><span style={{ color: 'var(--green)' }}>{stats ? `${stats.avail} available` : '—'}</span></div>
            </div>
          </div>
          <div className="rtiles">
            <VitalTile variant="rt" label="Avg MAP" value={stats ? stats.map : '—'} unit=" mmHg" />
            <VitalTile variant="rt" label="Avg ICU Stay" value={stats ? stats.los : '—'} unit=" days" />
            <VitalTile variant="rt" label="Admissions" value={summary ? summary.admissionsInProgress : '—'} unit=" in progress" />
            <VitalTile variant="rt" label="Discharges" value={summary ? summary.dischargesPlanned : '—'} unit=" planned" />
            <VitalTile variant="rt" label="Pending Consults" value={summary ? summary.pendingConsults : '—'} />
            <VitalTile variant="rt" label="High Priority" value={summary ? critAlerts : '—'} valueStyle={{ color: 'var(--red)' }} />
          </div>
          <h3 className="rphead">High Priority Alerts</h3>
          <div>
            {summary?.highPriorityAlerts.map(a => (
              <AlertRow key={a.message} variant="compact" severity={a.severity} text={a.message} time={a.time} />
            ))}
          </div>
        </aside>
      </div>
      <Toast state={toast} accent="blue" />
    </div>
  )
}

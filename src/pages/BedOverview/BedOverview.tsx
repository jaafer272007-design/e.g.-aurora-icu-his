import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import './BedOverview.css'
import { AppHeader, type KpiSpec } from '../../components/AppHeader'
import { NavSidebar } from '../../components/NavSidebar'
import { getSession, initialsOf, profileOf } from '../../lib/session'
import { AlertRow } from '../../components/AlertRow'
import { VitalTile } from '../../components/VitalTile'
import { Toast, useToast } from '../../components/Toast'
import { IconAlertTriangle, IconBed, IconSearch, IconVent } from '../../components/icons'
import { getBeds, getUnassignedPatients, getUnitSummary, getUnitSummaryDerived } from '../../lib/api'
import type { Bed, BedsResponse, DerivedUnitSummary, UnassignedPatient, UnitSummaryResponse } from '../../lib/api/types'
import { BedCard } from './BedCard'
import { useHospitalIdentity } from '../../lib/hospitalIdentity'

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


export function BedOverview() {
  /* behind RequireSession(patients.view) */
  const session = getSession()!
  const hospIdentity = useHospitalIdentity()
  const navigate = useNavigate()
  const { toast } = useToast()
  const [data, setData] = useState<BedsResponse | null>(null)
  /* undefined = loading · null = the unit-summary domain does not exist
     (production) — PR 3: null now triggers the DERIVED summary below,
     composed from the canonical reads that do exist */
  const [summary, setSummary] = useState<UnitSummaryResponse | null | undefined>(undefined)
  /* production only — null until the derived figures load; staging never
     fetches them (summary stays the demo fixture) */
  const [derived, setDerived] = useState<DerivedUnitSummary | null>(null)
  const [filters, setFilters] = useState<Filters>({ q: '', doc: '', area: '', vent: false, iso: false, crit: false })
  const [ringOffset, setRingOffset] = useState(RING_CIRC)

  /* the UNASSIGNED panel (Patient Assignment & Responsibility §7): a
     unit-level safety view — every open encounter with no active nurse /
     doctor, so no patient silently falls through */
  const [unassigned, setUnassigned] = useState<{ nurse: UnassignedPatient[]; doctor: UnassignedPatient[] } | null>(null)

  useEffect(() => {
    getBeds().then(setData)
    getUnitSummary().then(s => {
      setSummary(s)
      /* an unreachable source dispatches the overlay on its own — the
         swallow only silences the duplicate rejection */
      if (s === null) getUnitSummaryDerived().then(setDerived).catch(() => {})
    })
    getUnassignedPatients().then(setUnassigned).catch(() => setUnassigned({ nurse: [], doctor: [] }))
  }, [])

  /* §12 step 4: the live-jitter simulation is GONE — bed-card vitals are
     the latest charted observations, displayed as charted (decision F5:
     presentation tracks the real source; jitter fabricated a stream). */

  const occupied = useMemo(() => (data ? data.beds.filter(b => b.patient) : []), [data])
  const stats = useMemo(() => {
    if (!data || occupied.length === 0) return null
    const n = occupied.length
    return {
      n,
      avail: data.capacity - n,
      crit: occupied.filter(b => b.patient!.severity === 'crit').length,
      vent: occupied.filter(b => b.patient!.flags.includes('vent')).length,
      /* unit-average MAP over beds with a CHARTED (or demo-fallback) MAP —
         null vitals are "not charted" and never count as zero */
      map: (() => {
        const maps = occupied.map(b => b.patient!.vitals.map).filter((v): v is number => v !== null)
        return maps.length > 0 ? String(Math.round(maps.reduce((s, v) => s + v, 0) / maps.length)) : '—'
      })(),
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

  const kpis: KpiSpec[] = [
    { icon: <IconBed size={14} stroke="var(--blue)" />, iconBg: 'rgba(var(--blue-rgb),.15)', value: stats ? `${stats.n} / ${data!.capacity}` : '—', label: 'Occupied' },
    {
      icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--green)" strokeWidth="2" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>,
      iconBg: 'rgba(var(--green-rgb),.13)', value: stats ? stats.avail : '—', label: 'Available',
    },
    { icon: <IconAlertTriangle size={14} stroke="var(--red)" />, iconBg: 'rgba(var(--red-rgb),.14)', value: stats ? stats.crit : '—', label: 'Critical', valueStyle: { color: 'var(--red)' } },
    { icon: <IconVent size={14} stroke="var(--blue)" />, iconBg: 'rgba(var(--blue-rgb),.15)', value: stats ? stats.vent : '—', label: 'Ventilated' },
    /* the fabricated "Avg SOFA" KPI is RETIRED — per-bed real NEWS2 is on
       each bed card; a real unit-severity aggregate (needs per-patient
       scoring lifted to this level) is a recorded follow-up, not a
       fabricated number. */
  ]

  const toggle = (k: 'vent' | 'iso' | 'crit') => setFilters(f => ({ ...f, [k]: !f[k] }))

  return (
    <div className="app-frame bo">
      <AppHeader
        subtitle="Mission Control · Bed Overview"
        kpis={kpis}
        user={{ initials: initialsOf(session.name), name: session.name, role: `${session.jobTitle} · ${profileOf(session.jobTitle)} profile` }}
      />
      <div className="shell">
        {/* unit name from the CONFIGURED identity (one resolver) — the
            '16 beds' capacity figure is the beds tenant's concern (next
            PR); an unset unit renders the honest prompt, never a name */}
        <NavSidebar active="beds" footerLines={[
          `${hospIdentity?.unitName ? hospIdentity.unitName : 'Unit not configured'} · 16 beds`, 'Sync: live']} />

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
                      <BedCard key={b.bedId} bed={b} index={i} onOpen={id => navigate(`/patients/${id}`)} />
                    ))}
            </div>
          </div>

          <div className="bottom">
            {/* PR 3: production renders the figures with CANONICAL sources,
                each tile naming its source where the demo showed a trend
                delta (deltas have no source — dropped, decision (b)).
                Mortality / readmissions / avg-stay live on Statistics. */}
            {summary === null && derived && data && (
              <>
                <div className="bs">
                  <div><div className="v">{derived.admissionsToday}</div><div className="k">Admissions Today</div></div>
                  <span className="delta" style={{ color: 'var(--faint)' }}>ADT · UTC day</span>
                </div>
                <div className="bs">
                  <div><div className="v">{derived.dischargesToday}</div><div className="k">Discharges Today</div></div>
                  <span className="delta" style={{ color: 'var(--faint)' }}>ADT · UTC day</span>
                </div>
                <div className="bs">
                  <div>
                    <div className="v">{occupied.filter(b => b.patient!.flags.includes('vent')).length} / {data.capacity}</div>
                    <div className="k">Vent Utilization</div>
                  </div>
                  <span className="delta" style={{ color: 'var(--faint)' }}>bed board</span>
                </div>
                {derived.criticalUnacked !== null && (
                  <div className="bs">
                    <div>
                      <div className="v" style={derived.criticalUnacked > 0 ? { color: 'var(--red)' } : undefined}>{derived.criticalUnacked}</div>
                      <div className="k">Critical Results Unacked</div>
                    </div>
                    <span className="delta" style={{ color: 'var(--faint)' }}>results inbox</span>
                  </div>
                )}
              </>
            )}
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
              <circle cx="33" cy="33" r="27" fill="none" stroke="rgba(var(--steel-rgb),.14)" strokeWidth="7" />
              <circle
                cx="33" cy="33" r="27" fill="none" stroke="url(#occ-ring-grad)" strokeWidth="7" strokeLinecap="round"
                strokeDasharray={RING_CIRC} strokeDashoffset={ringOffset} transform="rotate(-90 33 33)"
                style={{ transition: 'stroke-dashoffset 1s cubic-bezier(.2,.7,.2,1)' }}
              />
              <defs>
                <linearGradient id="occ-ring-grad" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0" stopColor="var(--blue)" /><stop offset="1" stopColor="var(--cyan)" />
                </linearGradient>
              </defs>
              <text x="33" y="38" textAnchor="middle" fill="var(--text)" fontSize="14" fontWeight="700" fontFamily="SF Mono,ui-monospace,monospace">
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
            {/* no-source KPIs are DROPPED when the domain is absent, not
                dashed — a dash implies zero/loading, which soft-fabricates
                (owner's decision (b)); PR 3 adds the one panel figure that
                DOES have a source (the results inbox) in production */}
            {summary !== null && <VitalTile variant="rt" label="Admissions" value={summary ? summary.admissionsInProgress : '—'} unit=" in progress" />}
            {summary !== null && <VitalTile variant="rt" label="Discharges" value={summary ? summary.dischargesPlanned : '—'} unit=" planned" />}
            {summary !== null && <VitalTile variant="rt" label="Pending Consults" value={summary ? summary.pendingConsults : '—'} />}
            {summary !== null && <VitalTile variant="rt" label="High Priority" value={summary ? critAlerts : '—'} valueStyle={{ color: 'var(--red)' }} />}
            {summary === null && derived && derived.criticalUnacked !== null && (
              <VitalTile
                variant="rt" label="Critical Results" value={derived.criticalUnacked} unit=" unacked"
                valueStyle={derived.criticalUnacked > 0 ? { color: 'var(--red)' } : undefined}
              />
            )}
          </div>
          {/* PR 3: no unit-alert domain exists — production shows the REAL
              signal behind this region (unacknowledged criticals from the
              results inbox), named as exactly that; a viewer without
              results.view gets NO section (absent by authority, never a
              fabricated zero). Rows open nothing here; acknowledgment
              stays on Labs & Imaging — one truth. */}
          {summary === null && derived && derived.criticalResults !== null && (
            <>
              <h3 className="rphead">Critical Unacknowledged Results</h3>
              <div>
                {derived.criticalResults.length === 0
                  ? <div className="uab-empty">none — every result is acknowledged</div>
                  : derived.criticalResults.slice(0, 6).map(r => (
                      /* the inbox title is server-composed and already carries
                         bed + patient — rendered as served, never re-derived */
                      <AlertRow key={r.id} variant="compact" severity="crit" text={r.title} time={r.time} />
                    ))}
              </div>
            </>
          )}
          {summary !== null && (
            <>
              <h3 className="rphead">High Priority Alerts</h3>
              <div>
                {summary?.highPriorityAlerts.map(a => (
                  <AlertRow key={a.message} variant="compact" severity={a.severity} text={a.message} time={a.time} />
                ))}
              </div>
            </>
          )}
          {/* Unassigned patients — zero assignments is allowed but must be
              VISIBLE (the P-1191 failure made structural). Both kinds shown
              separately; rows open the chart, where assignment is managed. */}
          <h3 className="rphead">Unassigned Patients</h3>
          {!unassigned ? (
            <div className="uab-empty">—</div>
          ) : (
            <div className="uab">
              {(['nurse', 'doctor'] as const).map(kind => (
                <div key={kind}>
                  <div className={`uab-k${unassigned[kind].length ? ' warn' : ''}`}>
                    No {kind} · {unassigned[kind].length}
                  </div>
                  {unassigned[kind].length === 0 ? (
                    <div className="uab-empty">every open encounter has an active {kind}</div>
                  ) : unassigned[kind].map(u => (
                    <button
                      key={u.patientId} className="uab-row"
                      aria-label={`Open chart ${u.name}, bed ${u.bedId} — no ${kind} assigned`}
                      onClick={() => navigate(`/patients/${u.patientId}`)}
                    >
                      <span className="uab-bed">{u.bedId}</span>
                      <span className="uab-name">{u.name}</span>
                    </button>
                  ))}
                </div>
              ))}
            </div>
          )}
        </aside>
      </div>
      <Toast state={toast} accent="blue" />
    </div>
  )
}

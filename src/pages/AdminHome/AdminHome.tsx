import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import './AdminHome.css'
import { AppHeader, type KpiSpec } from '../../components/AppHeader'
import { NavSidebar } from '../../components/NavSidebar'
import { Card } from '../../components/Card'
import { AlertRow } from '../../components/AlertRow'
import { VitalTile } from '../../components/VitalTile'
import { Toast, useToast } from '../../components/Toast'
import { IconAdmit, IconBed, IconDischarge, IconStats, IconUsers } from '../../components/icons'
import { getBeds, getUnitSummary, getUnitSummaryDerived } from '../../lib/api'
import type { BedsResponse, DerivedUnitSummary, UnitSummaryResponse } from '../../lib/api/types'
import { getSession, hasPermission, initialsOf, profileOf } from '../../lib/session'

/** Stage 9 — Administrator landing view (/admin). Census, occupancy, and
 *  unit performance for administrative roles — strictly read-only, no
 *  clinical actions; everything shown derives from the same stores the
 *  clinical screens use. */
export function AdminHome() {
  const navigate = useNavigate()
  const { toast } = useToast()
  const session = getSession()!
  const [beds, setBeds] = useState<BedsResponse | null>(null)
  /* undefined = loading · null = the unit-summary domain does not exist
     (production) — PR 3: null now triggers the DERIVED summary below,
     composed from the canonical reads that do exist */
  const [summary, setSummary] = useState<UnitSummaryResponse | null | undefined>(undefined)
  /* production only — null until the derived figures load; staging never
     fetches them (summary stays the demo fixture) */
  const [derived, setDerived] = useState<DerivedUnitSummary | null>(null)

  useEffect(() => {
    getBeds().then(setBeds)
    getUnitSummary().then(s => {
      setSummary(s)
      /* an unreachable source dispatches the overlay on its own — the
         swallow only silences the duplicate rejection */
      if (s === null) getUnitSummaryDerived().then(setDerived).catch(() => {})
    })
  }, [])

  const stats = useMemo(() => {
    if (!beds) return null
    const occupied = beds.beds.filter(b => b.patient)
    const byArea = beds.areas.map(area => ({
      area,
      total: beds.beds.filter(b => b.area === area).length,
      occupied: occupied.filter(b => b.area === area).length,
    }))
    return {
      occupied: occupied.length,
      capacity: beds.capacity,
      available: beds.capacity - occupied.length,
      byArea,
      vent: occupied.filter(b => b.patient!.flags.includes('vent')).length,
      pressor: occupied.filter(b => b.patient!.flags.includes('pressor')).length,
      isolation: occupied.filter(b => b.patient!.isolation).length,
    }
  }, [beds])

  const kpis: KpiSpec[] = [
    { icon: <IconBed size={14} stroke="var(--blue)" />, iconBg: 'rgba(var(--blue-rgb),.15)', value: stats ? `${stats.occupied} / ${stats.capacity}` : '—', label: 'Census' },
    { icon: <IconUsers size={14} stroke="var(--green)" />, iconBg: 'rgba(var(--green-rgb),.13)', value: stats?.available ?? '—', label: 'Beds Available' },
    /* PR 3 (production): today's REAL admission/discharge counts from ADT
       encounters; the demo "planned" concept has no source and is replaced
       by the sourced figure, relabeled to what it actually is */
    summary === null
      ? { icon: <IconAdmit size={14} stroke="var(--cyan)" />, iconBg: 'rgba(var(--cyan-rgb),.13)', value: derived?.admissionsToday ?? '—', label: 'Admissions Today' }
      : { icon: <IconAdmit size={14} stroke="var(--cyan)" />, iconBg: 'rgba(var(--cyan-rgb),.13)', value: summary?.admissionsInProgress ?? '—', label: 'Admissions Today' },
    summary === null
      ? { icon: <IconDischarge size={14} stroke="var(--amber)" />, iconBg: 'rgba(var(--amber-rgb),.14)', value: derived?.dischargesToday ?? '—', label: 'Discharges Today' }
      : { icon: <IconDischarge size={14} stroke="var(--amber)" />, iconBg: 'rgba(var(--amber-rgb),.14)', value: summary?.dischargesPlanned ?? '—', label: 'Discharges Planned' },
  ]

  return (
    <div className="app-frame ad">
      <AppHeader
        subtitle="Unit Administration"
        kpis={kpis}
        user={{ initials: initialsOf(session.name), name: session.name, role: `${session.jobTitle} · ${profileOf(session.jobTitle)} profile` }}
      />
      <div className="shell">
        <NavSidebar
          active="dashboard"
          /* production badge = REAL unacked criticals (the same signal the
             Alerts page surfaces); staging keeps the demo alert count */
          alertCount={summary === null ? derived?.criticalUnacked ?? 0 : summary?.highPriorityAlerts.length ?? 0}
          footerLines={['Role: Administrator', 'Administrative view — read-only']}
        />

        <main>
          <div className="adnote" role="note">
            Administrative view — census and unit performance only. No clinical actions are
            available from this screen.
            {hasPermission(session.jobTitle, 'users.manage') && (
              <button className="adlink adusers" onClick={() => navigate('/admin/users')}>
                User Administration →
              </button>
            )}
          </div>

          <div className="adcols">
            {/* capacity counted from the active Bed Registry; the '4B'
                unit key no longer surfaces (single-unit boundary — the
                configured unit name is the display identity, #135) */}
            <Card icon={<IconBed size={15} stroke="var(--blue)" />} title="Unit Occupancy" aside={beds ? `${beds.capacity} beds` : '—'}>
              <div className="adtiles">
                <VitalTile variant="rt" label="Occupied" value={stats ? String(stats.occupied) : '—'} valueStyle={{ color: 'var(--blue)' }} />
                <VitalTile variant="rt" label="Available" value={stats ? String(stats.available) : '—'} valueStyle={{ color: 'var(--green)' }} />
                <VitalTile variant="rt" label="Ventilated" value={stats ? String(stats.vent) : '—'} valueStyle={{ color: 'var(--cyan)' }} />
                <VitalTile variant="rt" label="On Pressors" value={stats ? String(stats.pressor) : '—'} valueStyle={{ color: 'var(--amber)' }} />
                <VitalTile variant="rt" label="Isolation" value={stats ? String(stats.isolation) : '—'} valueStyle={{ color: 'var(--violet)' }} />
              </div>
              <div className="adpods">
                {stats?.byArea.map(a => (
                  <div className="adpod" key={a.area}>
                    <span className="adpodname">{a.area}</span>
                    <span className="adpodbar"><i style={{ width: `${(a.occupied / a.total) * 100}%` }} /></span>
                    <span className="adpodnum num">{a.occupied} / {a.total}</span>
                  </div>
                ))}
              </div>
              <button className="adlink" onClick={() => navigate('/beds')}>Open Bed Overview →</button>
            </Card>

            <Card
              icon={<IconStats size={15} stroke="var(--cyan)" />}
              title="Unit Performance"
              aside={summary === null ? 'derived · live records' : 'rolling · demo data'}
            >
              {/* PR 3 (production): only figures with canonical sources,
                  each naming its source where the demo showed a trend
                  delta (no source → dropped, decision (b)); mortality and
                  length-of-stay live on Statistics with real denominators */}
              {summary === null && (
                <div className="adstats">
                  <div className="adstat">
                    <div className="adsv num">{derived?.admissionsToday ?? '—'}</div>
                    <div className="adsl">Admissions Today</div>
                    <span className="adsd">ADT · UTC day</span>
                  </div>
                  <div className="adstat">
                    <div className="adsv num">{derived?.dischargesToday ?? '—'}</div>
                    <div className="adsl">Discharges Today</div>
                    <span className="adsd">ADT · UTC day</span>
                  </div>
                  <div className="adstat">
                    <div className="adsv num">{stats ? `${stats.vent} / ${stats.capacity}` : '—'}</div>
                    <div className="adsl">Vent Utilization</div>
                    <span className="adsd">bed board</span>
                  </div>
                  {/* absent for a viewer without results.view (the office
                      Administrator) — an authority boundary, not a zero */}
                  {derived && derived.criticalUnacked !== null && (
                    <div className="adstat">
                      <div className="adsv num" style={derived.criticalUnacked > 0 ? { color: 'var(--red)' } : undefined}>
                        {derived.criticalUnacked}
                      </div>
                      <div className="adsl">Critical Results Unacked</div>
                      <span className="adsd">results inbox</span>
                    </div>
                  )}
                </div>
              )}
              <div className="adstats">
                {summary?.stats.map(s => (
                  <div className="adstat" key={s.label}>
                    <div className="adsv num">{s.value}</div>
                    <div className="adsl">{s.label}</div>
                    <span className={`adsd ${s.trend}`}>{s.delta}</span>
                  </div>
                ))}
              </div>
              {summary === null && (
                <button className="adlink adstatlink" onClick={() => navigate('/statistics')}>
                  Mortality & length-of-stay → Statistics
                </button>
              )}
            </Card>

            <Card
              icon={<IconAdmit size={15} stroke="var(--amber)" />}
              title="Operations Today"
              aside={summary ? `${summary.pendingConsults} consults pending` : undefined}
            >
              {/* PR 3 (production): counters with canonical sources only —
                  pending consults / planned discharges have none and stay
                  DROPPED, not dashed (owner's decision (b)) */}
              {summary === null && (
                <div className="adops">
                  <div className="adop"><span>Admissions today (ADT)</span><b className="num">{derived?.admissionsToday ?? '—'}</b></div>
                  <div className="adop"><span>Discharges today (ADT)</span><b className="num">{derived?.dischargesToday ?? '—'}</b></div>
                  <div className="adop"><span>Ventilated now (bed board)</span><b className="num">{stats?.vent ?? '—'}</b></div>
                  {derived && derived.criticalUnacked !== null && (
                    <div className="adop"><span>Critical results unacknowledged</span><b className="num" style={{ color: 'var(--red)' }}>{derived.criticalUnacked}</b></div>
                  )}
                </div>
              )}
              {summary !== null && (
                <div className="adops">
                  <div className="adop"><span>Admissions in progress</span><b className="num">{summary?.admissionsInProgress ?? '—'}</b></div>
                  <div className="adop"><span>Discharges planned</span><b className="num">{summary?.dischargesPlanned ?? '—'}</b></div>
                  <div className="adop"><span>Pending consults</span><b className="num">{summary?.pendingConsults ?? '—'}</b></div>
                  <div className="adop"><span>High-priority alerts</span><b className="num" style={{ color: 'var(--red)' }}>{summary?.highPriorityAlerts.length ?? '—'}</b></div>
                </div>
              )}
              {/* no unit-alert domain exists — production shows the REAL
                  signal behind this region (unacknowledged criticals from
                  the results inbox), named as exactly that; a viewer
                  without results.view (the office Administrator) gets NO
                  section — an authority boundary, never a fabricated
                  zero; acknowledgment stays on Labs & Imaging — one truth */}
              {summary === null && derived && derived.criticalResults !== null && (
                <>
                  <h3 className="adalerthead">Critical Unacknowledged Results</h3>
                  <div>
                    {derived.criticalResults.length === 0
                      ? <div className="adnone">none — every result is acknowledged</div>
                      : derived.criticalResults.slice(0, 4).map(r => (
                          /* the inbox title is server-composed and already
                             carries bed + patient — rendered as served */
                          <AlertRow key={r.id} variant="compact" severity="crit" text={r.title} time={r.time} />
                        ))}
                  </div>
                </>
              )}
              {summary !== null && (
                <>
                  <h3 className="adalerthead">High-Priority Unit Alerts</h3>
                  <div>
                    {summary?.highPriorityAlerts.slice(0, 4).map(a => (
                      <AlertRow key={a.message} variant="compact" severity={a.severity} text={a.message} time={a.time} />
                    ))}
                  </div>
                </>
              )}
            </Card>
          </div>
        </main>
      </div>
      <Toast state={toast} accent="blue" />
    </div>
  )
}

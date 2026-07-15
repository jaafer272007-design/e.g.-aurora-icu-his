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
import { getBeds, getUnitSummary } from '../../lib/api'
import type { BedsResponse, UnitSummaryResponse } from '../../lib/api/types'
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
  const [summary, setSummary] = useState<UnitSummaryResponse | null>(null)

  useEffect(() => {
    getBeds().then(setBeds)
    getUnitSummary().then(setSummary)
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
    { icon: <IconBed size={14} stroke="var(--blue)" />, iconBg: 'rgba(77,163,255,.15)', value: stats ? `${stats.occupied} / ${stats.capacity}` : '—', label: 'Census' },
    { icon: <IconUsers size={14} stroke="var(--green)" />, iconBg: 'rgba(61,232,160,.13)', value: stats?.available ?? '—', label: 'Beds Available' },
    { icon: <IconAdmit size={14} stroke="var(--cyan)" />, iconBg: 'rgba(53,224,208,.13)', value: summary?.admissionsInProgress ?? '—', label: 'Admissions Today' },
    { icon: <IconDischarge size={14} stroke="var(--amber)" />, iconBg: 'rgba(255,180,84,.14)', value: summary?.dischargesPlanned ?? '—', label: 'Discharges Planned' },
  ]

  return (
    <div className="app-frame ad">
      <AppHeader
        subtitle="Unit Administration"
        kpis={kpis}
        user={{ initials: initialsOf(session.name), name: session.name, role: `${session.jobTitle} · ${profileOf(session.jobTitle)} profile` }}
      />
      <div className="shell">
        <NavSidebar active="dashboard" alertCount={summary?.highPriorityAlerts.length ?? 0} footerLines={['Role: Administrator', 'Administrative view — read-only']} />

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
            <Card icon={<IconBed size={15} stroke="var(--blue)" />} title="Unit Occupancy" aside={beds ? `${beds.unitId} · ${beds.capacity} beds` : '—'}>
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

            <Card icon={<IconStats size={15} stroke="var(--cyan)" />} title="Unit Performance" aside="rolling · demo data">
              <div className="adstats">
                {summary?.stats.map(s => (
                  <div className="adstat" key={s.label}>
                    <div className="adsv num">{s.value}</div>
                    <div className="adsl">{s.label}</div>
                    <span className={`adsd ${s.trend}`}>{s.delta}</span>
                  </div>
                ))}
              </div>
            </Card>

            <Card
              icon={<IconAdmit size={15} stroke="var(--amber)" />}
              title="Operations Today"
              aside={summary ? `${summary.pendingConsults} consults pending` : '—'}
            >
              <div className="adops">
                <div className="adop"><span>Admissions in progress</span><b className="num">{summary?.admissionsInProgress ?? '—'}</b></div>
                <div className="adop"><span>Discharges planned</span><b className="num">{summary?.dischargesPlanned ?? '—'}</b></div>
                <div className="adop"><span>Pending consults</span><b className="num">{summary?.pendingConsults ?? '—'}</b></div>
                <div className="adop"><span>High-priority alerts</span><b className="num" style={{ color: 'var(--red)' }}>{summary?.highPriorityAlerts.length ?? '—'}</b></div>
              </div>
              <h3 className="adalerthead">High-Priority Unit Alerts</h3>
              <div>
                {summary?.highPriorityAlerts.slice(0, 4).map(a => (
                  <AlertRow key={a.message} variant="compact" severity={a.severity} text={a.message} time={a.time} />
                ))}
              </div>
            </Card>
          </div>
        </main>
      </div>
      <Toast state={toast} accent="blue" />
    </div>
  )
}

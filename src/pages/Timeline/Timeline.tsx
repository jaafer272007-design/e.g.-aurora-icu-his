import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import './Timeline.css'
import { AppHeader, type KpiSpec } from '../../components/AppHeader'
import { NavSidebar } from '../../components/NavSidebar'
import { BedChip } from '../../components/Tag'
import { Toast, useToast } from '../../components/Toast'
import { IconAlertTriangle, IconClock, IconNote, IconPill } from '../../components/icons'
import { getPatientDetail, getPatients, getTimeline } from '../../lib/api'
import { CURRENT_SESSION, type SessionRole } from '../../lib/session'
import type { Patient, PatientSummary, TimelineCategory, TimelineEvent } from '../../lib/api/types'
import { dayOffsetOf, hmOf, toMinutes } from '../../lib/time'

const CATEGORIES: { key: TimelineCategory; label: string }[] = [
  { key: 'order', label: 'Orders' }, { key: 'med', label: 'Meds' }, { key: 'lab', label: 'Labs' },
  { key: 'imaging', label: 'Imaging' }, { key: 'task', label: 'Tasks' }, { key: 'io', label: 'I&O' },
  { key: 'consult', label: 'Consults' }, { key: 'note', label: 'Notes' },
]

type Shift = 'all' | 'day' | 'night'
const SHIFTS: { key: Shift; label: string }[] = [
  { key: 'all', label: 'All shifts' }, { key: 'day', label: 'Day 07–19' }, { key: 'night', label: 'Night 19–07' },
]

/** shift bucket by time of day (day shift = 07:00–18:59) */
const shiftOf = (t: string): Exclude<Shift, 'all'> => {
  const m = toMinutes(hmOf(t))
  return m >= 420 && m < 1140 ? 'day' : 'night'
}

const dayLabel = (off: number) => (off === 0 ? 'Today' : `D-${-off}`)

const linkLabel = (link: string) =>
  link.startsWith('/orders') ? 'Orders'
  : link.startsWith('/labs') ? 'Results'
  : link === '/nurse' ? 'Nurse Workspace' : 'Workspace'

/** Screen 7 — Clinical Timeline. A read-only AGGREGATED feed over the
 *  canonical stores (order audit trail, lab/imaging results incl.
 *  acknowledgments, MAR administrations, task completions, I&O, consults,
 *  clinical notes). View-only by design: no signing, acknowledging, or
 *  discontinuing here — deep-links lead back to the originating screens. */
export function Timeline() {
  const { patientId = '' } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const { toast, showToast } = useToast()
  /* dev preview of the nurse view until Stage 9 auth: /timeline/P-1001?as=nurse */
  const role: SessionRole =
    new URLSearchParams(location.search).get('as') === 'nurse' ? 'nurse' : CURRENT_SESSION.role

  const [patients, setPatients] = useState<PatientSummary[] | null>(null)
  const [patient, setPatient] = useState<Patient | null>(null)
  const [missing, setMissing] = useState(false)
  const [events, setEvents] = useState<TimelineEvent[] | null>(null)
  const [cats, setCats] = useState<Set<TimelineCategory>>(new Set())
  const [day, setDay] = useState<'all' | number>('all')
  const [shift, setShift] = useState<Shift>('all')

  useEffect(() => { getPatients().then(setPatients) }, [])

  useEffect(() => {
    if (!patientId && patients?.length) navigate(`/timeline/${patients[0].patientId}${location.search}`, { replace: true })
  }, [patientId, patients, navigate, location.search])

  useEffect(() => {
    if (!patientId) return
    let stale = false
    setMissing(false)
    setCats(new Set())
    setDay('all')
    setShift('all')
    getPatientDetail(patientId).then(res => {
      if (stale) return
      if (!res) {
        /* locked decision: explicit not-found — never another patient's data */
        setPatient(null)
        setEvents(null)
        setMissing(true)
        return
      }
      setPatient(res.patient)
    })
    getTimeline(patientId).then(evs => { if (!stale) setEvents(evs) })
    return () => { stale = true }
  }, [patientId])

  const toggleCat = (key: TimelineCategory) =>
    setCats(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  /* day+shift slice — category chip counts read this, so the numbers always
     describe what the other two filters currently allow */
  const dayShiftFiltered = useMemo(() =>
    (events ?? []).filter(ev =>
      (day === 'all' || dayOffsetOf(ev.time) === day) &&
      (shift === 'all' || shiftOf(ev.time) === shift)),
  [events, day, shift])

  const filtered = useMemo(() =>
    dayShiftFiltered.filter(ev => cats.size === 0 || cats.has(ev.category)),
  [dayShiftFiltered, cats])

  const groups = useMemo(() => {
    const byDay = new Map<number, TimelineEvent[]>()
    for (const ev of filtered) {
      const off = dayOffsetOf(ev.time)
      if (!byDay.has(off)) byDay.set(off, [])
      byDay.get(off)!.push(ev)
    }
    return [...byDay.entries()].sort((a, b) => b[0] - a[0]).map(([off, evs]) => ({ off, events: evs }))
  }, [filtered])

  const days = useMemo(() =>
    [...new Set((events ?? []).map(e => dayOffsetOf(e.time)))].sort((a, b) => b - a),
  [events])

  const countFor = (key: TimelineCategory) => dayShiftFiltered.filter(e => e.category === key).length

  const today = (events ?? []).filter(e => dayOffsetOf(e.time) === 0)
  const kpis: KpiSpec[] = [
    { icon: <IconClock size={14} stroke="var(--blue)" />, iconBg: 'rgba(77,163,255,.15)', value: events ? today.length : '—', label: 'Events Today' },
    {
      icon: <IconAlertTriangle size={14} stroke="var(--red)" />, iconBg: 'rgba(255,93,108,.14)',
      value: events ? events.filter(e => e.flag === 'critical').length : '—', label: 'Critical Flags',
      valueStyle: events?.some(e => e.flag === 'critical') ? { color: 'var(--red)' } : undefined,
    },
    { icon: <IconPill size={14} stroke="var(--cyan)" />, iconBg: 'rgba(53,224,208,.13)', value: events ? today.filter(e => e.category === 'med').length : '—', label: 'Med Events Today' },
    { icon: <IconNote size={14} stroke="var(--green)" />, iconBg: 'rgba(61,232,160,.13)', value: events ? today.filter(e => e.category === 'note' || e.category === 'consult').length : '—', label: 'Notes · Consults' },
  ]

  const clearFilters = () => { setCats(new Set()); setDay('all'); setShift('all') }
  const filtersActive = cats.size > 0 || day !== 'all' || shift !== 'all'

  return (
    <div className="app-frame tm">
      <AppHeader
        subtitle="Clinical Timeline"
        kpis={kpis}
        bellCount={5}
        onBellClick={() => showToast('Alerts', '5 active notifications across the unit')}
        user={role === 'nurse'
          ? { initials: 'MC', name: 'RN Maya Chen', role: 'ICU Nurse · read-only feed' }
          : { initials: 'SR', name: 'Dr. Sara Rahman', role: 'Intensivist · read-only feed' }}
      />
      <div className="shell">
        <NavSidebar
          active="timeline"
          alertCount={5}
          dashboardRoute={role === 'nurse' ? '/nurse' : '/workspace'}
          footerLines={[role === 'nurse' ? 'Role: Nurse' : 'Role: Physician', 'Timeline is view-only']}
        />

        <aside className="ptrail" aria-label="Patients">
          <div className="ptrailhead">Patients</div>
          <div className="ptraillist">
            {patients?.map(p => (
              <button
                key={p.patientId}
                className={`ptrailcard${p.patientId === patientId ? ' sel' : ''}`}
                aria-current={p.patientId === patientId ? 'page' : undefined}
                onClick={() => navigate(`/timeline/${p.patientId}${location.search}`)}
              >
                <BedChip bedId={p.bedId} />
                <span className="prname">{p.name}</span>
              </button>
            ))}
          </div>
        </aside>

        <main>
          {missing && (
            <section className="card notfound" role="alert">
              <IconAlertTriangle size={28} stroke="var(--amber)" />
              <h2>Patient Not Found</h2>
              <p>No patient found for this ID — they may have been discharged, transferred, or this link is outdated.</p>
              <button className="nf-btn" onClick={() => navigate('/beds')}>← Back to Bed Overview</button>
            </section>
          )}

          {patient && (
            <div className="ptbar">
              <BedChip bedId={patient.bedId} />
              <b className="ptbarname">{patient.name}</b>
              <span className="ptbarsub num">{patient.mrn} · {patient.age} · {patient.sex}</span>
              <span className="ptbardx">{patient.diagnosis}</span>
              <span className="ptbarviewonly">Read-only feed</span>
              <div className="ptbarlinks">
                <button className="ptbarlink" onClick={() => navigate(`/patients/${patient.patientId}`)}>Chart →</button>
                <button className="ptbarlink" onClick={() => navigate(`/orders/${patient.patientId}`)}>Orders →</button>
                <button className="ptbarlink" onClick={() => navigate(`/labs/${patient.patientId}`)}>Results →</button>
              </div>
            </div>
          )}

          {patient && events && (
            <section className="card tmcard">
              <div className="tmhead">
                <h2><IconClock size={15} stroke="var(--blue)" /> Aggregated Feed</h2>
                <span className="tmaside">View-only — sign, acknowledge and document from the originating screens</span>
              </div>

              <div className="tmfilters">
                <div className="tmfrow" role="group" aria-label="Filter by category">
                  <button className={`tmchip${cats.size === 0 ? ' on' : ''}`} aria-pressed={cats.size === 0} onClick={() => setCats(new Set())}>All</button>
                  {CATEGORIES.map(c => (
                    <button key={c.key} className={`tmchip${cats.has(c.key) ? ' on' : ''}`} aria-pressed={cats.has(c.key)} onClick={() => toggleCat(c.key)}>
                      {c.label}<span className="n num">{countFor(c.key)}</span>
                    </button>
                  ))}
                </div>
                <div className="tmfrow" role="group" aria-label="Filter by day and shift">
                  <button className={`tmchip${day === 'all' ? ' on' : ''}`} aria-pressed={day === 'all'} onClick={() => setDay('all')}>All days</button>
                  {days.map(off => (
                    <button key={off} className={`tmchip${day === off ? ' on' : ''}`} aria-pressed={day === off} onClick={() => setDay(off)}>
                      {dayLabel(off)}
                    </button>
                  ))}
                  <span className="tmsep" aria-hidden="true" />
                  {SHIFTS.map(s => (
                    <button key={s.key} className={`tmchip${shift === s.key ? ' on' : ''}`} aria-pressed={shift === s.key} onClick={() => setShift(s.key)}>
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>

              {filtered.length === 0 ? (
                <div className="tmempty">
                  {events.length === 0
                    ? 'No timeline events recorded for this patient yet.'
                    : 'No events match the current filters.'}
                  {filtersActive && <button className="tmclear" onClick={clearFilters}>Clear filters</button>}
                </div>
              ) : (
                groups.map(g => (
                  <section className="tmday" key={g.off}>
                    <h3 className="tmdayhead">
                      <span>{dayLabel(g.off)}</span>
                      <small className="num">{g.events.length} event{g.events.length === 1 ? '' : 's'}</small>
                    </h3>
                    <div className="tmlist">
                      {g.events.map(ev => (
                        <article className={`tmrow${ev.flag === 'critical' ? ' crit' : ''}`} key={ev.id}>
                          <span className="tmtime num">{hmOf(ev.time)}</span>
                          <span className={`tc ${ev.category}`}>{ev.categoryLabel}</span>
                          <div className="tmbody">
                            <b>{ev.title}</b>
                            {ev.detail && <span className="tmdetail">{ev.detail}</span>}
                            {(ev.actor || (ev.flag && ev.flag !== 'normal')) && (
                              <small className="tmmeta">
                                {ev.flag === 'critical' && <i className="tmflag critical">⚠ Critical</i>}
                                {ev.flag === 'abnormal' && <i className="tmflag abnormal">Abnormal</i>}
                                {ev.actor && <span>{ev.actor}</span>}
                              </small>
                            )}
                          </div>
                          {ev.link && (
                            <button className="tmlink" onClick={() => navigate(ev.link!)} aria-label={`Open ${linkLabel(ev.link)} for this event`}>
                              {linkLabel(ev.link)} →
                            </button>
                          )}
                        </article>
                      ))}
                    </div>
                  </section>
                ))
              )}
            </section>
          )}
        </main>
      </div>
      <Toast state={toast} accent="green" />
    </div>
  )
}

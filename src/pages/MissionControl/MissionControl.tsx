import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import './MissionControl.css'
import { Card } from '../../components/Card'
import { Badge } from '../../components/Badge'
import { BedChip, TagList } from '../../components/Tag'
import { AlertRow } from '../../components/AlertRow'
import { VitalTile } from '../../components/VitalTile'
import { Sparkline } from '../../components/Sparkline'
import { IconAlertTriangle, IconCheck, IconPulse, IconSearch, IconVent } from '../../components/icons'
import { useClock } from '../../hooks/useClock'
import { getPatientDetail, getPatients } from '../../lib/api'
import type { PatientAlert, PatientDetailResponse, PatientSummary } from '../../lib/api/types'
import { MonitorCard } from './MonitorCard'
import { DigitalTwin } from './DigitalTwin'
import { AiPanel } from './AiPanel'
import { LabsCard } from './LabsCard'

type Filter = 'all' | 'vent' | 'pressor' | 'crrt' | 'ecmo' | 'iso' | 'alerts'
const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All' }, { key: 'vent', label: 'Vent' }, { key: 'pressor', label: 'Pressors' },
  { key: 'crrt', label: 'CRRT' }, { key: 'ecmo', label: 'ECMO' }, { key: 'iso', label: 'Isolation' },
  { key: 'alerts', label: 'Alerts' },
]

function matches(p: PatientSummary, filter: Filter, query: string): boolean {
  if (query && !(p.name + p.bedId + p.mrn).toLowerCase().includes(query)) return false
  if (filter === 'all') return true
  if (filter === 'iso') return p.isolation
  if (filter === 'alerts') return p.alertCount > 0
  return p.flags.includes(filter)
}

interface LiveAlert extends PatientAlert {
  key: number
  leaving: boolean
}

const initials = (name: string) => name.split(' ').map(w => w[0]).slice(0, 2).join('')

export function MissionControl() {
  const { patientId = '' } = useParams()
  const navigate = useNavigate()
  const { time, date, shortTime } = useClock()
  const [patients, setPatients] = useState<PatientSummary[] | null>(null)
  const [detail, setDetail] = useState<PatientDetailResponse | null>(null)
  const [missing, setMissing] = useState(false)
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')
  const [alerts, setAlerts] = useState<LiveAlert[]>([])
  const [goals, setGoals] = useState<{ label: string; done: boolean }[]>([])

  useEffect(() => { getPatients().then(setPatients) }, [])

  useEffect(() => {
    let stale = false
    setMissing(false)
    getPatientDetail(patientId).then(res => {
      if (stale) return
      if (!res) {
        /* Locked decision: an unresolved ID must render an explicit not-found
           state — never redirect to or display another patient's chart. */
        setDetail(null)
        setAlerts([])
        setGoals([])
        setMissing(true)
        return
      }
      setDetail(res)
      setAlerts(res.alerts.map((a, i) => ({ ...a, key: i, leaving: false })))
      setGoals(res.goals)
    })
    return () => { stale = true }
  }, [patientId])

  const unit = useMemo(() => {
    if (!patients) return null
    return {
      census: `${patients.length} / 16`,
      vent: patients.filter(p => p.flags.includes('vent')).length,
      pressors: patients.filter(p => p.flags.includes('pressor')).length,
    }
  }, [patients])

  const filtered = patients?.filter(p => matches(p, filter, query)) ?? []
  const p = detail?.patient
  const critAlerts = alerts.filter(a => !a.leaving && a.severity === 'crit').length
  const activeAlerts = alerts.filter(a => !a.leaving)

  const ackAlert = (key: number) => {
    setAlerts(prev => prev.map(a => (a.key === key ? { ...a, leaving: true } : a)))
    setTimeout(() => setAlerts(prev => prev.filter(a => a.key !== key)), 320)
  }

  const toggleGoal = (i: number) =>
    setGoals(prev => prev.map((goal, k) => (k === i ? { ...goal, done: !goal.done } : goal)))
  const goalPct = goals.length ? Math.round((goals.filter(x => x.done).length / goals.length) * 100) : 0

  const runningInfusions = detail ? detail.infusions.filter(m => m.trend[m.trend.length - 1] > 0).length : 0

  return (
    <div className="app-frame mc">
      <header className="top">
        <div className="brandrow">
          <div className="brand">
            <div className="logo"><IconPulse size={16} stroke="#06121f" strokeWidth={2.6} /></div>
            <div>AURORA ICU<small>Mission Control · Unit 4B</small></div>
          </div>
          <div className="unitstats">
            <div className="us">Census<b>{unit?.census ?? '—'}</b></div>
            <div className="us">Ventilated<b>{unit?.vent ?? '—'}</b></div>
            <div className="us">On Pressors<b>{unit?.pressors ?? '—'}</b></div>
            <div className="us">Critical Alerts<b style={{ color: 'var(--red)' }}>{critAlerts}</b></div>
          </div>
          <div className="spacer" />
          <div className="clock"><b>{time}</b><span>{date}</span></div>
        </div>
        <div className="banner">
          <div className="pt-id">
            <div className="avatar">{p ? initials(p.name) : '—'}</div>
            <div>
              <h1>{p?.name ?? '—'}</h1>
              <div className="sub"><span>{p?.mrn ?? 'MRN —'}</span> · <span>Bed {p?.bedId ?? '—'}</span></div>
            </div>
          </div>
          <div className="chips">
            <div className="chip"><span className="k">Age / Sex</span><span className="v">{p ? `${p.age} · ${p.sex}` : '—'}</span></div>
            <div className="chip"><span className="k">Diagnosis</span><span className="v">{p?.diagnosis ?? '—'}</span></div>
            <div className="chip"><span className="k">ICU Day</span><span className="v num">{p ? `Day ${p.los}` : '—'}</span></div>
            <div className="chip alert"><span className="k">Allergies</span><span className="v">{p?.allergies ?? '—'}</span></div>
            <div className="chip"><span className="k">Attending</span><span className="v">{p?.attending ?? '—'}</span></div>
            <div className="chip code"><span className="k">Code Status</span><span className="v">{p?.codeStatus ?? '—'}</span></div>
            <div className="chip upd"><span className="k">Last Updated</span><span className="v">{shortTime} · auto</span></div>
          </div>
        </div>
      </header>

      <div className="shell">
        <aside>
          <div className="side-head">
            <div className="ttl">Patients <Badge color="blue">{filtered.length}</Badge></div>
            <div className="searchbox">
              <IconSearch size={14} />
              <input
                placeholder="Search name, bed, MRN…" aria-label="Search name, bed, MRN"
                value={query} onChange={e => setQuery(e.target.value.trim().toLowerCase())}
              />
            </div>
            <div className="filters">
              {FILTERS.map(f => (
                <button key={f.key} className={`fbtn${filter === f.key ? ' on' : ''}`} aria-pressed={filter === f.key} onClick={() => setFilter(f.key)}>
                  {f.label}
                </button>
              ))}
            </div>
          </div>
          <div className="ptlist">
            {filtered.map(pt => (
              <button
                key={pt.patientId}
                className={`ptcard${pt.patientId === patientId ? ' sel' : ''}`}
                onClick={() => navigate(`/patients/${pt.patientId}`)}
                aria-label={`Open ${pt.name}, bed ${pt.bedId}`}
              >
                <div className="r1">
                  <BedChip bedId={pt.bedId} />
                  <span className="nm">{pt.name}</span>
                  <span className={`acount${pt.alertCount ? '' : ' zero'}`}>{pt.alertCount}</span>
                </div>
                <div className="dx">{pt.diagnosis}</div>
                <div className="tags"><TagList flags={pt.flags} iso={pt.isolation} /></div>
              </button>
            ))}
          </div>
        </aside>

        <main>
          {missing && (
            <section className="card notfound" role="alert">
              <IconAlertTriangle size={28} stroke="var(--amber)" />
              <h2>Patient Not Found</h2>
              <p>
                No patient found for this ID — they may have been discharged, transferred,
                or this link is outdated.
              </p>
              <button className="nf-btn" onClick={() => navigate('/beds')}>← Back to Bed Overview</button>
            </section>
          )}

          {detail && <MonitorCard vitals={detail.patient.vitals} rhythm={detail.patient.rhythm} />}

          {detail && (
            <div className="colR">
              <DigitalTwin organs={detail.patient.organs} />
              <AiPanel risks={detail.aiRisks} />
            </div>
          )}

          {detail && (
            <Card id="vent" icon={<IconVent size={15} stroke="var(--blue)" />} title="Ventilator"
              aside={<Badge color="blue">{detail.ventilator.mode}</Badge>}>
              <div className="tgrid">
                {detail.ventilator.tiles.map(t => (
                  <VitalTile key={t.label} variant="tile" label={t.label} value={t.value} unit={t.unit} warn={t.warn} />
                ))}
              </div>
            </Card>
          )}

          {detail && (
            <Card id="hemo"
              icon={<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--red)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 21C7 17 3 13.5 3 9a5 5 0 019-3 5 5 0 019 3c0 4.5-4 8-9 12z" /></svg>}
              title="Hemodynamics" aside="PiCCO · q1h">
              <div className="tgrid">
                {detail.hemodynamics.metrics.map(t => (
                  <VitalTile key={t.label} variant="tile" label={t.label} value={t.value} unit={t.unit} warn={t.warn} />
                ))}
              </div>
              <div className="fluid">
                <div className="fk"><span>Fluid balance · 24 h</span><b className="num" style={{ color: 'var(--cyan)' }}>{detail.hemodynamics.fluidBalance.value}</b></div>
                <div className="fbar"><i style={{ width: `${detail.hemodynamics.fluidBalance.percent}%` }} /></div>
              </div>
            </Card>
          )}

          {detail && (
            <Card id="meds"
              icon={<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--cyan)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="7" y="2" width="10" height="20" rx="4" /><path d="M7 9h10M7 15h10" /></svg>}
              title="Active Infusions" aside={`${runningInfusions} running · ${detail.infusions.length} channels`}>
              <div>
                {detail.infusions.map(m => {
                  const running = m.trend[m.trend.length - 1] > 0
                  return (
                    <div className="medrow" key={m.name}>
                      <div><div className="mn">{m.name}</div><div className="md">{m.dose}</div></div>
                      <div className="mr">{m.rate}</div>
                      <Sparkline data={m.trend} color={running ? 'var(--cyan)' : 'rgba(130,170,230,.3)'} width={62} height={22} baseline="zero" />
                      <span className={`mwarn ${m.status}`} title={m.status === 'hi' ? 'High-dose warning' : m.status === 'md' ? 'Review due' : 'Nominal'} />
                    </div>
                  )
                })}
              </div>
            </Card>
          )}

          {detail && <LabsCard labs={detail.labs} />}

          {detail && (
            <Card id="alerts"
              icon={<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--red)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3l10 18H2L12 3z" /><path d="M12 10v5m0 3v.01" /></svg>}
              title="Smart Alerts" aside={`${activeAlerts.length} active`}>
              <div className="alist">
                {alerts.map(a => (
                  <AlertRow key={a.key} severity={a.severity} text={a.message} time={a.time} leaving={a.leaving} onAck={() => ackAlert(a.key)} />
                ))}
              </div>
            </Card>
          )}

          {detail && (
            <Card id="goals" icon={<IconCheck size={15} stroke="var(--green)" strokeWidth={2} />} title="Daily Goals · Rounding Checklist" aside="Tap to complete">
              <div className="gprog">
                <div className="gbar"><i style={{ width: `${goalPct}%` }} /></div>
                <b>{goalPct}%</b>
              </div>
              <div className="glist">
                {goals.map((goal, i) => (
                  <button key={goal.label} className={`goal${goal.done ? ' done' : ''}`} aria-pressed={goal.done} onClick={() => toggleGoal(i)}>
                    <span className="cb"><IconCheck size={11} /></span>
                    <span>{goal.label}</span>
                  </button>
                ))}
              </div>
            </Card>
          )}

          {detail && (
            <Card id="timeline"
              icon={<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--dim)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 3" /></svg>}
              title="Clinical Timeline · Last 24 h"
              aside={(
                <button className="tlmore" onClick={() => navigate(`/timeline/${patientId}`)}>
                  Full timeline →
                </button>
              )}>
              {/* derived view over the aggregated feed (Screen 7) — same data, compact strip */}
              <div className="tl">
                {detail.timeline.map(ev => (
                  <div className="tle" key={ev.id}>
                    <span className="tt">{ev.time}</span>
                    <span className={`tc ${ev.category}`}>{ev.categoryLabel}</span>
                    <p>{ev.title}{ev.detail ? ` — ${ev.detail}` : ''}</p>
                  </div>
                ))}
              </div>
            </Card>
          )}
          {!detail && !missing && <div style={{ gridColumn: '1/-1' }} aria-busy="true" />}
        </main>
      </div>
    </div>
  )
}

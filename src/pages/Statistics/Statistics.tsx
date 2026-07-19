import { useEffect, useState } from 'react'
import './Statistics.css'
import { AppHeader, type KpiSpec } from '../../components/AppHeader'
import { NavSidebar } from '../../components/NavSidebar'
import { Card } from '../../components/Card'
import { IconAdmit, IconBed, IconDischarge, IconFlask, IconStats } from '../../components/icons'
import {
  dispositionLabel, getAdtBeds, getEncounters, getFormulary, getLabDraws,
  getObservations, getPatientOrders,
} from '../../lib/api'
import { computeStatistics, type StatisticsModel, type TrendPoint } from '../../lib/statistics'
import { getSession, initialsOf, profileOf } from '../../lib/session'

/** Statistics — the ICU Analytics Dashboard (docs/design/
 *  statistics-dashboard-design.md). Closes the first of the three dead nav
 *  items: five sections — Current Unit Status, Admissions, Outcomes,
 *  Clinical Quality, Trends — every metric COMPUTED AT RENDER from the
 *  canonical reads, or shown as an explicit "not tracked yet" placeholder.
 *  NEVER a fabricated number (§0).
 *
 *  UNIT-LEVEL AGGREGATES ONLY (§3): counts, rates, averages, trends — no
 *  patient identifier appears anywhere on this page, so the office
 *  Administrator (whose core use is these statistics) sees nothing
 *  clinical-identifiable; drilling into a patient stays gated as today.
 *
 *  HONESTY RULES (§4), all rendered:
 *  - averages label their denominator (SOFA/NEWS2 over computable
 *    patients; mortality over dispositioned discharges; LOS and
 *    time-to-antibiotic over dated encounters);
 *  - sparse going-forward data is STATED (dated stamps + dispositions
 *    exist on new records only);
 *  - "not tracked yet" (isolation, medication errors, documentation
 *    completeness) is visually distinct from a real 0 AND from
 *    "insufficient data". */

type LoadState = 'loading' | 'ready' | 'unavailable'

const fmt = (v: number | null, unit = ''): string => (v === null ? '—' : `${v}${unit}`)

/* one metric tile: value + label + the honesty sub-line. kind drives the
   visual distinction the design requires (§4): real numbers plain, a real
   zero plain, insufficient-data dimmed, not-tracked dashed+labelled. */
function Stat({ label, value, sub, kind = 'real' }: {
  label: string; value: string; sub?: string; kind?: 'real' | 'insufficient' | 'nottracked'
}) {
  return (
    <div className={`st-tile st-${kind}`}>
      <div className="st-value num">{kind === 'nottracked' ? 'not tracked yet' : value}</div>
      <div className="st-label">{label}</div>
      {sub && <div className="st-sub">{sub}</div>}
    </div>
  )
}

/* tiny dependency-free column chart for the daily trends */
function MiniBars({ points, unit }: { points: TrendPoint[]; unit?: string }) {
  const values = points.map(p => p.value ?? 0)
  const max = Math.max(1, ...values)
  return (
    <div className="st-bars" role="img" aria-label={points.map(p => `${p.label}: ${p.value ?? '—'}`).join(', ')}>
      {points.map((p, i) => (
        <div className="st-barcol" key={i} title={`${p.label} — ${p.value ?? '—'}${unit ?? ''}${p.computable !== undefined ? ` (over ${p.computable} computable)` : ''}`}>
          <span className="st-barval num">{p.value ?? '—'}</span>
          <span className="st-bar" style={{ height: `${p.value === null ? 2 : Math.max(4, (p.value / max) * 56)}px` }} />
          <span className="st-barlab num">{p.label}</span>
        </div>
      ))}
    </div>
  )
}

export function Statistics() {
  const session = getSession()!
  const [state, setState] = useState<LoadState>('loading')
  const [m, setModel] = useState<StatisticsModel | null>(null)

  useEffect(() => {
    let stale = false
    Promise.all([getAdtBeds(), getEncounters(), getFormulary()])
      .then(async ([beds, encounters, formulary]) => {
        const open = encounters.filter(e => e.status === 'open')
        /* per-patient canonical reads for the unit aggregates — parallel;
           a failed source resolves null so that patient is EXCLUDED from
           that metric's computable denominator (never counted as zero) */
        const patients = await Promise.all(open.map(async e => {
          const [labs, observations, orders] = await Promise.all([
            getLabDraws(e.patientId).catch(() => null),
            getObservations(e.patientId, e.encounterId).catch(() => null),
            getPatientOrders(e.patientId).catch(() => null),
          ])
          return { patientId: e.patientId, encounter: e, labs, observations, orders }
        }))
        if (stale) return
        setModel(computeStatistics({ beds, encounters, formulary, patients, now: new Date() }))
        setState('ready')
      })
      .catch(() => { if (!stale) setState('unavailable') })
    return () => { stale = true }
  }, [])

  const kpis: KpiSpec[] = [
    { icon: <IconBed size={14} stroke="var(--blue)" />, iconBg: 'rgba(var(--blue-rgb),.15)', value: m ? `${m.occupancyPct}%` : '—', label: 'Occupancy' },
    { icon: <IconAdmit size={14} stroke="var(--cyan)" />, iconBg: 'rgba(var(--cyan-rgb),.13)', value: m?.admissionsToday ?? '—', label: 'Admissions Today' },
    { icon: <IconDischarge size={14} stroke="var(--amber)" />, iconBg: 'rgba(var(--amber-rgb),.14)', value: m?.dischargesToday ?? '—', label: 'Discharges Today' },
    { icon: <IconStats size={14} stroke="var(--green)" />, iconBg: 'rgba(var(--green-rgb),.13)', value: m?.mortality.pct === null || m === null ? '—' : `${m.mortality.pct}%`, label: 'ICU Mortality' },
  ]

  return (
    <div className="app-frame st">
      <AppHeader
        subtitle="Statistics · ICU Analytics"
        kpis={kpis}
        user={{ initials: initialsOf(session.name), name: session.name, role: `${session.jobTitle} · ${profileOf(session.jobTitle)} profile` }}
      />
      <div className="shell">
        <NavSidebar active="statistics" footerLines={['Unit-level aggregates only', 'Computed at render — nothing stored']} />

        <main className="st-main">
          {state === 'loading' && <div className="st-note" role="status">Computing unit statistics from the live records…</div>}
          {state === 'unavailable' && (
            <div className="st-note" role="alert">
              Statistics require the live server — the canonical reads are unavailable and nothing is fabricated.
            </div>
          )}
          {state === 'ready' && m && (
            <>
              <div className="st-honesty" role="note">
                All values are computed at render from the live records. Calendar periods are UTC.
                Dated timestamps and discharge dispositions exist on records created after their
                respective fixes — time-based metrics and mortality are accurate but will be sparse
                until new data accumulates; denominators below say exactly what each number covers.
              </div>

              <Card icon={<IconBed size={15} stroke="var(--blue)" />} title="Current Unit Status" aside={`${m.bedsOccupied} of ${m.bedsTotal} beds occupied`}>
                <div className="st-grid">
                  <Stat label="Occupancy rate" value={`${m.occupancyPct}%`} sub={`${m.bedsOccupied} of ${m.bedsTotal} beds`} />
                  <Stat label="Available beds" value={`${m.bedsAvailable}`} />
                  <Stat label="Ventilated patients" value={`${m.ventilated.count}`}
                    sub={`from charted respiratory-support observations — over ${m.ventilated.withObs} of ${m.ventilated.total} current patients with observation data`}
                    kind={m.ventilated.withObs === 0 ? 'insufficient' : 'real'} />
                  <Stat label="Vasopressor patients" value={`${m.vasopressor.count}`}
                    sub={`active vasopressor-class medication orders — over ${m.vasopressor.withOrders} of ${m.vasopressor.total} current patients with order data`}
                    kind={m.vasopressor.withOrders === 0 ? 'insufficient' : 'real'} />
                  <Stat label="Isolation patients" value={`${m.isolation.count}`}
                    sub={`open encounters carrying isolation precautions (typed per the IPC vocabulary; pre-vocabulary flags were preserved as "unspecified", never guessed)`}
                    kind="real" />
                  <Stat label="Average SOFA" value={fmt(m.avgSofa.value)}
                    sub={`over ${m.avgSofa.computable} of ${m.avgSofa.total} current patients with complete data — INCOMPLETE scores are never averaged as zero`}
                    kind={m.avgSofa.value === null ? 'insufficient' : 'real'} />
                  <Stat label="Average NEWS2" value={fmt(m.avgNews2.value)}
                    sub={`over ${m.avgNews2.computable} of ${m.avgNews2.total} current patients with complete data`}
                    kind={m.avgNews2.value === null ? 'insufficient' : 'real'} />
                  <Stat label="Average length of stay" value={fmt(m.avgLosDays.value, ' d')}
                    sub={`over ${m.avgLosDays.dated} of ${m.avgLosDays.total} current admissions with dated stamps (going-forward data)`}
                    kind={m.avgLosDays.value === null ? 'insufficient' : 'real'} />
                </div>
              </Card>

              <Card icon={<IconAdmit size={15} stroke="var(--cyan)" />} title="Admissions" aside={`${m.admissionsDatedTotal} dated admissions on record`}>
                <div className="st-grid">
                  <Stat label="Today" value={`${m.admissionsToday}`} />
                  <Stat label="This week" value={`${m.admissionsWeek}`} sub="UTC calendar week (since Monday)" />
                  <Stat label="This month" value={`${m.admissionsMonth}`} sub="UTC calendar month" />
                </div>
                {m.admissionsUndatedTotal > 0 && (
                  <p className="st-foot">
                    {m.admissionsUndatedTotal} earlier admission{m.admissionsUndatedTotal === 1 ? '' : 's'} predate dated
                    timestamps and cannot be placed in a period — counted nowhere above, never guessed.
                  </p>
                )}
              </Card>

              <Card icon={<IconDischarge size={15} stroke="var(--amber)" />} title="Outcomes" aside={`${m.dischargesTotal} discharged encounters (all time)`}>
                <div className="st-grid">
                  <Stat label="Discharges today" value={`${m.dischargesToday}`} sub={`week ${m.dischargesWeek} · month ${m.dischargesMonth} — dated discharges only (${m.dischargesDated} of ${m.dischargesTotal})`} />
                  <Stat label="Deaths" value={`${m.deaths}`} sub="discharge disposition = Died" />
                  <Stat label="ICU mortality" value={m.mortality.pct === null ? '—' : `${m.mortality.pct}%`}
                    sub={`${m.mortality.died} of ${m.mortality.withDisposition} discharges with a recorded disposition — ${m.mortality.withoutDisposition} earlier discharge${m.mortality.withoutDisposition === 1 ? '' : 's'} predate outcome capture and are excluded from the denominator`}
                    kind={m.mortality.pct === null ? 'insufficient' : 'real'} />
                  <Stat label="Readmitted patients" value={`${m.readmittedPatients}`} sub="patients with more than one encounter (all time)" />
                  <Stat label="Readmissions < 48 h" value={`${m.readmissionsWithin48h.count}`}
                    sub={`over ${m.readmissionsWithin48h.datedPairs} discharge→readmission pair${m.readmissionsWithin48h.datedPairs === 1 ? '' : 's'} with dated stamps on both sides`}
                    kind={m.readmissionsWithin48h.datedPairs === 0 ? 'insufficient' : 'real'} />
                </div>
                <div className="st-breakdown">
                  <span className="st-bh">Discharge outcomes</span>
                  {m.outcomeBreakdown.map(o => (
                    <span className="st-chip" key={o.code}><b className="num">{o.count}</b> {dispositionLabel(o.code)}</span>
                  ))}
                  <span className="st-chip st-chip-na"><b className="num">{m.outcomeNotRecorded}</b> not recorded (pre-capture)</span>
                </div>
              </Card>

              <Card icon={<IconFlask size={15} stroke="var(--red)" />} title="Clinical Quality">
                <div className="st-grid">
                  <Stat label="Critical labs acknowledged" value={m.criticalLabs.total === 0 ? '—' : `${Math.round((m.criticalLabs.acknowledged / m.criticalLabs.total) * 100)}%`}
                    sub={m.criticalLabs.total === 0
                      ? 'no critical results among current patients — nothing to acknowledge'
                      : `${m.criticalLabs.acknowledged} of ${m.criticalLabs.total} critical results across current patients`}
                    kind={m.criticalLabs.total === 0 ? 'insufficient' : 'real'} />
                  <Stat label="Average time to antibiotic" value={m.timeToAntibioticMin.value === null ? '—' : `${m.timeToAntibioticMin.value} min`}
                    sub={`over ${m.timeToAntibioticMin.encounters} of ${m.timeToAntibioticMin.consideredEncounters} current dated admissions with an antibiotic order (going-forward data)`}
                    kind={m.timeToAntibioticMin.value === null ? 'insufficient' : 'real'} />
                  <Stat label="Medication errors" value="" kind="nottracked"
                    sub="no error-report entity exists — needs the reporting workflow first. (Safety-override counts ARE real and audited — flagged as a possible honestly-labelled alternative, owner's decision.)" />
                  <Stat label="Documentation completeness" value="" kind="nottracked"
                    sub="no note store and no agreed definition yet — needs the capability first" />
                </div>
              </Card>

              <Card icon={<IconStats size={15} stroke="var(--green)" />} title="Trends"
                aside="daily × 14 days · scores at their native 24 h windows">
                <div className="st-trends">
                  <div className="st-trend">
                    <span className="st-th">Occupied (dated encounters) per day</span>
                    <MiniBars points={m.occupancyTrend} />
                    <span className="st-sub">covers the {m.trendDatedEncounters} encounters with dated stamps — earlier undated admissions cannot be placed in time and are excluded (going-forward)</span>
                  </div>
                  <div className="st-trend">
                    <span className="st-th">Admissions per day</span>
                    <MiniBars points={m.admissionsTrend} />
                    <span className="st-sub">dated admissions only (going-forward)</span>
                  </div>
                  <div className="st-trend">
                    <span className="st-th">Unit average SOFA</span>
                    <MiniBars points={m.sofaTrend} />
                    <span className="st-sub">each point averages the patients whose 24 h window is computable (denominator in the tooltip) — INCOMPLETE never counted as zero</span>
                  </div>
                  <div className="st-trend">
                    <span className="st-th">Unit average NEWS2</span>
                    <MiniBars points={m.news2Trend} />
                    <span className="st-sub">from dated observations, same computable-only rule</span>
                  </div>
                </div>
              </Card>
            </>
          )}
        </main>
      </div>
    </div>
  )
}

import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import './AiAssistant.css'
import { AppHeader, type KpiSpec } from '../../components/AppHeader'
import { NavSidebar } from '../../components/NavSidebar'
import { NotFoundCard } from '../../components/NotFoundCard'
import { PatientBar } from '../../components/PatientBar'
import { PatientRail } from '../../components/PatientRail'
import { BedChip } from '../../components/Tag'
import { Sparkline } from '../../components/Sparkline'
import { Toast, useToast } from '../../components/Toast'
import { IconAlertTriangle, IconBrain } from '../../components/icons'
import { AI_ALERT_THRESHOLD, getPatientDetail, getRiskProfile, getRiskRanking } from '../../lib/api'
import { lastPatientId, useRememberPatient } from '../../lib/patientContext'
import { getSession, initialsOf, profileOf } from '../../lib/session'
import type { Patient, PatientRiskProfile, RiskRankingRow } from '../../lib/api/types'
import { riskColor } from '../../lib/risk'
import { RiskCard, trendLabel } from './RiskCard'

/** Screen 8 — AI Clinical Assistant. THE canonical view over the AI risk
 *  domain: unit-wide ranking at /ai, per-patient profile at /ai/:patientId.
 *  ALL predictions are simulated mock data ("Simulated · updated q15min")
 *  until Stage 11. Advisory only — no action can be taken from this screen;
 *  threshold crossings surface in the existing alert center. */
export function AiAssistant() {
  const { patientId = '' } = useParams()
  const navigate = useNavigate()
  const { toast, showToast } = useToast()
  /* Stage 9 session — the assistant is advisory-only for every profile */
  const session = getSession()!
  const sessionProfile = profileOf(session.jobTitle)

  const [ranking, setRanking] = useState<RiskRankingRow[] | null>(null)
  const [patient, setPatient] = useState<Patient | null>(null)
  const [profile, setProfile] = useState<PatientRiskProfile | null>(null)
  const [missing, setMissing] = useState(false)

  useEffect(() => { getRiskRanking().then(setRanking) }, [])

  /* no patient in the URL → the remembered cross-section patient IF the
     ranking lists them; otherwise this screen's normal default stands (the
     unit ranking overview — never a silently-substituted patient) */
  useEffect(() => {
    if (patientId || !ranking?.length) return
    const remembered = lastPatientId()
    if (remembered && ranking.some(r => r.patientId === remembered)) navigate(`/ai/${remembered}`, { replace: true })
  }, [patientId, ranking, navigate])
  /* record the viewed patient as the cross-section context (only once the
     ranking confirms the id resolves) */
  useRememberPatient(patientId, ranking)

  useEffect(() => {
    if (!patientId) {
      setPatient(null)
      setProfile(null)
      setMissing(false)
      return
    }
    let stale = false
    setMissing(false)
    getPatientDetail(patientId).then(res => {
      if (stale) return
      if (!res) {
        /* locked decision: explicit not-found — never another patient's data */
        setPatient(null)
        setProfile(null)
        setMissing(true)
        return
      }
      setPatient(res.patient)
    })
    getRiskProfile(patientId).then(p => { if (!stale) setProfile(p) })
    return () => { stale = true }
  }, [patientId])

  /* unit-level KPIs shown on both views (ranking is the shared source) */
  const allRisks = ranking?.flatMap(r => [r.top, ...r.alsoElevated]) ?? []
  const kpis: KpiSpec[] = [
    { icon: <IconBrain size={14} stroke="var(--violet)" />, iconBg: 'rgba(167,139,250,.15)', value: ranking ? ranking.length : '—', label: 'Patients Scored' },
    {
      icon: <IconAlertTriangle size={14} stroke="var(--red)" />, iconBg: 'rgba(255,93,108,.14)',
      value: ranking ? ranking.filter(r => r.top.probability >= 70).length : '—', label: 'High Risk ≥ 70%',
      valueStyle: ranking?.some(r => r.top.probability >= 70) ? { color: 'var(--red)' } : undefined,
    },
    {
      icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--amber)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 17l6-6 4 4 8-8" /><path d="M14 7h7v7" /></svg>,
      iconBg: 'rgba(255,180,84,.14)', value: ranking ? allRisks.filter(r => r.trend === 'rising').length : '—', label: 'Rising Risks',
    },
    {
      icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--cyan)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 3" /></svg>,
      iconBg: 'rgba(53,224,208,.13)', value: ranking?.[0]?.updatedAt ?? '—', label: 'Model Tick (Sim.)',
    },
  ]

  const alertsRaised = allRisks.filter(r => r.probability >= AI_ALERT_THRESHOLD).length

  return (
    <div className="app-frame aa">
      <AppHeader
        subtitle="AI Clinical Assistant"
        kpis={kpis}
        bellCount={alertsRaised}
        onBellClick={() => showToast('Alert center', `${alertsRaised} simulated AI risk(s) above the ${AI_ALERT_THRESHOLD}% alert threshold — see each patient's alert center`)}
        user={{ initials: initialsOf(session.name), name: session.name, role: `${session.jobTitle} · ${sessionProfile} profile` }}
      />
      <div className="shell">
        <NavSidebar
          active="ai"
          alertCount={alertsRaised}
          footerLines={[`Role: ${sessionProfile} profile`, 'Simulated · advisory only']}
        />

        <PatientRail
          title="Patients · by risk"
          accent="violet"
          patients={ranking?.map(r => ({ patientId: r.patientId, bedId: r.bedId, name: r.patientName, top: r.top }))}
          selectedId={patientId}
          onSelect={id => navigate(`/ai/${id}`)}
          badge={p => <span className="prtop num" style={{ color: riskColor(p.top.probability) }}>{p.top.probability}%</span>}
        />

        <main>
          <div className="aidisclaimer" role="note">
            <IconBrain size={14} stroke="var(--violet)" />
            <span>
              <b>Simulated predictions · updated q15min.</b> Mock model output until device &
              model integration (Stage 11). Advisory only — this screen never places orders
              or takes action; risks ≥ {AI_ALERT_THRESHOLD}% also appear in the patient's alert center.
            </span>
          </div>

          {missing && <NotFoundCard />}

          {/* ===== unit-wide ranking (/ai) ===== */}
          {!patientId && ranking && (
            <section className="card aarank">
              <div className="aahead">
                <h2><IconBrain size={15} stroke="var(--violet)" /> Unit Risk Ranking</h2>
                <span className="aaaside">Highest current risk in any category · Simulated · updated q15min</span>
              </div>
              <div className="aaranklist">
                {ranking.map((r, i) => (
                  <button
                    key={r.patientId}
                    className={`aarow${r.top.probability >= 70 ? ' crit' : ''}`}
                    onClick={() => navigate(`/ai/${r.patientId}`)}
                    aria-label={`Open risk profile: ${r.patientName}, top risk ${r.top.category} ${r.top.probability}%`}
                  >
                    <span className="aarank-n num">{i + 1}</span>
                    <BedChip bedId={r.bedId} />
                    <span className="aawho">
                      <b>{r.patientName}</b>
                      <small>{r.diagnosis}</small>
                    </span>
                    <span className="aatop">
                      <b className="num" style={{ color: riskColor(r.top.probability) }}>{r.top.probability}%</b>
                      <small>{r.top.category}</small>
                    </span>
                    <span className={`rktrend t-${r.top.trend}`}>{trendLabel(r.top.trend, r.top.delta)}</span>
                    <Sparkline data={r.topHistory} color={riskColor(r.top.probability)} width={92} height={24} />
                    <span className="aaelev">
                      {r.alsoElevated.length
                        ? r.alsoElevated.map(e => (
                          <i key={e.category} className="aachip" style={{ color: riskColor(e.probability) }}>
                            {e.category} {e.probability}%{e.trend === 'rising' ? ' ▲' : e.trend === 'falling' ? ' ▼' : ''}
                          </i>
                        ))
                        : <i className="aachip none">no other elevated risks</i>}
                    </span>
                  </button>
                ))}
              </div>
            </section>
          )}

          {/* ===== patient profile (/ai/:patientId) ===== */}
          {patientId && patient && profile && (
            <>
              <PatientBar
                patient={patient}
                links={[
                  { label: 'Chart →', to: `/patients/${patient.patientId}` },
                  { label: 'Orders →', to: `/orders/${patient.patientId}` },
                  { label: 'Results →', to: `/labs/${patient.patientId}` },
                  { label: 'Timeline →', to: `/timeline/${patient.patientId}` },
                ]}
              >
                <span className="ptbardx">{patient.diagnosis}</span>
                {sessionProfile !== 'Doctor' && sessionProfile !== 'SeniorDoctor' &&
                  <span className="ptbarviewonly">View only — advisory screen</span>}
              </PatientBar>
              <div className="aacards">
                {[...profile.risks].sort((a, b) => b.probability - a.probability).map(r => (
                  <RiskCard key={r.category} risk={r} />
                ))}
              </div>
            </>
          )}
        </main>
      </div>
      <Toast state={toast} accent="green" />
    </div>
  )
}

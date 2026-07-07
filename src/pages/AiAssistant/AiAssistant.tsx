import { useEffect, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import './AiAssistant.css'
import { AppHeader, type KpiSpec } from '../../components/AppHeader'
import { NavSidebar } from '../../components/NavSidebar'
import { BedChip } from '../../components/Tag'
import { Sparkline } from '../../components/Sparkline'
import { Toast, useToast } from '../../components/Toast'
import { IconAlertTriangle, IconBrain } from '../../components/icons'
import { AI_ALERT_THRESHOLD, getPatientDetail, getRiskProfile, getRiskRanking } from '../../lib/api'
import { CURRENT_SESSION, type SessionRole } from '../../lib/session'
import type { Patient, PatientRiskProfile, RiskRankingRow } from '../../lib/api/types'
import { RiskCard, riskColor, trendLabel } from './RiskCard'

/** Screen 8 — AI Clinical Assistant. THE canonical view over the AI risk
 *  domain: unit-wide ranking at /ai, per-patient profile at /ai/:patientId.
 *  ALL predictions are simulated mock data ("Simulated · updated q15min")
 *  until Stage 11. Advisory only — no action can be taken from this screen;
 *  threshold crossings surface in the existing alert center. */
export function AiAssistant() {
  const { patientId = '' } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const { toast, showToast } = useToast()
  /* dev preview of the nurse view until Stage 9 auth: /ai/P-1001?as=nurse */
  const role: SessionRole =
    new URLSearchParams(location.search).get('as') === 'nurse' ? 'nurse' : CURRENT_SESSION.role

  const [ranking, setRanking] = useState<RiskRankingRow[] | null>(null)
  const [patient, setPatient] = useState<Patient | null>(null)
  const [profile, setProfile] = useState<PatientRiskProfile | null>(null)
  const [missing, setMissing] = useState(false)

  useEffect(() => { getRiskRanking().then(setRanking) }, [])

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
        user={role === 'nurse'
          ? { initials: 'MC', name: 'RN Maya Chen', role: 'ICU Nurse · view only' }
          : { initials: 'SR', name: 'Dr. Sara Rahman', role: 'Intensivist · advisory review' }}
      />
      <div className="shell">
        <NavSidebar
          active="ai"
          alertCount={alertsRaised}
          dashboardRoute={role === 'nurse' ? '/nurse' : '/workspace'}
          footerLines={[role === 'nurse' ? 'Role: Nurse' : 'Role: Physician', 'Simulated · advisory only']}
        />

        <aside className="ptrail" aria-label="Patients by risk">
          <div className="ptrailhead">Patients · by risk</div>
          <div className="ptraillist">
            {ranking?.map(r => (
              <button
                key={r.patientId}
                className={`ptrailcard${r.patientId === patientId ? ' sel' : ''}`}
                aria-current={r.patientId === patientId ? 'page' : undefined}
                onClick={() => navigate(`/ai/${r.patientId}${location.search}`)}
              >
                <BedChip bedId={r.bedId} />
                <span className="prname">{r.patientName}</span>
                <span className="prtop num" style={{ color: riskColor(r.top.probability) }}>{r.top.probability}%</span>
              </button>
            ))}
          </div>
        </aside>

        <main>
          <div className="aidisclaimer" role="note">
            <IconBrain size={14} stroke="var(--violet)" />
            <span>
              <b>Simulated predictions · updated q15min.</b> Mock model output until device &
              model integration (Stage 11). Advisory only — this screen never places orders
              or takes action; risks ≥ {AI_ALERT_THRESHOLD}% also appear in the patient's alert center.
            </span>
          </div>

          {missing && (
            <section className="card notfound" role="alert">
              <IconAlertTriangle size={28} stroke="var(--amber)" />
              <h2>Patient Not Found</h2>
              <p>No patient found for this ID — they may have been discharged, transferred, or this link is outdated.</p>
              <button className="nf-btn" onClick={() => navigate('/beds')}>← Back to Bed Overview</button>
            </section>
          )}

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
                    onClick={() => navigate(`/ai/${r.patientId}${location.search}`)}
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
              <div className="ptbar">
                <BedChip bedId={patient.bedId} />
                <b className="ptbarname">{patient.name}</b>
                <span className="ptbarsub num">{patient.mrn} · {patient.age} · {patient.sex}</span>
                <span className="ptbardx">{patient.diagnosis}</span>
                {role === 'nurse' && <span className="ptbarviewonly">View only — nurse session</span>}
                <div className="ptbarlinks">
                  <button className="ptbarlink" onClick={() => navigate(`/patients/${patient.patientId}`)}>Chart →</button>
                  <button className="ptbarlink" onClick={() => navigate(`/orders/${patient.patientId}`)}>Orders →</button>
                  <button className="ptbarlink" onClick={() => navigate(`/labs/${patient.patientId}`)}>Results →</button>
                  <button className="ptbarlink" onClick={() => navigate(`/timeline/${patient.patientId}`)}>Timeline →</button>
                </div>
              </div>
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

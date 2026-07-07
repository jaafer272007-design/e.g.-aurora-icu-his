import { useCallback, useEffect, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import './LabImaging.css'
import { AppHeader, type KpiSpec } from '../../components/AppHeader'
import { NavSidebar } from '../../components/NavSidebar'
import { BedChip } from '../../components/Tag'
import { Toast, useToast } from '../../components/Toast'
import { IconAlertTriangle, IconFlask } from '../../components/icons'
import {
  acknowledgeImaging, acknowledgeLab, getImagingStudies, getLabDraws, getPatientDetail,
  getPatients, getResultInbox,
} from '../../lib/api'
import { CURRENT_SESSION, canAcknowledgeResults, type SessionRole } from '../../lib/session'
import type {
  ImagingStudy, LabDraw, Patient, PatientSummary, ResultInboxItem,
} from '../../lib/api/types'
import { LabTrendsCard } from './LabTrendsCard'
import { ImagingCard } from './ImagingCard'
import { ResultInboxCard } from './ResultInboxCard'

/** Screen 6 — Laboratory & Imaging. THE canonical record of lab and imaging
 *  RESULTS (Screen 5 places the orders). Doctor RBAC acknowledges; nurses
 *  view only. Result ages are computed at render via the shared clock. */
export function LabImaging() {
  const { patientId = '' } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const { toast, showToast } = useToast()
  /* dev preview of the nurse view until Stage 9 auth: /labs/P-1001?as=nurse */
  const role: SessionRole =
    new URLSearchParams(location.search).get('as') === 'nurse' ? 'nurse' : CURRENT_SESSION.role

  const [patients, setPatients] = useState<PatientSummary[] | null>(null)
  const [patient, setPatient] = useState<Patient | null>(null)
  const [missing, setMissing] = useState(false)
  const [draws, setDraws] = useState<LabDraw[] | null>(null)
  const [studies, setStudies] = useState<ImagingStudy[] | null>(null)
  const [inbox, setInbox] = useState<ResultInboxItem[]>([])

  useEffect(() => { getPatients().then(setPatients) }, [])

  useEffect(() => {
    if (!patientId && patients?.length) navigate(`/labs/${patients[0].patientId}${location.search}`, { replace: true })
  }, [patientId, patients, navigate, location.search])

  const refresh = useCallback(() => {
    if (patientId) {
      getLabDraws(patientId).then(setDraws)
      getImagingStudies(patientId).then(setStudies)
    }
    getResultInbox().then(setInbox)
  }, [patientId])

  useEffect(() => {
    if (!patientId) return
    let stale = false
    setMissing(false)
    getPatientDetail(patientId).then(res => {
      if (stale) return
      if (!res) {
        /* locked decision: explicit not-found — never another patient's data */
        setPatient(null)
        setDraws(null)
        setStudies(null)
        setMissing(true)
        return
      }
      setPatient(res.patient)
    })
    refresh()
    return () => { stale = true }
  }, [patientId, refresh])

  const ackLab = (labId: string) => {
    acknowledgeLab(labId, CURRENT_SESSION.actor, role).then(ok => {
      if (!ok) { showToast('Not permitted', 'Acknowledgement requires physician role'); return }
      refresh()
      showToast('Result acknowledged', `${ok.panel} panel · ${ok.patientName}`)
    })
  }

  const ackImaging = (studyId: string) => {
    acknowledgeImaging(studyId, CURRENT_SESSION.actor, role).then(ok => {
      if (!ok) { showToast('Not permitted', 'Acknowledgement requires physician role'); return }
      refresh()
      showToast('Study acknowledged', `${ok.description} · ${ok.patientName}`)
    })
  }

  const ackInboxItem = (item: ResultInboxItem) => {
    if (item.kind === 'lab') ackLab(item.id)
    else ackImaging(item.id)
  }

  const patientInbox = inbox.filter(i => i.patientId === patientId)
  const latestByPanel = new Map<string, LabDraw>()
  draws?.forEach(d => latestByPanel.set(d.panel, d))
  const criticalCount =
    [...latestByPanel.values()].filter(d => d.flag === 'critical').length +
    (studies?.filter(s => s.flag === 'critical' && (s.status === 'preliminary' || s.status === 'final')).length ?? 0)
  const imagingPending = studies?.filter(s => s.status === 'ordered' || s.status === 'in-progress').length

  const kpis: KpiSpec[] = [
    { icon: <IconFlask size={14} stroke="var(--red)" />, iconBg: 'rgba(255,93,108,.14)', value: inbox.length, label: 'Unacked · Unit', valueStyle: inbox.length ? { color: 'var(--red)' } : undefined },
    { icon: <IconAlertTriangle size={14} stroke="var(--amber)" />, iconBg: 'rgba(255,180,84,.14)', value: draws ? criticalCount : '—', label: 'Critical · Patient' },
    {
      icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--violet)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="5" width="18" height="14" rx="2" /><circle cx="9" cy="11" r="2.2" /><path d="M21 15l-4.5-4.5L9 18" /></svg>,
      iconBg: 'rgba(167,139,250,.15)', value: imagingPending ?? '—', label: 'Imaging Pending',
    },
    {
      icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--cyan)" strokeWidth="2" strokeLinecap="round"><path d="M12 3v8m0 0c-3 0-5 2-5 5s2 5 5 5 5-2 5-5-2-5-5-5z" /></svg>,
      iconBg: 'rgba(53,224,208,.13)', value: draws ? latestByPanel.size : '—', label: 'Panels on File',
    },
  ]

  const inboxCountFor = (pid: string) => inbox.filter(i => i.patientId === pid).length

  return (
    <div className="app-frame li">
      <AppHeader
        subtitle="Laboratory & Imaging"
        kpis={kpis}
        bellCount={inbox.length}
        onBellClick={() => showToast('Results inbox', `${inbox.length} unacknowledged result(s) across the unit`)}
        user={role === 'nurse'
          ? { initials: 'MC', name: 'RN Maya Chen', role: 'ICU Nurse · view only' }
          : { initials: 'SR', name: 'Dr. Sara Rahman', role: 'Intensivist · results sign-off' }}
      />
      <div className="shell">
        <NavSidebar
          active="labs"
          alertCount={5}
          dashboardRoute={role === 'nurse' ? '/nurse' : '/workspace'}
          footerLines={role === 'nurse' ? ['Role: Nurse', 'View results only'] : ['Role: Physician', 'Acknowledge results']}
        />

        <aside className="ptrail" aria-label="Patients">
          <div className="ptrailhead">Patients</div>
          <div className="ptraillist">
            {patients?.map(p => (
              <button
                key={p.patientId}
                className={`ptrailcard${p.patientId === patientId ? ' sel' : ''}`}
                aria-current={p.patientId === patientId ? 'page' : undefined}
                onClick={() => navigate(`/labs/${p.patientId}${location.search}`)}
              >
                <BedChip bedId={p.bedId} />
                <span className="prname">{p.name}</span>
                {inboxCountFor(p.patientId) > 0 && <span className="prpend num">{inboxCountFor(p.patientId)}</span>}
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
              {!canAcknowledgeResults(role) && <span className="ptbarviewonly">View only — nurse session</span>}
              <button className="ptbarlink" onClick={() => navigate(`/patients/${patient.patientId}`)}>
                Open Mission Control →
              </button>
            </div>
          )}

          {patient && draws && studies && (
            <div className="licols">
              <div className="licolL">
                <LabTrendsCard draws={draws} />
              </div>
              <div className="licolR">
                <ResultInboxCard items={patientInbox} role={role} onAcknowledge={ackInboxItem} />
                <ImagingCard studies={studies} role={role} onAcknowledge={ackImaging} />
              </div>
            </div>
          )}
        </main>
      </div>
      <Toast state={toast} accent="green" />
    </div>
  )
}

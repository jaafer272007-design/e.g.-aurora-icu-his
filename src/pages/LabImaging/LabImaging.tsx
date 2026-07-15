import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import './LabImaging.css'
import { AppHeader, type KpiSpec } from '../../components/AppHeader'
import { NavSidebar } from '../../components/NavSidebar'
import { NotFoundCard } from '../../components/NotFoundCard'
import { PatientBar } from '../../components/PatientBar'
import { PatientRail } from '../../components/PatientRail'
import { Toast, useToast } from '../../components/Toast'
import { IconAlertTriangle, IconFlask } from '../../components/icons'
import {
  acknowledgeImaging, acknowledgeLab, getImagingStudies, getLabDraws, getPatientDetail,
  getPatients, getResultInbox, unacknowledgeImaging, unacknowledgeLab,
} from '../../lib/api'
import { defaultPatientId, useRememberPatient } from '../../lib/patientContext'
import { getSession, hasPermission, initialsOf, profileOf } from '../../lib/session'
import type {
  ImagingStudy, LabDraw, Patient, PatientSummary, ResultInboxItem,
} from '../../lib/api/types'
import { LabTrendsCard } from './LabTrendsCard'
import { CustomResultsCard } from './CustomResultsCard'
import { ImagingCard } from './ImagingCard'
import { ResultInboxCard } from './ResultInboxCard'

/** Screen 6 — Laboratory & Imaging. THE canonical record of lab and imaging
 *  RESULTS (Screen 5 places the orders). Doctor RBAC acknowledges; nurses
 *  view only. Result ages are computed at render via the shared clock. */
export function LabImaging() {
  const { patientId = '' } = useParams()
  const navigate = useNavigate()
  const { toast, showToast } = useToast()
  /* Stage 9 session: acknowledge requires results.acknowledge — enforced in
     the service layer, mirrored here for the UI */
  const session = getSession()!
  const canAck = hasPermission(session.jobTitle, 'results.acknowledge')

  const [patients, setPatients] = useState<PatientSummary[] | null>(null)
  const [patient, setPatient] = useState<Patient | null>(null)
  const [missing, setMissing] = useState(false)
  const [draws, setDraws] = useState<LabDraw[] | null>(null)
  const [studies, setStudies] = useState<ImagingStudy[] | null>(null)
  const [inbox, setInbox] = useState<ResultInboxItem[]>([])

  useEffect(() => { getPatients().then(setPatients) }, [])

  useEffect(() => {
    if (!patientId && patients?.length) navigate(`/labs/${defaultPatientId(patients)}`, { replace: true })
  }, [patientId, patients, navigate])
  /* record the viewed patient as the cross-section context (only once
     this screen's own list confirms the id resolves) */
  useRememberPatient(patientId, patients)

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
    acknowledgeLab(labId, session.name, session.jobTitle).then(ok => {
      if (!ok) { showToast('Not permitted', 'Acknowledgement requires physician role'); return }
      refresh()
      showToast('Result acknowledged', `${ok.panel} panel · ${ok.patientName}`)
    })
  }

  const ackImaging = (studyId: string) => {
    acknowledgeImaging(studyId, session.name, session.jobTitle).then(ok => {
      if (!ok) { showToast('Not permitted', 'Acknowledgement requires physician role'); return }
      refresh()
      showToast('Study acknowledged', `${ok.description} · ${ok.patientName}`)
    })
  }

  const ackInboxItem = (item: ResultInboxItem) => {
    if (item.kind === 'lab') ackLab(item.id)
    else ackImaging(item.id)
  }

  /* reverse an acknowledgment (results audit PR) — required reason is
     collected by the card's dialog; the server preserves the original
     acknowledgment in the audit history and the study re-enters the inbox */
  const unackImaging = (studyId: string, reason: string) => {
    unacknowledgeImaging(studyId, reason, session.jobTitle).then(ok => {
      if (!ok) { showToast('Not permitted', 'Reversal requires physician role'); return }
      refresh()
      showToast('Acknowledgment reversed', `${ok.description} · returned to the results inbox`)
    })
  }

  /* same reversal for a lab result — used by the custom-results card (the
     existing lab unacknowledge endpoint; nothing custom-specific server-side) */
  const unackLab = (labId: string, reason: string) => {
    unacknowledgeLab(labId, reason, session.jobTitle).then(ok => {
      if (!ok) { showToast('Not permitted', 'Reversal requires physician role'); return }
      refresh()
      showToast('Acknowledgment reversed', `${ok.label} · returned to the results inbox`)
    })
  }

  /* display fix (bug 1): custom results are excluded from the numeric trends
     chart (unstructured) and the inbox lists only UNACKNOWLEDGED results, so
     an acknowledged custom result previously had NO home on this screen and
     appeared to vanish. They live in their own card below — visible in both
     states, incl. who acknowledged. */
  const customDraws = draws?.filter(d => d.custom) ?? []

  const patientInbox = inbox.filter(i => i.patientId === patientId)
  const latestByPanel = new Map<string, LabDraw>()
  draws?.forEach(d => latestByPanel.set(d.panel, d))
  const criticalCount =
    [...latestByPanel.values()].filter(d => d.flag === 'critical').length +
    (studies?.filter(s => s.flag === 'critical' && (s.status === 'preliminary' || s.status === 'final')).length ?? 0)
  const imagingPending = studies?.filter(s => s.status === 'ordered' || s.status === 'in-progress').length

  const kpis: KpiSpec[] = [
    { icon: <IconFlask size={14} stroke="var(--red)" />, iconBg: 'rgba(var(--red-rgb),.14)', value: inbox.length, label: 'Unacked · Unit', valueStyle: inbox.length ? { color: 'var(--red)' } : undefined },
    { icon: <IconAlertTriangle size={14} stroke="var(--amber)" />, iconBg: 'rgba(var(--amber-rgb),.14)', value: draws ? criticalCount : '—', label: 'Critical · Patient' },
    {
      icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--violet)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="5" width="18" height="14" rx="2" /><circle cx="9" cy="11" r="2.2" /><path d="M21 15l-4.5-4.5L9 18" /></svg>,
      iconBg: 'rgba(var(--violet-rgb),.15)', value: imagingPending ?? '—', label: 'Imaging Pending',
    },
    {
      icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--cyan)" strokeWidth="2" strokeLinecap="round"><path d="M12 3v8m0 0c-3 0-5 2-5 5s2 5 5 5 5-2 5-5-2-5-5-5z" /></svg>,
      iconBg: 'rgba(var(--cyan-rgb),.13)', value: draws ? latestByPanel.size : '—', label: 'Panels on File',
    },
  ]

  const inboxCountFor = (pid: string) => inbox.filter(i => i.patientId === pid).length

  return (
    <div className="app-frame li">
      <AppHeader
        subtitle="Laboratory & Imaging"
        kpis={kpis}
        user={{ initials: initialsOf(session.name), name: session.name, role: `${session.jobTitle} · ${profileOf(session.jobTitle)} profile` }}
      />
      <div className="shell">
        <NavSidebar
          active="labs"
          alertCount={5}
          footerLines={[`Role: ${profileOf(session.jobTitle)} profile`, canAck ? 'Acknowledge results' : 'View results only']}
        />

        <PatientRail
          patients={patients}
          selectedId={patientId}
          onSelect={id => navigate(`/labs/${id}`)}
          badge={p => (inboxCountFor(p.patientId) > 0 ? <span className="prpend num">{inboxCountFor(p.patientId)}</span> : null)}
        />

        <main>
          {missing && <NotFoundCard />}

          {patient && (
            <PatientBar patient={patient} links={[{ label: 'Open Mission Control →', to: `/patients/${patient.patientId}` }]}>
              <span className="ptbardx">{patient.diagnosis}</span>
              {!canAck && <span className="ptbarviewonly">View only — no acknowledge authority</span>}
            </PatientBar>
          )}

          {patient && draws && studies && (
            <div className="licols">
              <div className="licolL">
                <LabTrendsCard draws={draws} />
                {customDraws.length > 0 && (
                  <CustomResultsCard
                    draws={customDraws}
                    canAcknowledge={canAck}
                    onAcknowledge={ackLab}
                    onUnacknowledge={unackLab}
                  />
                )}
              </div>
              <div className="licolR">
                <ResultInboxCard items={patientInbox} canAcknowledge={canAck} onAcknowledge={ackInboxItem} />
                <ImagingCard studies={studies} canAcknowledge={canAck} onAcknowledge={ackImaging} onUnacknowledge={unackImaging} />
              </div>
            </div>
          )}
        </main>
      </div>
      <Toast state={toast} accent="green" />
    </div>
  )
}

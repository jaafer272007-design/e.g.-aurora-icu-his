import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import './PatientHistory.css'
import { AppHeader } from '../../components/AppHeader'
import { NavSidebar } from '../../components/NavSidebar'
import { NotFoundCard } from '../../components/NotFoundCard'
import { Card } from '../../components/Card'
import { IconClock } from '../../components/icons'
import {
  dispositionLabel as vocabDispositionLabel, getDispositions, getEncounters,
  getImagingStudies, getLabDraws, getPatientIdentity, getPatientOrders, isDeathDisposition,
} from '../../lib/api'
import { getSession, hasPermission, initialsOf } from '../../lib/session'
import type { Encounter, ImagingStudy, LabDraw, Order, PatientIdentity } from '../../lib/api/types'
import { displayStamp } from '../../lib/time'

/* PATIENT HISTORY OVERVIEW (match+overview design §5) — the clinicians'
 * view of everything Aurora holds on ONE PERSON across admissions. A
 * PAGE, not a modal (locked decision 5): reachable from the match dialog
 * AND from the patient chart — the recommended "both".
 * REAL DATA ONLY, and the OMISSION rule (locked decision 3): domains
 * Aurora does not track (department, chronic problems, surgical history)
 * are OMITTED ENTIRELY, never rendered as "not tracked" — in a clinical
 * history an empty section reads as clinical absence. Domains Aurora DOES
 * track render honest zero states when empty. The SCOPE STATEMENT (§5.3)
 * is required: because the page omits what it doesn't hold, silence must
 * never imply completeness.
 * READ-ONLY (§5.5): closed encounters stay terminal — the only action is
 * "Admit as New Encounter" (a NEW encounter on the SAME patient), and
 * only when the patient is neither currently admitted nor deceased.
 * RBAC: the route is gated on results.view — held by every clinical
 * profile and by NEITHER administrator profile (the locked rule: the
 * office Administrator never sees clinical data). The medications
 * section additionally renders only for orders.view holders. */

/* labels resolve through the MANAGED vocabulary (retired entries keep
   resolving on historical stays; unknown codes render verbatim) */
const dispositionLabel = (code: string | null | undefined) =>
  code ? vocabDispositionLabel(code) : null

const encSeq = (id: string) => {
  const n = Number(id.startsWith('ENC-') ? id.slice(4) : NaN)
  return Number.isFinite(n) ? n : 0
}

/** most-recent-first, first occurrence per key, capped — the DERIVED
 *  "last important results" rule (flagged choice, stated): most recent
 *  per analyte / per modality, never a curated clinical list (a baked-in
 *  list rots and embeds clinical judgment in code). */
function latestPer<T>(rows: T[], keyOf: (r: T) => string, cap: number): T[] {
  const seen = new Set<string>()
  const out: T[] = []
  for (let i = rows.length - 1; i >= 0 && out.length < cap; i--) {
    const k = keyOf(rows[i])
    if (!k || seen.has(k)) continue
    seen.add(k)
    out.push(rows[i])
  }
  return out
}

export function PatientHistory() {
  const { patientId = '' } = useParams()
  const navigate = useNavigate()
  const session = getSession()!
  const canAdmit = hasPermission(session.jobTitle, 'adt.admit')
  const canMeds = hasPermission(session.jobTitle, 'orders.view')

  const [pid, setPid] = useState<PatientIdentity | null>(null)
  const [missing, setMissing] = useState(false)
  const [encounters, setEncounters] = useState<Encounter[] | null>(null)
  const [orders, setOrders] = useState<Order[] | null>(null)
  const [draws, setDraws] = useState<LabDraw[] | null>(null)
  const [studies, setStudies] = useState<ImagingStudy[] | null>(null)

  useEffect(() => {
    let stale = false
    setPid(null); setMissing(false); setEncounters(null); setOrders(null); setDraws(null); setStudies(null)
    if (!patientId) return
    /* primes dispositionLabel/isDeathDisposition for the stays list */
    getDispositions().catch(() => {})
    /* identity is the anchor — REAL-ONLY read; an unknown id is an
       explicit not-found, never another patient's data */
    getPatientIdentity(patientId).then(r => {
      if (stale) return
      if (!r) { setMissing(true); return }
      setPid(r)
    })
    getEncounters({ patientId }).then(r => { if (!stale) setEncounters(r) })
    if (canMeds) getPatientOrders(patientId).then(r => { if (!stale) setOrders(r) })
    getLabDraws(patientId).then(r => { if (!stale) setDraws(r) })
    getImagingStudies(patientId).then(r => { if (!stale) setStudies(r) })
    return () => { stale = true }
  }, [patientId, canMeds])

  const encRows = useMemo(() =>
    [...(encounters ?? [])].sort((a, b) => encSeq(b.encounterId) - encSeq(a.encounterId)),
    [encounters])
  const openEnc = encRows.find(e => e.status === 'open')
  const latestEnc = encRows[0]
  /* DECEASED keys on the vocabulary's immutable isDeath attribute —
     never the label; a hospital-added death disposition counts */
  const deceased = !openEnc && isDeathDisposition(latestEnc?.disposition)

  /* previous medications — most recent order per drug (derived, capped) */
  const meds = useMemo(() =>
    latestPer((orders ?? []).filter(o => o.category === 'Medication' && o.medication),
      o => o.medication!.drug, 10),
    [orders])
  /* previous labs — most recent result per ANALYTE (derived, capped);
     draws arrive oldest-first, so reverse-first-seen = most recent */
  const labs = useMemo(() => {
    const flat: { analyte: string; value: number; unit: string; flag: string; time: string }[] = []
    for (const d of draws ?? [])
      for (const it of d.items ?? [])
        flat.push({ analyte: it.analyte, value: it.value, unit: it.unit, flag: it.flag, time: d.resultedAt })
    return latestPer(flat, r => r.analyte, 12)
  }, [draws])
  /* previous imaging — most recent study per MODALITY (derived, capped) */
  const imaging = useMemo(() =>
    latestPer((studies ?? []).filter(s => s.status !== 'ordered'), s => s.modality, 8),
    [studies])

  const user = { initials: initialsOf(session.name), name: session.name, role: session.jobTitle }

  if (missing) {
    return (
      <div className="app-frame ph">
        <AppHeader subtitle="Patient History · Aurora ICU records" kpis={[]} user={user} />
        <div className="shell">
          <NavSidebar active="beds" footerLines={['Patient history', 'Aurora ICU records only']} />
          <main><NotFoundCard /></main>
        </div>
      </div>
    )
  }

  return (
    <div className="app-frame ph">
      <AppHeader
        subtitle="Patient History · Aurora ICU records"
        kpis={[{
          icon: <IconClock />, iconBg: 'rgba(var(--cyan-rgb),.16)',
          value: encRows.length, label: 'Aurora admissions',
        }]}
        user={user}
      />
      <div className="shell">
        <NavSidebar active="beds" footerLines={['Patient history', 'Aurora ICU records only']} />
        <main>
          {/* THE SCOPE STATEMENT (§5.3, required): the page omits what it
              doesn't hold, so silence must never imply completeness */}
          <div className="phscope" role="note">
            <b>Aurora ICU records only.</b> This page shows the encounters, allergies, medications,
            labs and imaging recorded in Aurora — it is <b>not</b> the patient&apos;s complete medical
            history. Aurora holds no external, pre-Aurora or non-ICU records.
          </div>

          <Card
            title={pid ? (pid.fullName ?? pid.name) : 'Loading…'}
            aside={pid ? `${pid.patientId} · ${pid.mrn}` : ''}
          >
            {pid && (
              <div className="phid">
                <span>{pid.sex === 'M' ? 'Male' : 'Female'} · {pid.age} y
                  {pid.ageSource === 'recordedAtAdmission' && <i> (age estimated at admission)</i>}</span>
                {pid.nationalId
                  ? <span className="num">National ID {pid.nationalId}</span>
                  : <span className="phmuted">no national ID recorded</span>}
                {pid.fileNumber
                  ? <span className="num">File no. {pid.fileNumber}</span>
                  : <span className="phmuted">no file number recorded</span>}
                {encounters !== null && deceased && <span className="phdead">Deceased</span>}
                {encounters !== null && openEnc && <span className="phadm">Currently admitted · Bed {openEnc.bedId}</span>}
              </div>
            )}
            <div className="phactions">
              <button className="btn ghost" onClick={() => navigate(`/patients/${patientId}`)}>Open patient chart</button>
              {/* read-only page — the ONLY action creates a NEW encounter
                  on the SAME patient, and never for the admitted or the
                  deceased (the dialog's guards, mirrored). It renders
                  only once the ENCOUNTERS have loaded: the guards derive
                  from them, and a guard evaluated against a still-loading
                  list is no guard (adversarial-review finding). */}
              {canAdmit && encounters !== null && !openEnc && !deceased && pid && (
                <button className="btn primary" onClick={() => navigate(`/admissions?readmit=${encodeURIComponent(patientId)}`)}>
                  ➜ Admit as New Encounter
                </button>
              )}
            </div>
          </Card>

          <Card title="Previous Encounters" aside={`${encRows.length} in Aurora`}>
            {encounters === null ? <div className="phempty">Loading…</div>
              : encRows.length === 0 && <div className="phempty">No encounters recorded in Aurora.</div>}
            {encRows.map(e => (
              <div className="phrow" key={e.encounterId}>
                <span className="num phwhen">{e.admittedAt ? displayStamp(e.admittedAt) : '—'}</span>
                <span className="phdiag">{e.diagnosis}</span>
                <span className="phout">
                  {e.status === 'open'
                    ? <b className="phopen">in progress — current admission</b>
                    : (dispositionLabel(e.disposition) ??
                       /* pre-#96 encounters honestly read "not recorded" */
                       <i className="phmuted">outcome not recorded</i>)}
                </span>
              </div>
            ))}
          </Card>

          <Card title="Allergies" aside="person-level — blocks orders">
            <div className="phallergy">{pid ? (pid.allergies || 'None documented') : '…'}</div>
          </Card>

          {/* medications render for orders.view holders only — the same
              content-by-permission split as everywhere else */}
          {canMeds && (
            <Card title="Previous Medications" aside="most recent order per drug">
              {orders === null ? <div className="phempty">Loading…</div>
                : meds.length === 0 && <div className="phempty">No medication orders recorded in Aurora.</div>}
              {meds.map(o => (
                <div className="phrow" key={o.orderId}>
                  <span className="phdrug">{o.medication!.drug}</span>
                  <span>{o.medication!.dose} · {o.medication!.route} · {o.medication!.frequency}</span>
                  <span className="phmuted">{o.status} · <span className="num">{o.orderedTime}</span></span>
                </div>
              ))}
            </Card>
          )}

          <Card title="Previous Labs" aside="most recent result per analyte">
            {draws === null ? <div className="phempty">Loading…</div>
              : labs.length === 0 && <div className="phempty">No lab results recorded in Aurora.</div>}
            {labs.map(r => (
              <div className="phrow" key={r.analyte}>
                <span className="phdrug">{r.analyte}</span>
                <span className="num">{r.value} {r.unit}</span>
                <span className={`phflag ${r.flag}`}>{r.flag}</span>
                <span className="phmuted num">{r.time}</span>
              </div>
            ))}
          </Card>

          <Card title="Previous Imaging" aside="most recent study per modality">
            {studies === null ? <div className="phempty">Loading…</div>
              : imaging.length === 0 && <div className="phempty">No imaging recorded in Aurora.</div>}
            {imaging.map(s => (
              <div className="phrow" key={s.studyId}>
                <span className="phdrug">{s.modality}</span>
                <span>{s.description}</span>
                <span className="phmuted">{s.status}{s.impression ? ` — ${s.impression}` : ''}</span>
                <span className="phmuted num">{s.reportedAt ?? s.performedAt ?? s.orderedAt}</span>
              </div>
            ))}
          </Card>
          {/* Department / Chronic problems / Surgical history are OMITTED
              ENTIRELY, deliberately (locked decision 3 — recorded in 02):
              an empty clinical section reads as clinical absence. */}
        </main>
      </div>
    </div>
  )
}

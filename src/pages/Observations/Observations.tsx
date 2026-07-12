import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import './Observations.css'
import { AppHeader } from '../../components/AppHeader'
import { NavSidebar } from '../../components/NavSidebar'
import { Card } from '../../components/Card'
import { PatientRail } from '../../components/PatientRail'
import { NotFoundCard } from '../../components/NotFoundCard'
import {
  getObservations, getObservationTypes, getPatients, overrideObservation, recordObservations,
} from '../../lib/api'
import type { Observation, ObservationTypeDef, PatientSummary } from '../../lib/api/types'
import { getSession, hasPermission, initialsOf, profileOf } from '../../lib/session'

/** Observations (/observations/:patientId) — Stage 11 first half.
 *  MANUAL charting of bedside values (vitals, NIBP, hemodynamics,
 *  ventilator settings) by doctors and nurses, and the read-only chart of
 *  everything recorded. Strictly the locked one-way flow: this screen
 *  writes through the Observation service only — it never touches the
 *  bedside snapshot or panels (those remain Stage 11's device half). */

const nowUtcStamp = () => {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`
}

export function Observations() {
  const navigate = useNavigate()
  const { patientId = '' } = useParams()
  const session = getSession()!
  const canRecord = hasPermission(session.jobTitle, 'observations.record')

  const [patients, setPatients] = useState<PatientSummary[] | null>(null)
  const [types, setTypes] = useState<ObservationTypeDef[] | null>(null)
  const [rows, setRows] = useState<Observation[] | null | 'loading'>('loading')
  const [capturedAt, setCapturedAt] = useState(nowUtcStamp)
  const [values, setValues] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState('')
  const [formOk, setFormOk] = useState('')
  const [overriding, setOverriding] = useState<string | null>(null)
  const [ovValue, setOvValue] = useState('')
  const [ovReason, setOvReason] = useState('')

  useEffect(() => { getPatients().then(setPatients) }, [])
  useEffect(() => { getObservationTypes().then(setTypes) }, [])

  const reload = useCallback(() => {
    if (!patientId) return
    getObservations(patientId).then(list => setRows(list))
  }, [patientId])

  useEffect(() => {
    if (!patientId && patients?.length) navigate(`/observations/${patients[0].patientId}`, { replace: true })
  }, [patientId, patients, navigate])
  useEffect(() => { setRows('loading'); reload() }, [reload])

  const patient = patients?.find(p => p.patientId === patientId)
  const typeOf = useMemo(() => new Map((types ?? []).map(t => [t.type, t])), [types])
  const groups = useMemo(() => {
    const g = new Map<string, ObservationTypeDef[]>()
    for (const t of types ?? []) {
      if (!g.has(t.group)) g.set(t.group, [])
      g.get(t.group)!.push(t)
    }
    return [...g.entries()]
  }, [types])

  const submitSet = async () => {
    setFormError(''); setFormOk('')
    const entries = Object.entries(values)
      .map(([type, value]) => ({ type, value: value.trim() }))
      .filter(e => e.value !== '')
    if (entries.length === 0) { setFormError('Enter at least one value to chart.'); return }
    const res = await recordObservations({ patientId, capturedAt: capturedAt.trim(), entries })
    if (res.kind === 'ok') {
      setValues({}); setCapturedAt(nowUtcStamp())
      setFormOk(`${res.data.length} observation${res.data.length === 1 ? '' : 's'} charted.`)
      reload()
    } else {
      setFormError(res.kind === 'rejected' ? res.error : 'Charting requires the live API — no observation was recorded.')
    }
  }

  const submitOverride = async (id: string) => {
    setFormError(''); setFormOk('')
    const res = await overrideObservation(id, ovValue.trim(), ovReason.trim())
    if (res.kind === 'ok') {
      setOverriding(null); setOvValue(''); setOvReason('')
      setFormOk('Observation corrected — the original value is preserved on the record.')
      reload()
    } else {
      setFormError(res.kind === 'rejected' ? res.error : 'Corrections require the live API.')
    }
  }

  const chart = rows !== 'loading' && rows !== null ? rows.slice().reverse() : []

  return (
    <div className="app-frame obs">
      <AppHeader
        subtitle="Observations"
        kpis={[]}
        user={{ initials: initialsOf(session.name), name: session.name, role: `${session.jobTitle} · ${profileOf(session.jobTitle)} profile` }}
      />
      <div className="shell">
        <NavSidebar active="observations" footerLines={['Observations', 'Manual bedside charting (Stage 11)']} />
        <main className="obs-body">
          <PatientRail
            patients={patients}
            selectedId={patientId}
            onSelect={id => navigate(`/observations/${id}`)}
            title="Patients"
          />
          {patients && patientId && !patient && <NotFoundCard />}
          {patient && (
            <div className="obs-main">
              {canRecord && (
                <Card className="obs-entry" title={`Chart bedside values — ${patient.name}`}>
                  <div className="obs-when">
                    <label htmlFor="obs-capturedat">Measured at (UTC)</label>
                    <input
                      id="obs-capturedat"
                      value={capturedAt}
                      onChange={e => setCapturedAt(e.target.value)}
                      placeholder="yyyy-MM-dd HH:mm"
                      aria-label="Measured at (UTC, yyyy-MM-dd HH:mm)"
                    />
                    <span className="obs-hint">Charting may lag the measurement — record when it was MEASURED.</span>
                  </div>
                  {types === null && <p className="obs-empty">The observation vocabulary requires the live API.</p>}
                  <div className="obs-groups">
                    {groups.map(([group, defs]) => (
                      <fieldset key={group} className="obs-group">
                        <legend>{group}</legend>
                        {defs.map(t => (
                          <div key={t.type} className="obs-field">
                            <label htmlFor={`obs-${t.type}`}>{t.label}{t.unit ? ` (${t.unit})` : ''}</label>
                            {t.kind === 'choice' ? (
                              <select
                                id={`obs-${t.type}`}
                                value={values[t.type] ?? ''}
                                onChange={e => setValues(v => ({ ...v, [t.type]: e.target.value }))}
                              >
                                <option value="">— not charted —</option>
                                {t.choices!.map(c => <option key={c} value={c}>{c}</option>)}
                              </select>
                            ) : (
                              <input
                                id={`obs-${t.type}`}
                                inputMode="decimal"
                                value={values[t.type] ?? ''}
                                onChange={e => setValues(v => ({ ...v, [t.type]: e.target.value }))}
                                placeholder="—"
                              />
                            )}
                          </div>
                        ))}
                      </fieldset>
                    ))}
                  </div>
                  {formError && <p className="obs-error" role="alert">{formError}</p>}
                  {formOk && <p className="obs-ok" role="status">{formOk}</p>}
                  <button className="obs-submit" onClick={submitSet} disabled={types === null}>
                    Chart observations
                  </button>
                  <p className="obs-note">
                    Values are recorded as MANUAL observations under your name, against the
                    patient&apos;s open encounter. A mis-charted value is corrected by an
                    override with a reason — the original is never erased.
                  </p>
                </Card>
              )}
              <Card className="obs-chart" title="Observation chart">
                {rows === 'loading' && <p className="obs-empty">Loading…</p>}
                {rows === null && <p className="obs-empty">Observations require the live API — nothing is fabricated.</p>}
                {rows !== 'loading' && rows !== null && chart.length === 0 &&
                  <p className="obs-empty">No observations recorded for this patient yet.</p>}
                {chart.length > 0 && (
                  <table className="obs-table">
                    <thead>
                      <tr>
                        <th>Measured (UTC)</th><th>Observation</th><th>Value</th>
                        <th>Source</th><th>Recorded by</th><th aria-label="Actions" />
                      </tr>
                    </thead>
                    <tbody>
                      {chart.map(o => (
                        <tr key={o.observationId}>
                          <td className="obs-mono">{o.capturedAt}</td>
                          <td>{typeOf.get(o.type)?.label ?? o.type}</td>
                          <td className="obs-mono">
                            {o.isOverridden ? (
                              <>
                                <s aria-label="original value, corrected">{o.value}{o.unit ? ` ${o.unit}` : ''}</s>{' '}
                                <strong>{o.overrideValue}{o.unit ? ` ${o.unit}` : ''}</strong>
                                <span className="obs-ovreason"> — corrected: {o.overrideReason}</span>
                              </>
                            ) : (
                              <>{o.value}{o.unit ? ` ${o.unit}` : ''}</>
                            )}
                          </td>
                          <td><span className={`obs-src obs-src-${o.source}`}>{o.source}</span></td>
                          <td>{o.recordedBy}</td>
                          <td>
                            {canRecord && !o.isOverridden && overriding !== o.observationId && (
                              <button className="obs-linkbtn" onClick={() => { setOverriding(o.observationId); setOvValue(''); setOvReason('') }}>
                                Correct…
                              </button>
                            )}
                            {overriding === o.observationId && (
                              <span className="obs-ovform">
                                <input
                                  value={ovValue}
                                  onChange={e => setOvValue(e.target.value)}
                                  placeholder="corrected value"
                                  aria-label="Corrected value"
                                />
                                <input
                                  value={ovReason}
                                  onChange={e => setOvReason(e.target.value)}
                                  placeholder="reason (required)"
                                  aria-label="Correction reason"
                                />
                                <button className="obs-linkbtn" onClick={() => submitOverride(o.observationId)}>Save</button>
                                <button className="obs-linkbtn" onClick={() => setOverriding(null)}>Cancel</button>
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                <p className="obs-note">
                  Newest first. Manual entries carry <code>source: manual</code>; device-sourced
                  values arrive through the same model when device integration lands (Stage 11
                  second half) — no display change needed.
                </p>
              </Card>
            </div>
          )}
        </main>
      </div>
    </div>
  )
}

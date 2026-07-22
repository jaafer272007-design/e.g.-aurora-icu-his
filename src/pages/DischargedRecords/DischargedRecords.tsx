import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import './DischargedRecords.css'
import { AppHeader } from '../../components/AppHeader'
import { NavSidebar } from '../../components/NavSidebar'
import { Card } from '../../components/Card'
import { IconDischarge, IconSearch } from '../../components/icons'
import { searchPatients } from '../../lib/api'
import type { MatchCard, PatientSearchResponse } from '../../lib/api/types'
import { getSession, initialsOf, profileOf } from '../../lib/session'
import { displayStamp } from '../../lib/time'

/** Discharged Patients — records retrieval (/discharged). The fix for the
 *  go-live gap: "Recently Discharged" only showed the newest 12 and its
 *  rows were dead — no discharged patient beyond the recent handful was
 *  reachable. This view lists + searches ALL discharged patients (partial
 *  match by name / MRN / file number / national ID via the real
 *  /adt/patients/search endpoint) and opens any of them at
 *  /patients/:id/history — the record view that loads discharged patients
 *  (patient-scoped reads), NOT Mission Control (roster-scoped, 404s them).
 *
 *  RBAC: the route is results.view-gated (clinical history — the office
 *  Administrator is locked out of clinical data); the search endpoint is
 *  patients.view (identity-class, national ID masked to last-4). REAL-ONLY:
 *  retrieval reads the durable record, never a mock — an unreachable
 *  server renders the honest offline state, never a fabricated list. */
export function DischargedRecords() {
  const navigate = useNavigate()
  const session = getSession()!
  const [query, setQuery] = useState('')
  const [resp, setResp] = useState<PatientSearchResponse | null>(null)
  const [loaded, setLoaded] = useState(false)
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null)

  const run = useCallback((q: string) => {
    void searchPatients(q, 'discharged', 100).then(r => { setResp(r); setLoaded(true) })
  }, [])

  /* initial browse (empty q = all discharged, newest first) */
  useEffect(() => { run('') }, [run])

  /* debounced live search as the clinician types */
  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current)
    debounce.current = setTimeout(() => run(query), 200)
    return () => { if (debounce.current) clearTimeout(debounce.current) }
  }, [query, run])

  const results: MatchCard[] = resp?.results ?? []
  const offline = loaded && resp === null

  const statusChip = (s: MatchCard['status']) =>
    s === 'deceased' ? <i className="drchip dead">Deceased</i> : <i className="drchip">Discharged</i>

  const subtitleCount = useMemo(() => {
    if (!resp) return '—'
    return resp.truncated ? `showing ${results.length} of ${resp.total} — refine your search` : `${resp.total}`
  }, [resp, results.length])

  return (
    <div className="app-frame dr">
      <AppHeader
        subtitle="Discharged Patients · Records"
        kpis={[]}
        user={{ initials: initialsOf(session.name), name: session.name, role: `${session.jobTitle} · ${profileOf(session.jobTitle)} profile` }}
      />
      <div className="shell">
        <NavSidebar active="discharged" footerLines={['Discharged records · Aurora Core', 'Any past patient — searchable']} />

        <main>
          <div className="drnote" role="note">
            Every discharged patient&apos;s record is retained and retrievable here — search by name, MRN,
            file number, or national ID (partial is fine), then open their full clinical record. A
            discharged patient&apos;s data is never deleted; the encounter is only closed.
          </div>

          <Card icon={<IconDischarge size={15} stroke="var(--amber)" />} title="Discharged Patients" aside={subtitleCount}>
            <div className="drsearch">
              <IconSearch size={14} stroke="var(--faint)" />
              <input
                autoFocus
                placeholder="Search discharged patients — name, MRN, file number, national ID…"
                aria-label="Search discharged patients"
                value={query}
                onChange={e => setQuery(e.target.value)}
              />
            </div>

            {offline && (
              <p className="drempty">
                The live server is unreachable — discharged records are read from the durable database and
                cannot be listed offline.
              </p>
            )}
            {!offline && loaded && results.length === 0 && (
              <p className="drempty">
                {query.trim() ? `No discharged patient matches “${query.trim()}”.` : 'No discharged patients yet.'}
              </p>
            )}

            <div className="drrows" role="listbox" aria-label="Discharged patients">
              {results.map(p => (
                <button
                  key={p.patientId}
                  className="drrow"
                  role="option"
                  aria-selected={false}
                  onClick={() => navigate(`/patients/${p.patientId}/history`)}
                  aria-label={`Open record: ${p.fullName}`}
                >
                  <span className="drwho">
                    <b>{p.fullName}</b>
                    {statusChip(p.status)}
                  </span>
                  <span className="drids num">
                    {p.mrn}
                    {p.fileNumber ? ` · file ${p.fileNumber}` : ''}
                    {p.nationalIdLast4 ? ` · ID ••••${p.nationalIdLast4}` : ''}
                  </span>
                  <span className="drmeta">
                    <small>{p.age >= 0 ? `${p.age}y` : ''}{p.sex ? ` · ${p.sex}` : ''}</small>
                    <small className="num">
                      {p.lastDischargedAt ? `discharged ${displayStamp(p.lastDischargedAt)}` : 'discharge date not recorded'}
                      {p.admissionCount > 1 ? ` · ${p.admissionCount} encounters` : ''}
                    </small>
                  </span>
                  <span className="drgo" aria-hidden>Open record →</span>
                </button>
              ))}
            </div>
          </Card>
        </main>
      </div>
    </div>
  )
}

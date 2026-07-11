import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import './PrintCenter.css'
import { AppHeader } from '../../components/AppHeader'
import { NavSidebar } from '../../components/NavSidebar'
import { Card } from '../../components/Card'
import { getEncounters, getPatients } from '../../lib/api'
import type { Encounter, PatientSummary } from '../../lib/api/types'
import { getSession, initialsOf, profileOf } from '../../lib/session'
import { PRINT_TEMPLATES } from './registry'

/** Print Center hub (/print) — pick a patient, an encounter where the
 *  template allows historical ones, and a document. Strictly read-only:
 *  the only action leads to the printable document route. */
export function PrintCenter() {
  const navigate = useNavigate()
  const session = getSession()!
  const [patients, setPatients] = useState<PatientSummary[]>([])
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const [encounters, setEncounters] = useState<Encounter[]>([])
  const [encounterId, setEncounterId] = useState<string>('')

  useEffect(() => { getPatients().then(setPatients) }, [])
  useEffect(() => {
    if (!selected) return
    setEncounters([])
    setEncounterId('')
    getEncounters({ patientId: selected }).then(list => {
      setEncounters(list)
      const open = list.find(e => e.status === 'open')
      setEncounterId(open?.encounterId ?? list[list.length - 1]?.encounterId ?? '')
    })
  }, [selected])

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return patients
    return patients.filter(p =>
      p.name.toLowerCase().includes(q) || p.patientId.toLowerCase().includes(q) || p.mrn.toLowerCase().includes(q))
  }, [patients, query])

  const chosenEncounter = encounters.find(e => e.encounterId === encounterId)

  return (
    <div className="app-frame pc">
      <AppHeader
        subtitle="Print Center"
        kpis={[]}
        user={{ initials: initialsOf(session.name), name: session.name, role: `${session.jobTitle} · ${profileOf(session.jobTitle)} profile` }}
      />
      <div className="shell">
        <NavSidebar active="print" footerLines={['Print Center', 'Read-only document rendering']} />
        <main className="pc-body">
          <Card className="pc-col" title="1 · Patient">
            <input
              className="pc-search"
              placeholder="Search name, ID, MRN…"
              value={query}
              onChange={e => setQuery(e.target.value)}
              aria-label="Search patients"
            />
            <div className="pc-plist" role="listbox" aria-label="Patients">
              {shown.map(p => (
                <button
                  key={p.patientId}
                  className={`pc-prow${selected === p.patientId ? ' on' : ''}`}
                  role="option"
                  aria-selected={selected === p.patientId}
                  onClick={() => setSelected(p.patientId)}
                >
                  <span className="pc-pname">{p.name}</span>
                  <span className="pc-pmeta">{p.patientId} · {p.bedId} · {p.mrn}</span>
                </button>
              ))}
              {shown.length === 0 && <p className="pc-empty">No matching patients on the roster.</p>}
            </div>
          </Card>

          <Card className="pc-col" title="2 · Encounter">
            {!selected && <p className="pc-empty">Select a patient first.</p>}
            {selected && encounters.length === 0 && <p className="pc-empty">Loading encounters…</p>}
            {selected && encounters.length > 0 && (
              <div className="pc-elist">
                {encounters.map(e => (
                  <label key={e.encounterId} className={`pc-erow${encounterId === e.encounterId ? ' on' : ''}`}>
                    <input
                      type="radio"
                      name="encounter"
                      checked={encounterId === e.encounterId}
                      onChange={() => setEncounterId(e.encounterId)}
                    />
                    <span>
                      <strong>{e.encounterId}</strong> · {e.status}
                      <br /><span className="pc-pmeta">{e.diagnosis} · admitted {e.admittedAt || '—'}</span>
                    </span>
                  </label>
                ))}
              </div>
            )}
          </Card>

          <Card className="pc-col pc-templates" title="3 · Document">
            {PRINT_TEMPLATES.map(t => {
              const blocked = t.encounterScope === 'open' && chosenEncounter?.status === 'discharged'
              return (
                <div key={t.id} className="pc-trow">
                  <div>
                    <strong>{t.title}</strong>
                    <p className="pc-pmeta">{t.description}</p>
                    {blocked && <p className="pc-warn">Needs an open encounter — the selected one is discharged.</p>}
                  </div>
                  <button
                    className="pc-open"
                    disabled={!selected || blocked}
                    onClick={() => navigate(`/print/${t.id}/${selected}${encounterId ? `?enc=${encodeURIComponent(encounterId)}` : ''}`)}
                  >
                    Open
                  </button>
                </div>
              )
            })}
            <p className="pc-note">
              Documents render the clinical record as persisted — read-only, printed through the
              browser (print / save as PDF). Ten further templates arrive in later phases on this
              same foundation.
            </p>
          </Card>
        </main>
      </div>
    </div>
  )
}

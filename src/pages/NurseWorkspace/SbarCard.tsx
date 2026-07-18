import { useState } from 'react'
import { Card } from '../../components/Card'
import { IconNote } from '../../components/icons'
import type { AssignedPatient, HandoffEntry } from '../../lib/api/types'

export interface SbarNote {
  s: string
  b: string
  a: string
  r: string
}

const EMPTY: SbarNote = { s: '', b: '', a: '', r: '' }

const FIELDS: { key: keyof SbarNote; label: string; placeholder: string }[] = [
  { key: 's', label: 'S — Situation', placeholder: 'Current status, active problems right now…' },
  { key: 'b', label: 'B — Background', placeholder: 'Admission reason, relevant history, devices/lines…' },
  { key: 'a', label: 'A — Assessment', placeholder: 'Your read: trends, response to therapy, concerns…' },
  { key: 'r', label: 'R — Recommendation', placeholder: 'What the next shift must watch / do / chase…' },
]

interface SbarCardProps {
  patients: AssignedPatient[]
  /** series per patient: undefined = loading, null = the server is
   *  unreachable (honest — no mock series exists) */
  entriesByPatient: Record<string, HandoffEntry[] | null | undefined>
  busy: boolean
  onSelect: (patientId: string) => void
  /** true when the server confirmed the entry — the draft clears then,
   *  and only then (the old fixture cleared nothing and saved nothing) */
  onSave: (patientId: string, note: SbarNote) => Promise<boolean>
}

/** Shift handoff — the append-only SBAR series per admission (owner's
 *  2026-07-18 model). Every save is a NEW immutable entry; the list
 *  below the form IS the record, newest first. Writes are gated
 *  server-side to the ASSIGNED nursing team on the open encounter. */
export function SbarCard({ patients, entriesByPatient, busy, onSelect, onSave }: SbarCardProps) {
  const [patientId, setPatientId] = useState(patients[0]?.patientId ?? '')
  const pid = patientId || patients[0]?.patientId
  const [draft, setDraft] = useState<SbarNote>(EMPTY)

  const switchPatient = (id: string) => {
    setPatientId(id)
    setDraft(EMPTY)
    onSelect(id)
  }

  const entries = entriesByPatient[pid]
  const canSave = !busy && Object.values(draft).some(v => v.trim() !== '')

  const save = async () => {
    if (await onSave(pid, draft)) setDraft(EMPTY)
  }

  return (
    <Card
      icon={<IconNote size={15} stroke="var(--violet)" />}
      title="Shift Handoff · SBAR"
      aside={entries ? `${entries.length} ${entries.length === 1 ? 'entry' : 'entries'} this admission` : undefined}
    >
      <div className="field">
        <label htmlFor="sbarPatient">Patient</label>
        <select id="sbarPatient" value={pid} onChange={e => switchPatient(e.target.value)}>
          {patients.map(p => <option key={p.patientId} value={p.patientId}>{p.name} — {p.bedId}</option>)}
        </select>
      </div>
      {FIELDS.map(f => (
        <div className="field" key={f.key}>
          <label htmlFor={`sbar-${f.key}`}>{f.label}</label>
          <textarea
            id={`sbar-${f.key}`}
            className="sbarta"
            placeholder={f.placeholder}
            value={draft[f.key]}
            disabled={busy}
            onChange={e => setDraft(d => ({ ...d, [f.key]: e.target.value }))}
          />
        </div>
      ))}
      <button className="btn primary sbarsave" disabled={!canSave} onClick={() => void save()}>
        {busy ? 'Recording…' : 'Record Handoff Entry'}
      </button>
      <p className="sbarrule">
        Written by the nursing team assigned to this patient. Each save adds a new entry to this
        admission's permanent record — entries are never edited or removed; a correction is the
        next entry.
      </p>

      {entries === undefined && <p className="sbarwait">loading the handoff record…</p>}
      {entries === null && (
        <p className="sbarunavail">The handoff record is not reachable in this session — no substitute entries are shown.</p>
      )}
      {entries && entries.length === 0 && (
        <p className="sbarempty">No handoff recorded for this admission yet.</p>
      )}
      {entries && entries.length > 0 && (
        <div className="sbarlist" role="list" aria-label="Handoff entries, newest first">
          {entries.map(e => (
            <div className="sbarentry" role="listitem" key={e.handoffId}>
              <div className="sbarmeta">
                <b>{e.recordedBy}</b>
                <span>{e.recordedRole}</span>
                <i className="num">{e.recordedAt || 'time not recorded'}</i>
                <i className="num sbarid">{e.handoffId}</i>
              </div>
              {([['S', e.s], ['B', e.b], ['A', e.a], ['R', e.r]] as const)
                .filter(([, v]) => v !== '')
                .map(([k, v]) => (
                  <p className="sbarline" key={k}><b>{k}</b>{v}</p>
                ))}
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}

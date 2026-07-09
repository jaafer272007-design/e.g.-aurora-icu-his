import { useState } from 'react'
import { Card } from '../../components/Card'
import { VitalTile } from '../../components/VitalTile'
import { IO_CATEGORIES } from '../../lib/api'
import type { AssignedPatient, IoEntry, IoKind } from '../../lib/api/types'

interface IoCardProps {
  entries: IoEntry[]
  patients: AssignedPatient[]
  onRecord: (patientId: string, kind: IoKind, category: string, volumeMl: number) => void
}

/** Intake & Output quick-entry with running shift totals per patient. */
export function IoCard({ entries, patients, onRecord }: IoCardProps) {
  const [patientId, setPatientId] = useState(patients[0]?.patientId ?? '')
  const [kind, setKind] = useState<IoKind>('intake')
  const [category, setCategory] = useState(IO_CATEGORIES.intake[0])
  const [volume, setVolume] = useState('')

  const pid = patientId || patients[0]?.patientId
  const totals = (id: string) => {
    const mine = entries.filter(e => e.patientId === id)
    const intake = mine.filter(e => e.kind === 'intake').reduce((s, e) => s + e.volumeMl, 0)
    const output = mine.filter(e => e.kind === 'output').reduce((s, e) => s + e.volumeMl, 0)
    return { intake, output, balance: intake - output }
  }

  const submit = () => {
    const ml = Math.round(Number(volume))
    if (!pid || !category || !Number.isFinite(ml) || ml <= 0) return
    onRecord(pid, kind, category, ml)
    setVolume('')
  }

  const setKindAndCategory = (k: IoKind) => {
    setKind(k)
    setCategory(IO_CATEGORIES[k][0])
  }

  return (
    <Card
      icon={<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--cyan)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2.7s6.5 7.6 6.5 12.3a6.5 6.5 0 11-13 0C5.5 10.3 12 2.7 12 2.7z" /></svg>}
      title="Intake & Output"
      aside="shift totals · quick entry"
    >
      {patients.map(p => {
        const t = totals(p.patientId)
        return (
          <div className="iorow" key={p.patientId}>
            <span className="ioname">{p.name}</span>
            <div className="iototals">
              <VitalTile variant="rt" label="Intake" value={`+${t.intake}`} unit=" mL" valueStyle={{ color: 'var(--cyan)' }} />
              <VitalTile variant="rt" label="Output" value={`−${t.output}`} unit=" mL" valueStyle={{ color: 'var(--amber)' }} />
              <VitalTile
                variant="rt" label="Balance"
                value={`${t.balance >= 0 ? '+' : '−'}${Math.abs(t.balance)}`} unit=" mL"
                valueStyle={{ color: t.balance >= 0 ? 'var(--green)' : 'var(--red)' }}
              />
            </div>
          </div>
        )
      })}

      <div className="ioform">
        <div className="field">
          <label htmlFor="ioPatient">Patient</label>
          <select id="ioPatient" value={pid} onChange={e => setPatientId(e.target.value)}>
            {patients.map(p => <option key={p.patientId} value={p.patientId}>{p.name} — {p.bedId}</option>)}
          </select>
        </div>
        <div className="field">
          <label id="ioKindLbl">Type</label>
          <div className="iokind" role="group" aria-labelledby="ioKindLbl">
            <button className={`iok${kind === 'intake' ? ' on' : ''}`} aria-pressed={kind === 'intake'} onClick={() => setKindAndCategory('intake')}>Intake</button>
            <button className={`iok${kind === 'output' ? ' on' : ''}`} aria-pressed={kind === 'output'} onClick={() => setKindAndCategory('output')}>Output</button>
          </div>
        </div>
        <div className="field">
          <label htmlFor="ioCat">Category</label>
          <select id="ioCat" value={category} onChange={e => setCategory(e.target.value)}>
            {IO_CATEGORIES[kind].map(c => <option key={c}>{c}</option>)}
          </select>
        </div>
        <div className="field iovol">
          <label htmlFor="ioMl">Volume (mL)</label>
          <div className="iovolrow">
            <input
              id="ioMl" type="number" min="1" step="10" placeholder="0" value={volume}
              onChange={e => setVolume(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') submit() }}
            />
            <button className="btn primary iorec" onClick={submit} disabled={!volume}>+ Record</button>
          </div>
        </div>
      </div>
    </Card>
  )
}

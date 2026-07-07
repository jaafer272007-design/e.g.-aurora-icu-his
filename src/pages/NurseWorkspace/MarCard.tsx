import { Card } from '../../components/Card'
import { BedChip } from '../../components/Tag'
import type { AssignedPatient, MarAction, MarEntry } from '../../lib/api/types'

const STATE_META: Record<string, { label: string; cls: string }> = {
  overdue: { label: 'OVERDUE', cls: 'st-overdue' },
  due: { label: 'DUE', cls: 'st-due' },
  upcoming: { label: 'LATER', cls: 'st-upcoming' },
  prn: { label: 'PRN', cls: 'st-prn' },
  given: { label: 'GIVEN', cls: 'st-given' },
  held: { label: 'HELD', cls: 'st-held' },
  refused: { label: 'REFUSED', cls: 'st-refused' },
}

const PENDING = new Set(['overdue', 'due', 'upcoming', 'prn'])

interface MarCardProps {
  entries: MarEntry[]
  patients: AssignedPatient[]
  onDocument: (marId: string, action: MarAction) => void
}

/** Medication Administration Record — administer + document ONLY.
 *  Nurse RBAC (locked decision): no order origination, no dose editing;
 *  every action is a documentation event against an existing order. */
export function MarCard({ entries, patients, onDocument }: MarCardProps) {
  const dueCount = entries.filter(e => e.status === 'due' || e.status === 'overdue').length
  return (
    <Card
      icon={<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--cyan)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="7" y="2" width="10" height="20" rx="4" /><path d="M7 9h10M7 15h10" /></svg>}
      title="Medication Administration Record"
      aside={`${dueCount} due · administer & document only`}
    >
      {patients.map(p => {
        const rows = entries.filter(e => e.patientId === p.patientId)
        if (!rows.length) return null
        return (
          <div className="margroup" key={p.patientId}>
            <div className="marpt"><BedChip bedId={p.bedId} /><b>{p.name}</b><span className="marallergy">⚠ {p.allergies}</span></div>
            {rows.map(e => {
              const meta = STATE_META[e.status]
              const pending = PENDING.has(e.status)
              return (
                <div className={`marrow ${meta.cls}`} key={e.marId}>
                  <span className="martime num">{e.scheduledTime || '—'}</span>
                  <div className="marmed">
                    <div className="mn">{e.medication} <span className="mdose num">{e.dose}</span></div>
                    <div className="mroute">{e.route}</div>
                  </div>
                  <span className={`marstate ${meta.cls}`}>{meta.label}</span>
                  {pending ? (
                    <div className="maracts" role="group" aria-label={`Document ${e.medication} for ${p.name}`}>
                      <button className="mab given" onClick={() => onDocument(e.marId, 'given')} aria-label={`${e.medication}: given`}>✓ Given</button>
                      <button className="mab held" onClick={() => onDocument(e.marId, 'held')} aria-label={`${e.medication}: held`}>⊘ Held</button>
                      <button className="mab refused" onClick={() => onDocument(e.marId, 'refused')} aria-label={`${e.medication}: refused`}>✕ Refused</button>
                    </div>
                  ) : (
                    <span className="mardoc num">documented {e.documentedTime}</span>
                  )}
                </div>
              )
            })}
          </div>
        )
      })}
    </Card>
  )
}

import { useEffect, useMemo, useState } from 'react'
import { Card } from '../../components/Card'
import { IconSearch } from '../../components/icons'
import { checkMedicationSafety } from '../../lib/api/safety'
import type {
  FormularyDrug, InteractionRule, MedicationDetails, Order, OrderPriority,
} from '../../lib/api/types'

interface NewOrderCardProps {
  patient: { patientId: string; name: string; allergies: string }
  formulary: FormularyDrug[]
  rules: InteractionRule[]
  /** the patient's current orders — active meds feed interaction checks */
  orders: Order[]
  onCreate: (medication: MedicationDetails, priority: OrderPriority, sign: boolean, overrideNote?: string) => void
}

/** New medication order — searchable formulary with dose/route/frequency/
 *  duration/PRN fields and live allergy + interaction checking. Blocks on
 *  contraindication; warnings require an acknowledged clinical justification.
 *  Doctor RBAC only. */
export function NewOrderCard({ patient, formulary, rules, orders, onCreate }: NewOrderCardProps) {
  const [query, setQuery] = useState('')
  const [drug, setDrug] = useState<FormularyDrug | null>(null)
  const [dose, setDose] = useState('')
  const [route, setRoute] = useState('')
  const [frequency, setFrequency] = useState('')
  /* starts empty — blank means "ongoing", applied at submit (typing must
     never have to fight pre-filled text) */
  const [duration, setDuration] = useState('')
  const [prn, setPrn] = useState(false)
  const [prnIndication, setPrnIndication] = useState('')
  const [priority, setPriority] = useState<OrderPriority>('Routine')
  const [ack, setAck] = useState(false)
  const [justification, setJustification] = useState('')

  /* reset the form when switching patients */
  useEffect(() => {
    setQuery(''); setDrug(null); setAck(false); setJustification('')
  }, [patient.patientId])

  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return []
    return formulary
      .filter(d => d.name.toLowerCase().includes(q) || d.drugClass.toLowerCase().includes(q))
      .slice(0, 6)
  }, [query, formulary])

  const pick = (d: FormularyDrug) => {
    setDrug(d)
    setDose(d.doses[0] ?? '')
    setRoute(d.routes[0] ?? '')
    setFrequency(d.frequencies[0] ?? '')
    setDuration('')
    setPrn(false)
    setPrnIndication('')
    setAck(false)
    setJustification('')
  }

  const issues = useMemo(
    () => (drug ? checkMedicationSafety(drug, patient.allergies, orders, rules) : []),
    [drug, patient.allergies, orders, rules],
  )
  const blocked = issues.some(i => i.severity === 'block')
  const warned = issues.some(i => i.severity === 'warn')
  const needsOverride = !blocked && warned
  /* acknowledging the warnings is what gates ordering — the justification
     text is optional context, captured in the audit trail either way */
  const overrideOk = !needsOverride || ack
  const fieldsOk = !!drug && !!dose && !!route && (prn ? !!prnIndication : !!frequency)
  const canOrder = fieldsOk && !blocked && overrideOk

  const submit = (sign: boolean) => {
    if (!drug || !canOrder) return
    const warnNote = needsOverride
      ? `Safety warnings acknowledged and overridden: ${issues
          .filter(i => i.severity === 'warn')
          .map(i => i.message)
          .join(' | ')}${justification.trim() ? ` — ${justification.trim()}` : ''}`
      : undefined
    onCreate(
      {
        drugId: drug.drugId, drug: drug.name, dose, route, frequency,
        duration: duration.trim() || 'ongoing',
        prn, prnIndication: prn ? prnIndication : undefined,
      },
      priority, sign, warnNote,
    )
    setQuery(''); setDrug(null); setAck(false); setJustification('')
  }

  const disabledHint = !drug || canOrder ? null
    : blocked ? 'Ordering blocked — contraindicated for this patient.'
    : needsOverride && !ack ? 'Acknowledge the warnings above to enable ordering.'
    : 'Complete dose, route and frequency (or PRN indication) to enable ordering.'

  return (
    <Card
      icon={<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--cyan)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="7" y="2" width="10" height="20" rx="4" /><path d="M7 9h10M7 15h10" /></svg>}
      title="New Medication Order"
      aside={`allergy check vs: ${patient.allergies}`}
    >
      <div className="omsearch">
        <IconSearch size={14} stroke="var(--faint)" />
        <input
          placeholder="Search formulary — drug or class…" aria-label="Search medication formulary"
          value={query} onChange={e => setQuery(e.target.value)}
        />
      </div>
      {results.length > 0 && (
        <div className="omresults" role="listbox" aria-label="Formulary matches">
          {results.map(d => (
            <button key={d.drugId} role="option" aria-selected={drug?.drugId === d.drugId}
              className={`omresult${drug?.drugId === d.drugId ? ' on' : ''}`} onClick={() => pick(d)}>
              <b>{d.name}</b><span>{d.drugClass}</span>
            </button>
          ))}
        </div>
      )}

      {drug && (
        <>
          <div className="omdrug"><b>{drug.name}</b><span>{drug.drugClass}</span></div>

          {issues.length > 0 && (
            <div className="omsafety" role="alert">
              {issues.map((i, k) => (
                <div key={k} className={`omissue ${i.severity}`}>
                  {i.severity === 'block' ? '⛔' : '⚠'} <b>{i.kind.toUpperCase()}</b> {i.message}
                </div>
              ))}
              {blocked && <div className="omblocknote">Ordering blocked — contraindicated for this patient.</div>}
              {needsOverride && (
                <div className="omoverride">
                  <label className="omack">
                    <input type="checkbox" checked={ack} onChange={e => setAck(e.target.checked)} />
                    Acknowledge warnings and override
                  </label>
                  <input
                    className="omjust" placeholder="Clinical justification (optional — recorded in audit)"
                    aria-label="Override justification (optional)"
                    value={justification} onChange={e => setJustification(e.target.value)}
                  />
                </div>
              )}
            </div>
          )}

          <div className="omgrid2">
            <div className="field">
              <label htmlFor="noDose">Dose</label>
              <select id="noDose" value={dose} onChange={e => setDose(e.target.value)}>
                {drug.doses.map(d => <option key={d}>{d}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="noRoute">Route</label>
              <select id="noRoute" value={route} onChange={e => setRoute(e.target.value)}>
                {drug.routes.map(r => <option key={r}>{r}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="noFreq">Frequency</label>
              <select id="noFreq" value={frequency} disabled={prn} onChange={e => setFrequency(e.target.value)}>
                {drug.frequencies.map(f => <option key={f}>{f}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="noDur">Duration</label>
              <input id="noDur" value={duration} onChange={e => setDuration(e.target.value)} placeholder="e.g. 7 days · once — blank = ongoing" />
            </div>
            <div className="field">
              <label htmlFor="noPrio">Priority</label>
              <select id="noPrio" value={priority} onChange={e => setPriority(e.target.value as OrderPriority)}>
                <option>Routine</option><option>Urgent</option><option>STAT</option>
              </select>
            </div>
            <div className="field omprn">
              <label id="noPrnLbl">PRN</label>
              <label className="omack" aria-labelledby="noPrnLbl">
                <input type="checkbox" disabled={!drug.prnCapable} checked={prn} onChange={e => setPrn(e.target.checked)} />
                {drug.prnCapable ? 'As required' : 'Not PRN-capable'}
              </label>
            </div>
            {prn && (
              <div className="field omspan2">
                <label htmlFor="noPrnInd">PRN indication (required)</label>
                <input id="noPrnInd" value={prnIndication} onChange={e => setPrnIndication(e.target.value)} placeholder="e.g. temp ≥ 38.3 °C, pain score ≥ 4" />
              </div>
            )}
          </div>

          <div className="omdfoot">
            <button className="btn ghost" disabled={!canOrder} onClick={() => submit(false)}>Save as Pending</button>
            <button className="btn primary" disabled={!canOrder} onClick={() => submit(true)}>Sign &amp; Activate</button>
          </div>
          {disabledHint && <p className="omhint" role="status">{disabledHint}</p>}
        </>
      )}
      {!drug && query.trim() && results.length === 0 && <div className="omempty">No formulary match for "{query}".</div>}
      {!drug && !query.trim() && <div className="omempty">Search the formulary to start an order.</div>}
    </Card>
  )
}

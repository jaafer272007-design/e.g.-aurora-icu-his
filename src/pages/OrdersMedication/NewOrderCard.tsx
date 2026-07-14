import { useEffect, useMemo, useState } from 'react'
import { Card } from '../../components/Card'
import { IconSearch } from '../../components/icons'
import { checkMedicationSafety } from '../../lib/api/safety'
import { absoluteRate, formatInfusionDose, formatNormalised, parseInfusionPreset } from '../../lib/infusion'
import type {
  FormularyDrug, InfusionDose, InteractionRule, MedicationDetails, Order, OrderPriority,
} from '../../lib/api/types'

/* STRUCTURED INFUSION ORDERING — drugs whose infusions are dosed in
   UNITS (U/min, U/h: vasopressin, insulin, heparin) cannot be expressed
   in the design's µg/mg-per-kg structure, so they keep the free-text/
   preset dose path (FLAGGED open item — a units-based entry mode is a
   recorded follow-up; SOFA's vasopressin band is any-dose, so presence
   can still be read from drug identity). Every mass-dosed drug ordered
   at frequency 'continuous' uses the structured form instead of free
   text (the stated resolution of the design's open item 3). */
const UNIT_DOSED_INFUSIONS = ['vasopressin', 'insulin-actrapid', 'heparin']

interface NewOrderCardProps {
  patient: { patientId: string; name: string; allergies: string }
  formulary: FormularyDrug[]
  rules: InteractionRule[]
  /** the patient's current orders — active meds feed interaction checks */
  orders: Order[]
  /** THIS encounter's recorded weight (PR #83) — drives the derived
   *  absolute-rate preview; undefined = not recorded (handled honestly) */
  weightKg?: number
  onCreate: (medication: MedicationDetails, priority: OrderPriority, sign: boolean, overrideNote?: string) => void
}

/** New medication order — searchable formulary with dose/route/frequency/
 *  duration/PRN fields and live allergy + interaction checking. Blocks on
 *  contraindication; warnings require an acknowledged clinical justification.
 *  Doctor RBAC only. */
export function NewOrderCard({ patient, formulary, rules, orders, weightKg, onCreate }: NewOrderCardProps) {
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
  /* structured infusion entry (value + µg/mg + per-kg fixed + min/hour) */
  const [infValue, setInfValue] = useState('')
  const [infUnit, setInfUnit] = useState<'mcg' | 'mg'>('mcg')
  const [infTime, setInfTime] = useState<'min' | 'hour'>('min')

  /* reset the form when switching patients */
  useEffect(() => {
    setQuery(''); setDrug(null); setAck(false); setJustification('')
  }, [patient.patientId])

  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return []
    /* Layer 4: an INACTIVE formulary drug cannot be selected for a new
       order — excluded from search (the server 409s it regardless);
       existing orders referencing it still render everywhere */
    return formulary
      .filter(d => d.active !== false)
      .filter(d => d.name.toLowerCase().includes(q) || d.drugClass.toLowerCase().includes(q)
        || d.brandNames.some(b => b.toLowerCase().includes(q)))
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
    /* prefill the structured entry from the formulary default when it
       parses as a kg-mass rate (e.g. "0.05 µg/kg/min") */
    const preset = parseInfusionPreset(d.defaultDose ?? d.doses[0] ?? '')
    setInfValue(preset ? String(preset.value) : '')
    setInfUnit(preset?.massUnit ?? 'mcg')
    setInfTime(preset?.timeBasis ?? 'min')
  }

  /* the structured form REPLACES free-text dose whenever the selected
     frequency is 'continuous' on a mass-dosed drug; everything else
     (q6h antibiotics, PRN analgesia, unit-dosed infusions) is unchanged */
  const infusionMode = !!drug && frequency === 'continuous' && !prn
    && !UNIT_DOSED_INFUSIONS.includes(drug.drugId)
  /* ≤ 4 decimals so the client-composed display string and the server's
     composition are character-identical (neither side ever rounds) */
  const infParsed = /^\d+(\.\d{1,4})?$/.test(infValue.trim()) ? Number(infValue.trim()) : NaN
  const infOk = Number.isFinite(infParsed) && infParsed > 0 && infParsed <= 100000
  const infusion: InfusionDose | null = infusionMode && infOk
    ? { value: infParsed, massUnit: infUnit, timeBasis: infTime }
    : null

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
  const fieldsOk = !!drug && !!route
    && (infusionMode ? infOk : !!dose && (prn ? !!prnIndication : !!frequency))
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
        drugId: drug.drugId, drug: drug.name,
        /* infusion mode: the display dose is the composition of the
           structured entry (the server re-composes and enforces the
           match); the structured entry itself is the canonical dose */
        dose: infusion ? formatInfusionDose(infusion) : dose,
        route, frequency,
        duration: duration.trim() || 'ongoing',
        prn, prnIndication: prn ? prnIndication : undefined,
        ...(infusion ? { infusion } : {}),
      },
      priority, sign, warnNote,
    )
    setQuery(''); setDrug(null); setAck(false); setJustification('')
  }

  const disabledHint = !drug || canOrder ? null
    : blocked ? 'Ordering blocked — contraindicated for this patient.'
    : needsOverride && !ack ? 'Acknowledge the warnings above to enable ordering.'
    : infusionMode ? 'Enter a numeric infusion dose (up to 4 decimals) to enable ordering.'
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

          {infusionMode && (
            <div className="ominfusion" role="group" aria-label="Structured infusion dose">
              <div className="ominfhead">Structured infusion dose <i>— weight-based (per kg), stored as entered</i></div>
              <div className="ominfrow">
                <input
                  className="ominfval num" value={infValue} inputMode="decimal"
                  onChange={e => setInfValue(e.target.value)}
                  placeholder="0.3" aria-label="Infusion dose value (up to 4 decimals)"
                />
                <select value={infUnit} onChange={e => setInfUnit(e.target.value as 'mcg' | 'mg')} aria-label="Mass unit">
                  <option value="mcg">µg</option>
                  <option value="mg">mg</option>
                </select>
                <span className="ominfper">/ kg /</span>
                <select value={infTime} onChange={e => setInfTime(e.target.value as 'min' | 'hour')} aria-label="Time basis">
                  <option value="min">min</option>
                  <option value="hour">hour</option>
                </select>
              </div>
              {drug.doses.some(d => parseInfusionPreset(d)) && (
                <div className="ominfpresets" role="group" aria-label="Formulary dose presets">
                  {drug.doses.map(d => {
                    const p = parseInfusionPreset(d)
                    return p ? (
                      <button key={d} type="button" className="ominfpreset num"
                        onClick={() => { setInfValue(String(p.value)); setInfUnit(p.massUnit); setInfTime(p.timeBasis) }}>
                        {d}
                      </button>
                    ) : null
                  })}
                </div>
              )}
              {infusion && (
                <div className="ominfpreview">
                  <b className="num">{formatInfusionDose(infusion)}</b>
                  <span className="num"> · normalised {formatNormalised(infusion)}</span>
                  {absoluteRate(infusion, weightKg) ? (
                    <span className="num"> · ≈ {absoluteRate(infusion, weightKg)} at {weightKg} kg (encounter weight)</span>
                  ) : (
                    <span className="ominfnow"> · encounter weight not recorded — absolute rate unavailable (the per-kg dose stands; nothing fabricated)</span>
                  )}
                </div>
              )}
            </div>
          )}

          <div className="omgrid2">
            {!infusionMode && (
              <div className="field">
                <label htmlFor="noDose">Dose</label>
                <select id="noDose" value={dose} onChange={e => setDose(e.target.value)}>
                  {drug.doses.map(d => <option key={d}>{d}</option>)}
                </select>
              </div>
            )}
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

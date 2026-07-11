import type { ReactNode } from 'react'
import type { PrintMedLine } from './types'

/* Shared printable building blocks — every template composes these, so
   the remaining templates (later PRs) are mostly new compositions, not
   new infrastructure. */

/** Titled document section with predictable page-break behaviour. */
export function Section({ title, children, keepTogether = false }: {
  title: string
  children: ReactNode
  /** small sections (signatures, short tables) avoid splitting */
  keepTogether?: boolean
}) {
  return (
    <section className={`pd-section${keepTogether ? ' pd-keep' : ''}`}>
      <h2>{title}</h2>
      {children}
    </section>
  )
}

/** Ruled write-in area for narrative content that has no canonical store
 *  yet (assessment, plan, past history, …) — the printed form is honest
 *  about what the system does and does not record. */
export function WriteIn({ lines = 4, prefill }: { lines?: number; prefill?: string }) {
  return (
    <div className="pd-writein">
      {prefill && <p className="pd-prefill">{prefill}</p>}
      {Array.from({ length: lines }, (_, i) => <div key={i} className="pd-rule" />)}
    </div>
  )
}

/** Label/value grid used for vitals and score strips. */
export function FactGrid({ facts }: { facts: [string, ReactNode][] }) {
  return (
    <div className="pd-facts">
      {facts.map(([k, v]) => (
        <div key={k}><span className="pd-k">{k}</span><span className="pd-v">{v}</span></div>
      ))}
    </div>
  )
}

/** Medication table — rendered ONLY from persisted order data (the
 *  ORD-168 guarantee: never a formulary join). */
export function MedTable({ meds, showStopped = false, chartedMark = '' }: {
  meds: PrintMedLine[]
  showStopped?: boolean
  /** the † footnote marker, when charted times appear in the table */
  chartedMark?: string
}) {
  if (meds.length === 0) return <p className="pd-empty">None recorded.</p>
  return (
    <table className="pd-table">
      <thead>
        <tr>
          <th>Medication</th><th>Dose</th><th>Route</th><th>Frequency</th><th>Duration</th>
          <th>Ordered{chartedMark}</th>
          {showStopped && <th>Stopped{chartedMark} · reason</th>}
        </tr>
      </thead>
      <tbody>
        {meds.map(m => (
          <tr key={m.orderId}>
            <td>{m.drug}{m.prn ? ' (PRN)' : ''}<span className="pd-sub"> {m.orderId}</span></td>
            <td>{m.dose}</td>
            <td>{m.route}</td>
            <td>{m.frequency}</td>
            <td>{m.duration}</td>
            <td>{m.orderedTime} · {m.orderedBy}</td>
            {showStopped && <td>{m.stoppedTime ?? '—'}{m.stoppedReason ? ` · ${m.stoppedReason}` : ''}</td>}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

/** Signature block — always a write-in: signing happens on paper. */
export function SignatureBlock({ role }: { role: string }) {
  return (
    <div className="pd-sig pd-keep">
      <div><div className="pd-rule pd-rule-sig" /><span>{role} — name &amp; signature</span></div>
      <div><div className="pd-rule pd-rule-sig" /><span>Date / time</span></div>
    </div>
  )
}

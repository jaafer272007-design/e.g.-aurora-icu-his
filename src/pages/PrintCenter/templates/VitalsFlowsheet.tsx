import { Section, SignatureBlock } from '../primitives'
import type { FlowsheetData } from '../types'
import { clockZone } from '../../../lib/time'

/* Contract #12 — Vital Signs / Observation Flowsheet (Stage 11).
   Rows = observation types (the validator's TRADITIONAL SPLIT: Vital
   Signs + Neurological Assessment + Fluid Balance; ventilator detail
   lives on the Ventilator & Device Report). Columns = 24 hourly
   timepoints anchored to the latest charted observation. ADAPTIVE
   layout (design P1): the wide 24 h grid drives LANDSCAPE orientation;
   sections repeat the timepoint header across page breaks. Derived rows
   (GCS Total, Total Input/Output, Net Balance) compute PER COLUMN at
   render — never charted, never stored. Every cell is a real charted
   effective value or an honest blank. */
export function VitalsFlowsheet({ data }: { data: FlowsheetData }) {
  const { grid, unavailable } = data

  if (unavailable) {
    return (
      <Section title="Observation flowsheet">
        <p className="pd-empty">
          The observation record could not be read while preparing this document — the
          flowsheet is unavailable rather than fabricated. Reprint when the AURORA API
          is reachable.
        </p>
      </Section>
    )
  }
  if (!grid) {
    return (
      <Section title="Observation flowsheet">
        <p className="pd-empty">No observations have been charted this encounter — the flowsheet starts honestly blank.</p>
      </Section>
    )
  }

  /* one header cell per day boundary (charted clinical times are
     stored UTC and CONVERTED to the display clock in the selector —
     the flowsheet prints the hospital's own dates) */
  const dateSpans: { date: string; span: number }[] = []
  for (const c of grid.columns) {
    const last = dateSpans[dateSpans.length - 1]
    if (last && last.date === c.date) last.span++
    else dateSpans.push({ date: c.date, span: 1 })
  }

  return (
    <>
      <Section title={`Observation flowsheet — ${grid.windowStart} → ${grid.windowEnd} (${clockZone() ?? 'local time'} · hourly)`}>
        <table className="pd-table pd-flow">
          <thead>
            <tr>
              <th className="pd-flow-label" rowSpan={2}>Observation</th>
              {dateSpans.map(d => <th key={d.date} colSpan={d.span} className="pd-flow-date">{d.date}</th>)}
            </tr>
            <tr>
              {grid.columns.map((c, i) => <th key={i} className="pd-flow-hour">{c.hourLabel}</th>)}
            </tr>
          </thead>
          {grid.sections.map(s => (
            <tbody key={s.title}>
              <tr className="pd-flow-section"><td colSpan={grid.columns.length + 1}>{s.title}</td></tr>
              {s.rows.map(r => (
                <tr key={r.typeCode} className={r.derived ? 'pd-flow-derived' : undefined}>
                  <td className="pd-flow-label">
                    {r.label}{r.unit && <span className="pd-sub"> {r.unit}</span>}
                    {r.derived && <span className="pd-sub"> · computed</span>}
                  </td>
                  {r.cells.map((v, i) => <td key={i} className="pd-flow-cell">{v ?? ''}</td>)}
                </tr>
              ))}
            </tbody>
          ))}
        </table>
        <p className="pd-footnote">
          Values are the charted observations of this encounter, placed at their charted hour;
          an empty cell means nothing was charted that hour (never fabricated). Repeat
          measurements within one hour print together separated by “/”. GCS prints as
          E/V/M components; Pupils print as size (mm) + reaction (B brisk · S sluggish · F fixed).
          Rows marked “computed” derive at print time from that hour&apos;s charted entries
          (Total Input/Output sum every entry of the hour; Net Balance = input − output;
          GCS Total sums the components) and are never stored.
          {grid.amendedCount > 0 && (
            <> {grid.amendedCount} value{grid.amendedCount === 1 ? ' was' : 's were'} corrected
            after charting and print{grid.amendedCount === 1 ? 's' : ''} as the effective
            (amended) value — the full amendment audit stays on the chart record.</>
          )}
        </p>
      </Section>
      <SignatureBlock role="Nurse / clinician reviewing" />
    </>
  )
}

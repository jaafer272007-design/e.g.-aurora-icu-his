import { Section, SignatureBlock } from '../primitives'
import type { VentDeviceData, VentSnapshotLine } from '../types'
import { clockZone, displayFullStamp } from '../../../lib/time'

/* Contract #13 — Ventilator & Device Report (Stage 11).
   The ventilator section is a SNAPSHOT (validator's decision): the
   CURRENT setup — the latest charted value per catalogue type, each
   attributed to its own charted time (settings may legitimately come
   from different rounds). Driving Pressure derives at render (Pplat −
   PEEP, one shared timepoint only); Minute Ventilation prints charted
   when charted, else computes from same-timepoint VT(exhaled) × RR
   (measured), labelled. Device sections are LAID OUT NOW and honestly
   empty (validator's decision): always present, "not charted"/"not
   monitored" until device observations exist. */

function SnapshotTable({ lines }: { lines: VentSnapshotLine[] }) {
  return (
    <table className="pd-table">
      <thead>
        <tr><th>Parameter</th><th>Value</th><th>Charted at ({clockZone() ?? 'local time'})</th></tr>
      </thead>
      <tbody>
        {lines.map(l => (
          <tr key={l.typeCode}>
            <td>{l.label}</td>
            <td>
              {l.value === null ? '— not charted' : `${l.value}${l.unit ? ` ${l.unit}` : ''}`}
              {l.provenance === 'derived' && <span className="pd-sub"> · derived (Pplat − PEEP)</span>}
              {l.provenance === 'computed' && <span className="pd-sub"> · computed (VT × RR)</span>}
            </td>
            <td>{l.clinicalTime ? displayFullStamp(l.clinicalTime) : '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export function VentDeviceReport({ data }: { data: VentDeviceData }) {
  const { ventilator, pumpRate, devicesGroupEnabled, unavailable } = data

  if (unavailable || ventilator === null) {
    return (
      <Section title="Ventilator & devices">
        <p className="pd-empty">
          The observation record could not be read while preparing this document — the
          report is unavailable rather than fabricated. Reprint when the AURORA API is
          reachable.
        </p>
      </Section>
    )
  }

  return (
    <>
      <Section title="Ventilator — current setup (latest charted settings)">
        <SnapshotTable lines={ventilator} />
        <p className="pd-footnote">
          A point-in-time snapshot from the charted observation record: each value is the
          most recent charted entry for that parameter, attributed to its own charted time —
          values from different charting rounds legitimately carry different times. “— not
          charted” means no observation of that type exists this encounter. Derived and
          computed values are calculated at print time and never stored.
        </p>
      </Section>

      <Section title="Infusion pumps" keepTogether>
        {pumpRate ? (
          <SnapshotTable lines={[pumpRate]} />
        ) : (
          <p className="pd-empty">No infusion-pump parameters exist in this deployment&apos;s observation catalogue.</p>
        )}
        {devicesGroupEnabled === false && (
          <p className="pd-footnote">
            The Devices observation group is currently disabled in this deployment&apos;s
            configuration — pump parameters become chartable when a Consultant-tier user
            enables the group.
          </p>
        )}
      </Section>

      {/* future device parameters — sections ALWAYS PRESENT, honestly
          empty (the Face Sheet "NOT RECORDED BY THE SYSTEM" precedent):
          they fill as device integration adds catalogue types. */}
      <Section title="ECMO" keepTogether>
        <p className="pd-empty">Not monitored — no ECMO parameters exist in this deployment&apos;s observation catalogue yet (future device integration).</p>
      </Section>
      <Section title="CRRT" keepTogether>
        <p className="pd-empty">Not monitored — no CRRT parameters exist in this deployment&apos;s observation catalogue yet (future device integration).</p>
      </Section>
      <Section title="ICP monitoring" keepTogether>
        <p className="pd-empty">Not monitored — no ICP parameters exist in this deployment&apos;s observation catalogue yet (future device integration).</p>
      </Section>

      <SignatureBlock role="Respiratory therapist / physician" />
    </>
  )
}

import { FactGrid, MedTable, pv, Section, SignatureBlock, WriteIn } from '../primitives'
import type { DailyProgressData } from '../types'

/** Template 2 — Daily Progress Note. Current-state document for an open
 *  encounter: bedside snapshot, active problems, ventilation flag (from
 *  the roster's support flags — device settings await the Stage 11
 *  Observation model and are not fabricated), active medications, latest
 *  labs per panel, and the recent charted events. */
export function DailyProgressNote({ data }: { data: DailyProgressData }) {
  const { context, vitals, activeProblems, ventilation, activeMeds, latestLabs, recentEvents } = data
  const mark = context.hasChartedTimes ? ' †' : ''
  return (
    <>
      <Section title="Patient summary" keepTogether>
        <p>{context.patient.name} · {context.patient.diagnosis}</p>
      </Section>

      <Section title={`Overnight / interval events${mark}`}>
        {recentEvents.length > 0 && (
          <table className="pd-table">
            <thead><tr><th>Time{mark}</th><th>Event</th><th>By</th></tr></thead>
            <tbody>
              {recentEvents.map(e => (
                <tr key={e.id}>
                  <td>{e.time}</td>
                  <td>{e.categoryLabel}: {e.title}{e.detail ? ` — ${e.detail}` : ''}</td>
                  <td>{e.actor ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <WriteIn lines={3} />
      </Section>

      <Section title="Vital signs (bedside snapshot as of printing)" keepTogether>
        {vitals ? (
          <FactGrid facts={[
            ['HR', pv(vitals.bedside.hr, '/min')],
            ['MAP', pv(vitals.bedside.map, 'mmHg')],
            ['BP', vitals.monitor.sys === null && vitals.monitor.dia === null
              ? '— not charted'
              : `${vitals.monitor.sys ?? '—'}/${vitals.monitor.dia ?? '—'} mmHg`],
            ['SpO₂', pv(vitals.bedside.spo2, '%')],
            ['RR', pv(vitals.monitor.rr, '/min')],
            ['Temp', pv(vitals.bedside.temp, '°C')],
            ['Urine output', pv(vitals.bedside.uo, 'mL')],
            ['SOFA', vitals.sofa],
            ['EWS', vitals.ews],
          ]} />
        ) : (
          <p className="pd-empty">No bedside snapshot — the patient is not on the active roster.</p>
        )}
      </Section>

      <Section title="Active problems" keepTogether>
        <ul className="pd-list">
          {activeProblems.map(p => <li key={p}>{p}</li>)}
        </ul>
      </Section>

      {ventilation && ventilation.flagged && (
        <Section title="Ventilation" keepTogether>
          <FactGrid facts={[
            ['Ventilated', 'yes (roster support flag)'],
            ['SpO₂', pv(ventilation.spo2, '%')],
            ['RR', pv(ventilation.rr, '/min')],
            ['Rhythm', ventilation.rhythm],
          ]} />
          <p className="pd-sub">
            Ventilator settings/readings are Stage 11 Observation-model scope and are not part of the
            record yet — document settings below if required.
          </p>
          <WriteIn lines={2} />
        </Section>
      )}

      <Section title={`Active medications${mark}`}>
        <MedTable meds={activeMeds} chartedMark={mark} />
      </Section>

      <Section title={`Laboratory summary — latest result per panel${mark}`}>
        {latestLabs.length === 0 ? <p className="pd-empty">No results recorded this encounter.</p> : (
          <table className="pd-table">
            <thead><tr><th>Panel</th><th>Resulted{mark}</th><th>Flag</th><th>Key values</th></tr></thead>
            <tbody>
              {latestLabs.map(d => (
                <tr key={d.labId}>
                  <td>{d.panel}<span className="pd-sub"> {d.labId}</span></td>
                  <td>{d.resultedAt}</td>
                  <td className={d.flag !== 'normal' ? 'pd-flag' : undefined}>{d.flag}</td>
                  <td>
                    {(d.items.filter(i => i.flag !== 'normal').length ? d.items.filter(i => i.flag !== 'normal') : d.items)
                      .slice(0, 5)
                      .map(i => `${i.analyte} ${i.value} ${i.unit}`.trim())
                      .join(' · ')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      <Section title="Assessment">
        <WriteIn lines={4} />
      </Section>

      <Section title="Plan for today">
        <WriteIn lines={5} />
      </Section>

      <Section title="Consultant" keepTogether>
        <SignatureBlock role="Consultant" />
      </Section>
    </>
  )
}

import type { ReactNode } from 'react'
import type { PrintContext } from './types'

/* ==================== Shared printable layout ====================
   The common chrome every printed clinical document shares: hospital
   header with logo placeholder, patient identity band, encounter band,
   document title, generation metadata (printed by / printed at), and the
   end-of-document footer. Templates supply only their sections.

   Generation metadata (the "Printed" line) is the ONLY clock-derived
   content on a printed document — everything clinical renders exactly as
   persisted. Page numbers come from the @page margin boxes in print.css
   (browsers that don't support them simply omit them). */

interface PrintLayoutProps {
  title: string
  context: PrintContext
  printedBy: string
  printedAt: string
  children: ReactNode
}

const dash = '—'

export function PrintLayout({ title, context, printedBy, printedAt, children }: PrintLayoutProps) {
  const { patient, encounter, hasChartedTimes } = context
  return (
    <article className="print-doc">
      <header className="pd-head">
        <div className="pd-logo" aria-hidden="true">✚</div>
        <div className="pd-hosp">
          <div className="pd-hosp-name">AURORA GENERAL HOSPITAL</div>
          <div className="pd-hosp-sub">Adult Intensive Care Unit · Aurora HIS</div>
        </div>
        <div className="pd-doc-meta">
          <div className="pd-doc-title-sm">{title}</div>
          <div>Printed {printedAt}</div>
          <div>Printed by {printedBy}</div>
        </div>
      </header>

      <h1 className="pd-title">{title}</h1>

      <section className="pd-band" aria-label="Patient identity">
        <div><span className="pd-k">Patient</span><span className="pd-v">{patient.name}</span></div>
        <div><span className="pd-k">Patient ID</span><span className="pd-v">{patient.patientId}</span></div>
        <div><span className="pd-k">MRN</span><span className="pd-v">{patient.mrn ?? dash}</span></div>
        <div><span className="pd-k">Age / Sex</span><span className="pd-v">{patient.age ?? dash} / {patient.sex ?? dash}</span></div>
        <div><span className="pd-k">Bed</span><span className="pd-v">{patient.bedId}</span></div>
        <div><span className="pd-k">Attending</span><span className="pd-v">{patient.attending}</span></div>
        <div><span className="pd-k">Code status</span><span className="pd-v">{patient.codeStatus ?? dash}</span></div>
        <div className="pd-band-wide"><span className="pd-k">Allergies</span><span className="pd-v pd-allergy">{patient.allergies ?? dash}</span></div>
        <div className="pd-band-wide"><span className="pd-k">Diagnosis</span><span className="pd-v">{patient.diagnosis}</span></div>
      </section>

      {encounter && (
        <section className="pd-band pd-band-enc" aria-label="Encounter">
          <div><span className="pd-k">Encounter</span><span className="pd-v">{encounter.encounterId}</span></div>
          <div><span className="pd-k">Status</span><span className="pd-v">{encounter.status}</span></div>
          <div><span className="pd-k">Admitted</span><span className="pd-v">{encounter.admittedAt || dash}{encounter.admittedBy ? ` · ${encounter.admittedBy}` : ''}</span></div>
          {encounter.dischargedAt !== undefined && (
            <div><span className="pd-k">Discharged</span><span className="pd-v">{encounter.dischargedAt || dash}{encounter.dischargedBy ? ` · ${encounter.dischargedBy}` : ''}</span></div>
          )}
        </section>
      )}

      {(patient.source === 'encounter-snapshot' || (encounter?.otherEncounterCount ?? 0) > 0) && (
        <section className="pd-notice">
          {patient.source === 'encounter-snapshot' && (
            <p>
              Identity fields shown with {dash} are not part of the encounter record: this patient is no
              longer on the active roster, and the document renders only what the encounter itself
              persisted — nothing is back-filled from live data.
            </p>
          )}
          {(encounter?.otherEncounterCount ?? 0) > 0 && (
            <p>
              This document is scoped to encounter <strong>{encounter!.encounterId}</strong>.{' '}
              {encounter!.otherEncounterCount} other encounter{encounter!.otherEncounterCount > 1 ? 's exist' : ' exists'} for
              this patient and {encounter!.otherEncounterCount > 1 ? 'are' : 'is'} not included — how a readmitted
              patient&apos;s chart should present prior-episode history is a recorded open question.
            </p>
          )}
        </section>
      )}

      {children}

      <footer className="pd-foot">
        {hasChartedTimes && (
          <p className="pd-footnote">
            † Clinical times print exactly as charted — “HH:mm” for today and “D-n HH:mm” for prior
            days. Calendar dates are not part of the charted record for order and administration
            events (a recorded open question); on a multi-day document, interpret times against the
            admission date above. The “Printed” stamp is generation metadata, not clinical data.
          </p>
        )}
        <p>
          {patient.patientId} · {encounter?.encounterId ?? 'no encounter'} · Generated by Aurora HIS Print
          Center from the clinical record as persisted — read-only rendering, no data was modified.
        </p>
      </footer>
    </article>
  )
}

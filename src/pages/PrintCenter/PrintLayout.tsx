import type { ReactNode } from 'react'
import type { PrintContext } from './types'
import { useHospitalIdentity, HOSPITAL_NAME_UNSET } from '../../lib/hospitalIdentity'
import { displayFullStamp } from '../../lib/time'

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
  /* Letterhead identity comes from the CONFIGURED hospital identity
     through the one resolver — never a hardcoded name. This is document
     CHROME (the install's current identity, like "Printed by"), not
     historical clinical content — the selectors' no-master-data rule
     governs clinical values, not the letterhead. UNSET renders the
     neutral placeholder — never a demo hospital's name on a real
     document. The optional address block prints only when configured. */
  const identity = useHospitalIdentity()
  const hospName = identity?.name ?? HOSPITAL_NAME_UNSET
  /* BRANDING (Print Center branding build): the configured LOGO replaces
     the placeholder box; the configured header/footer lines render as
     the hospital's own words. All of it is document CHROME — styling
     around the clinical record, never part of it — and each piece is
     individually toggleable by the print-time format engine (the
     fmt-nologo / fmt-nobrand classes in print.css). */
  return (
    <article className="print-doc">
      <header className="pd-head">
        {identity?.logoUrl
          ? <img className="pd-logo-img" src={identity.logoUrl} alt="" aria-hidden="true" />
          : <div className="pd-logo" aria-hidden="true">✚</div>}
        <div className="pd-hosp">
          <div className={`pd-hosp-name${identity?.configured ? '' : ' unset'}`}>{hospName}</div>
          {/* the CONFIGURED unit name (#135) — the old hardcoded
              "Adult Intensive Care Unit" subtitle ignored it */}
          <div className="pd-hosp-sub">{identity?.unitName ? `${identity.unitName} · Aurora HIS` : 'Aurora HIS'}</div>
          {identity?.headerText ? <div className="pd-hosp-tag">{identity.headerText}</div> : null}
          {identity?.address ? <div className="pd-hosp-addr">{identity.address}</div> : null}
        </div>
        <div className="pd-doc-meta">
          <div className="pd-doc-title-sm">{title}</div>
          <div>Printed {printedAt}</div>
          <div>Printed by {printedBy}</div>
        </div>
      </header>

      <h1 className="pd-title">{title}</h1>

      <section className="pd-band" aria-label="Patient identity">
        {/* official documents carry the FULL LEGAL NAME (all present
            parts) + the national identity number when recorded; a legacy
            single-name patient prints their stored name honestly, and an
            absent national ID prints a dash — never fabricated */}
        <div><span className="pd-k">Patient</span><span className="pd-v">{patient.fullName ?? patient.name}</span></div>
        <div><span className="pd-k">National ID</span><span className="pd-v">{patient.nationalId ?? dash}</span></div>
        <div><span className="pd-k">File No.</span><span className="pd-v">{patient.fileNumber ?? dash}</span></div>
        <div><span className="pd-k">Patient ID</span><span className="pd-v">{patient.patientId}</span></div>
        <div><span className="pd-k">MRN</span><span className="pd-v">{patient.mrn ?? dash}</span></div>
        <div><span className="pd-k">Age / Sex</span><span className="pd-v">{patient.age ?? dash} / {patient.sex ?? dash}</span></div>
        <div><span className="pd-k">Bed</span><span className="pd-v">{patient.bedId}</span></div>
        <div><span className="pd-k">Attending</span><span className="pd-v">{patient.attending}</span></div>
        <div><span className="pd-k">Code status</span><span className="pd-v">{patient.codeStatus ?? 'Not recorded'}</span></div>
        <div className="pd-band-wide"><span className="pd-k">Allergies</span><span className="pd-v pd-allergy">{patient.allergies ?? dash}</span></div>
        <div className="pd-band-wide"><span className="pd-k">Diagnosis</span><span className="pd-v">{patient.diagnosis}</span></div>
      </section>

      {encounter && (
        <section className="pd-band pd-band-enc" aria-label="Encounter">
          <div><span className="pd-k">Encounter</span><span className="pd-v">{encounter.encounterId}</span></div>
          <div><span className="pd-k">Status</span><span className="pd-v">{encounter.status}</span></div>
          <div><span className="pd-k">Admitted</span><span className="pd-v">{displayFullStamp(encounter.admittedAt) || dash}{encounter.admittedBy ? ` · ${encounter.admittedBy}` : ''}</span></div>
          {encounter.dischargedAt !== undefined && (
            <div><span className="pd-k">Discharged</span><span className="pd-v">{displayFullStamp(encounter.dischargedAt) || dash}{encounter.dischargedBy ? ` · ${encounter.dischargedBy}` : ''}</span></div>
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
        {identity?.footerText ? <p className="pd-foot-brand">{identity.footerText}</p> : null}
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

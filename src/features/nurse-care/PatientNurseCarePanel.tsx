import { useEffect, useMemo, useState } from 'react'
import { Card } from '../../components/Card'
import { DataAge } from '../../components/DataAge'
import { usePollTick } from '../../hooks/useLive'
import { getRosterRecord } from '../../lib/api'
import type { AdministrationAction } from '../../lib/api/types'
import { getSession, hasPermission } from '../../lib/session'
import { IoPanel } from './IoPanel'
import { MarCard, type MarPatient } from './MarCard'
import { useMarView } from './NurseCareProvider'
import './nurseCare.css'

/* ---------------- PATIENT NURSE-CARE PANEL (contract §6) ----------------
   The nurse's patient chart shows ONE patient's medication administration
   cards and Intake & Output — the same MarCard (Given / Held / Refused, reason
   dialog, locks, daily grouping) and the same IoPanel the Nurse Workspace
   uses, through the same per-tab controller (NurseCareProvider): a save
   started here and still unanswered keeps its lock, its stored attempt and its
   captured patient when the nurse moves to the workspace or another patient.
   Self-contained: its only input is the patient id. It reads the session
   itself, reads the MAR only for a viewer holding orders.view (the server's
   read permission), shows documenting controls only to meds.administer and the
   I&O entry only to observations.record, and renders its own loading /
   empty / error states and data-age chips. A patient switch clears it at once;
   a late response for the previous patient never renders. It shows the
   patient regardless of the nurse's opt-out worklist (any patient's dose may
   be documented). Session 2 owns where it sits in the chart. */

export function PatientNurseCarePanel({ patientId }: { patientId: string }) {
  const session = getSession()
  const canViewMar = !!session && hasPermission(session.jobTitle, 'orders.view')
  const canDocument = !!session && hasPermission(session.jobTitle, 'meds.administer')
  const tick = usePollTick()
  const ids = useMemo(() => (canViewMar ? [patientId] : null), [patientId, canViewMar])
  const mar = useMarView(ids, tick)

  /* the MAR group header (name, bed, allergies) for THIS patient only */
  const [header, setHeader] = useState<{ patientId: string; patient: MarPatient | null } | null>(null)
  useEffect(() => {
    let live = true
    getRosterRecord(patientId)
      .then(r => { if (live) setHeader({ patientId, patient: r ? { patientId, bedId: r.bedId, name: r.name, allergies: r.allergies } : null }) })
      .catch(() => { if (live) setHeader({ patientId, patient: null }) })
    return () => { live = false }
  }, [patientId])
  const rows = mar.rows
  const patient: MarPatient = (header?.patientId === patientId ? header.patient : null)
    ?? { patientId, bedId: rows?.find(r => r.patientId === patientId)?.bedId ?? '', name: 'This patient', allergies: 'allergies — see the chart header' }

  const onDocument = (orderId: string, adminId: string, action: AdministrationAction, reason?: string, administeredAt?: string) => {
    const row = rows?.find(r => r.orderId === orderId && r.adminId === adminId && r.patientId === patientId)
    if (row) mar.document(row, action, `${row.medication} · ${patient.name}`, reason, administeredAt)
  }

  return (
    <section className="ncpanel" aria-label="Medication administration and intake & output for this patient" data-patient={patientId}>
      {!canViewMar ? (
        <Card className="ncmar" title="Medication Administration Record">
          <div className="ncempty" role="note">Medication administration is not available to your role.</div>
        </Card>
      ) : rows === null ? (
        <Card className="ncmar" title="Medication Administration Record"
          aside={<DataAge at={null} live label="MAR" what="This patient's medication administration rows" />}>
          <div className="ncempty" role="status">Loading medication administration…</div>
        </Card>
      ) : (
        <MarCard
          rows={rows}
          patients={[patient]}
          busy={mar.busy}
          notices={mar.notices}
          onDocument={onDocument}
          onRetry={mar.retry}
          readOnly={!canDocument}
          emptyText="No active medication orders for this patient."
          dataAge={<DataAge at={mar.at} live label="MAR" what="This patient's medication administration rows" />}
        />
      )}
      <IoPanel patientId={patientId} idPrefix={`ncio-${patientId}`.replace(/[^A-Za-z0-9_-]/g, '-')} />
    </section>
  )
}

import { useEffect, useMemo, useState } from 'react'
import './NurseWorkspace.css'
import { AppHeader, type KpiSpec } from '../../components/AppHeader'
import { NavSidebar } from '../../components/NavSidebar'
import { dueStateFor, useNow } from '../../lib/time'
import { IconPencil, IconUsers } from '../../components/icons'
import { getHandoffEntries, getNurseWorklist, writeHandoff } from '../../lib/api'
import type { AdministrationAction, AssignedPatient, MineWorklist, HandoffEntry } from '../../lib/api/types'
import { getSession, initialsOf, profileOf } from '../../lib/session'
import { DataAge } from '../../components/DataAge'
import { usePollTick } from '../../hooks/useLive'
import { MarCard } from '../../features/nurse-care/MarCard'
import { useMarView, useNurseCare, useNursingQueue } from '../../features/nurse-care/NurseCareProvider'
import { AssignedPatientsCard } from './AssignedPatientsCard'
import { OrdersCard, implementCounts } from './OrdersCard'
import { IoCard } from './IoCard'
import { SbarCard, type SbarNote } from './SbarCard'

/* [ICU nursing/patient-chart update, 2026-10-15 — Session 3] The MAR's
   documentation logic (attempts, locks, settlement, safe retry, the read
   sequence, the 5 s recheck) moved UNCHANGED into the shared controller
   (src/features/nurse-care/marController.ts), mounted once per tab by
   NurseCareProvider so the patient chart documents through the same locks
   and a save in flight survives navigation. Orders to Implement follows the
   nursing ROUND contract (nursingController.ts); the Nursing Tasks card, its
   Tasks Open counter and the demo-only I&O worksheet are removed — I&O is the
   shared, persisted latest-values panel. */

/** Screen 4 — Nurse Workspace. RBAC (locked decision): administer + document
 *  only. No order origination anywhere on this screen. MAR and Orders to
 *  Implement are derived views over the canonical Order model (Screen 5). */
export function NurseWorkspace() {
  /* behind RequireSession(meds.administer) — session is present */
  const session = getSession()!
  const { showToast } = useNurseCare()
  /* the OPT-OUT worklist (Assignment Simplification): every nurse covers
     every patient by default — the list is ALL open patients minus this
     nurse's carved removals. No setup needed; no Unassigned panel exists
     (the server refuses removing the last covering nurse, so an
     uncovered patient is impossible, not merely visible). */
  const [worklist, setWorklist] = useState<{ mine: MineWorklist; patients: AssignedPatient[] } | null>(null)
  /* the SBAR handoff series per selected patient — REAL data from the
     append-only store (undefined = loading, null = unreachable). The
     old page-local Record<pid, note> that silently discarded every
     save on navigation is DELETED — the data-loss bug this replaces. */
  const [handoffs, setHandoffs] = useState<Record<string, HandoffEntry[] | null | undefined>>({})
  const [handoffBusy, setHandoffBusy] = useState(false)

  const loadHandoffs = (patientId: string) => {
    if (!patientId) return
    setHandoffs(prev => ({ ...prev, [patientId]: prev[patientId] ?? undefined }))
    getHandoffEntries(patientId).then(entries =>
      setHandoffs(prev => ({ ...prev, [patientId]: entries })))
  }

  /* LIVE (step 2): the assigned-patient worklist, its MAR rows and the
     implementation queue re-read on the shared poll tick — a dose given or
     an order placed at another station shows here without a reload. The
     MAR and queue reads (and their settlement) run in the shared
     controllers, scoped to this worklist. */
  const tick = usePollTick()
  const [listAt, setListAt] = useState<number | null>(null)
  useEffect(() => {
    getNurseWorklist(session.name, session.jobTitle).then(w => {
      setWorklist(w)
      setListAt(Date.now())
      const first = w.patients[0]?.patientId
      if (first) loadHandoffs(first)
    })
  }, [session.name, session.jobTitle, tick])

  const patients = worklist?.patients ?? []
  const ids = useMemo(() => (worklist ? worklist.patients.map(p => p.patientId) : null), [worklist])
  const patientName = (patientId: string) => patients.find(p => p.patientId === patientId)?.name ?? patientId

  /* MAR — the shared controller (locks per order, global across screens) */
  const mar = useMarView(ids, tick)
  const documentMar = (orderId: string, adminId: string, action: AdministrationAction, reason?: string, administeredAt?: string) => {
    const row = mar.rows?.find(r => r.orderId === orderId && r.adminId === adminId)
    if (row) mar.document(row, action, `${row.medication} · ${patientName(row.patientId)}`, reason, administeredAt)
  }

  /* Orders to Implement — nursing rounds (round identity + attempt id) */
  const queue = useNursingQueue(ids, tick)
  const completeOrder = (orderId: string) => {
    const o = queue.orders?.find(x => x.orderId === orderId)
    if (o) queue.done(o, `${o.summary} · ${patientName(o.patientId)}`)
  }

  /* append ONE immutable entry — the toast fires only on the server's
     confirmation (the old fixture toasted while saving nothing) */
  const saveSbar = async (patientId: string, note: SbarNote): Promise<boolean> => {
    setHandoffBusy(true)
    try {
      const res = await writeHandoff(patientId, note)
      if (res.kind === 'ok') {
        showToast('Handoff recorded', `${res.data.handoffId} · ${patientName(patientId)} · ${res.data.recordedAt}`)
        loadHandoffs(patientId)
        return true
      }
      showToast('Handoff NOT recorded', res.kind === 'rejected' ? res.error : 'the server is not reachable — nothing was saved')
      return false
    } finally {
      setHandoffBusy(false)
    }
  }

  const now = useNow()
  const medsDue = mar.rows?.filter(
    r => r.status === 'scheduled' && !r.prn && dueStateFor(r.scheduledTime, now) !== 'upcoming',
  ).length
  /* actionable work only — an upcoming round is not due work */
  const ordersDue = queue.orders ? implementCounts(queue.orders, now.getTime()).due : undefined

  const kpis: KpiSpec[] = [
    { icon: <IconUsers size={14} stroke="var(--blue)" />, iconBg: 'rgba(var(--blue-rgb),.15)', value: worklist ? patients.length : '—', label: 'My Patients' },
    {
      icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--cyan)" strokeWidth="2" strokeLinecap="round"><rect x="7" y="2" width="10" height="20" rx="4" /><path d="M7 9h10M7 15h10" /></svg>,
      iconBg: 'rgba(var(--cyan-rgb),.13)', value: medsDue ?? '—', label: 'Meds Due',
      valueStyle: medsDue ? { color: 'var(--amber)' } : undefined,
    },
    { icon: <IconPencil size={14} stroke="var(--amber)" />, iconBg: 'rgba(var(--amber-rgb),.14)', value: ordersDue ?? '—', label: 'Orders Due' },
  ]

  return (
    <div className="app-frame nw">
      <AppHeader
        subtitle="Nurse Workspace"
        kpis={kpis}
        user={{ initials: initialsOf(session.name), name: session.name, role: `${session.jobTitle} · ${profileOf(session.jobTitle)} profile` }}
        dataAge={<DataAge at={listAt} live label="Lists" what="The assigned-patient worklist, MAR rows and implementation queue" />}
      />
      <div className="shell">
        <NavSidebar
          active="dashboard"
          alertCount={3}
          footerLines={['Role: Nurse profile', 'Administer + document only']}
        />
        <main>
          <div className="col">
            {worklist && <AssignedPatientsCard patients={patients} />}
            {mar.rows && worklist && <MarCard rows={mar.rows} patients={patients} busy={mar.busy} notices={mar.notices} onDocument={documentMar} onRetry={mar.retry} />}
            {worklist && <IoCard patients={patients} />}
          </div>
          <div className="col">
            {queue.orders && <OrdersCard orders={queue.orders} busy={queue.busy} notices={queue.notices} onDone={o => completeOrder(o.orderId)} onRetry={queue.retry} />}
            {worklist && <SbarCard patients={patients} entriesByPatient={handoffs} busy={handoffBusy} onSelect={loadHandoffs} onSave={saveSbar} />}
          </div>
        </main>
      </div>
    </div>
  )
}

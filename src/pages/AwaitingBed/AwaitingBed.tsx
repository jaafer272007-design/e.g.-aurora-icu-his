import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import './AwaitingBed.css'
import { AppHeader, type KpiSpec } from '../../components/AppHeader'
import { NavSidebar } from '../../components/NavSidebar'
import { Card } from '../../components/Card'
import { DataAge } from '../../components/DataAge'
import { Toast, useToast } from '../../components/Toast'
import { IconBed, IconUsers } from '../../components/icons'
import { assignBed, getAdtBeds, getEncounters } from '../../lib/api'
import type { AdtBed, Encounter } from '../../lib/api/types'
import { getSession, hasPermission, initialsOf, profileOf } from '../../lib/session'
import { usePollTick } from '../../hooks/useLive'
import { displayStamp } from '../../lib/time'

/** Ward — the AWAITING-BED list (/awaiting-bed, Ward PR A2; design §3.2).
 *
 *  DERIVED, NEVER STORED: every row is simply an OPEN encounter whose
 *  BedId is empty, read straight from GET /adt/encounters?bedless=true
 *  (Ward PR A1's filter — the open half is part of the server filter's
 *  meaning). There is no awaiting-bed status, no queue object, and no
 *  client-side copy to maintain: after a successful assignment the next
 *  read simply no longer contains the row, because the state it derives
 *  from (the encounter's bed) changed.
 *
 *  THE ONE ACTION IS ASSIGNMENT, NOT TRANSFER (§3.1): the button calls
 *  POST /adt/encounters/{id}/assign-bed — a bedless patient has no bed to
 *  transfer from, and the server enforces the partition from both sides
 *  (a bedded encounter is refused here; a bedless one is refused at
 *  /transfer). Free beds come from the same active-and-unoccupied
 *  computation the transfer picker uses; a stale pick (occupied or
 *  retired between read and submit) is REFUSED server-side and the
 *  server's own {error} renders on the row — the UI never pre-judges
 *  what only the server can decide.
 *
 *  WHO IS HERE (§6): the route is gated on beds.assign — the office
 *  Administrator (receptionist) and the Nurse profile, the same two
 *  people who can act on a row. Server authorization stays authoritative:
 *  a 403 (or any refusal) coming back anyway is rendered verbatim as the
 *  row's error, never swallowed.
 *
 *  DAY CASES SIT HERE UNTIL DISCHARGED — §2.1 records that as expected
 *  behaviour, not a bug: the day-case area is outside ward scope, so a
 *  day-case admission legitimately waits on this list until its same-day
 *  discharge closes it. Do not "fix" it with a filter.
 *
 *  Identity on a row is what the admission actually recorded — a clerk's
 *  bedless admission legitimately has no diagnosis and no attending, and
 *  absent stays absent (§5: never fabricate). */
export function AwaitingBed() {
  const navigate = useNavigate()
  const { toast, showToast } = useToast()
  const session = getSession()!
  /* opening the clinical record is results.view (the Discharges rule: the
     office Administrator is identity-tier — the name stays plain for them,
     a link that 403s is never offered) */
  const canHistory = hasPermission(session.jobTitle, 'results.view')

  const [rows, setRows] = useState<Encounter[] | null>(null)
  const [rowsAt, setRowsAt] = useState<number | null>(null)
  const [beds, setBeds] = useState<AdtBed[] | null>(null)
  const [assignId, setAssignId] = useState<string | null>(null)
  const [targetBed, setTargetBed] = useState('')
  const [busy, setBusy] = useState(false)
  const [rowError, setRowError] = useState<{ id: string; error: string } | null>(null)

  const reload = useCallback(() => {
    getEncounters({ bedless: true }).then(r => { setRows(r); setRowsAt(Date.now()) }).catch(() => { setRows(null); setRowsAt(null) })
    getAdtBeds().then(setBeds).catch(() => setBeds(null))
  }, [])
  const tick = usePollTick()
  useEffect(() => { reload() }, [reload, tick])

  /* the same ACTIVE-and-free computation the transfer picker uses — a
     retired or occupied bed leaves the picker; the server refuses either
     regardless (409), and that refusal renders on the row */
  const freeBeds = useMemo(() => (beds ?? []).filter(b => b.active && !b.patientId), [beds])

  const kpis: KpiSpec[] = [
    { icon: <IconUsers size={14} stroke="var(--amber)" />, iconBg: 'rgba(var(--amber-rgb),.14)', value: rows?.length ?? '—', label: 'Awaiting Bed' },
    { icon: <IconBed size={14} stroke="var(--green)" />, iconBg: 'rgba(var(--green-rgb),.13)', value: beds ? freeBeds.length : '—', label: 'Beds Free' },
  ]

  async function doAssign(encounterId: string) {
    if (!targetBed) return
    setBusy(true); setRowError(null)
    const res = await assignBed(encounterId, targetBed)
    setBusy(false)
    if (res.kind === 'ok') {
      showToast('Bed assigned', `${res.data.patientName} — bed ${res.data.bedId} assigned`)
      setAssignId(null); setTargetBed('')
      /* no client-side queue to edit: the list re-derives from the server,
         and the assigned encounter is simply no longer bedless */
      reload()
    } else if (res.kind === 'rejected') {
      /* the server's own {error} verbatim — occupied, retired, closed,
         already-bedded, or a 403: the four-code message is the truth and
         the UI does not paraphrase it */
      setRowError({ id: encounterId, error: res.error })
      reload()
    } else {
      setRowError({ id: encounterId, error: 'ADT requires the live server — the bed was NOT assigned' })
    }
  }

  return (
    <div className="app-frame awb">
      <AppHeader
        subtitle="Awaiting Bed · Ward"
        kpis={kpis}
        user={{ initials: initialsOf(session.name), name: session.name, role: `${session.jobTitle} · ${profileOf(session.jobTitle)} profile` }}
      />
      <div className="shell">
        <NavSidebar active="awaiting" footerLines={[`Role: ${profileOf(session.jobTitle)} profile`, 'Ward · Aurora Core']} />

        <main>
          <Card
            icon={<IconBed size={15} stroke="var(--amber)" />}
            title="Patients Awaiting a Bed"
            aside={<DataAge at={rowsAt} live what="The awaiting-bed list" />}
          >
            <div className="awbrows">
              {(rows ?? []).map(e => (
                <div className="awbrow" key={e.encounterId}>
                  <div className="awbmain">
                    <span className="awbtag">Awaiting bed</span>
                    {canHistory ? (
                      <button className="awbwho" onClick={() => navigate(`/patients/${e.patientId}/history`)} aria-label={`Open record: ${e.patientName}`}>
                        <b>{e.patientName}</b>
                        {e.diagnosis && <small>{e.diagnosis}</small>}
                      </button>
                    ) : (
                      <span className="awbwho asplain">
                        <b>{e.patientName}</b>
                        {e.diagnosis && <small>{e.diagnosis}</small>}
                      </span>
                    )}
                    <span className="awbmeta">
                      <span className="num">{e.patientId} · {e.encounterId}</span>
                      <small>{e.admittedAt ? `admitted ${displayStamp(e.admittedAt)}` : 'admission time not recorded'}{e.admittedBy ? ` · by ${e.admittedBy}` : ''}</small>
                    </span>
                    <span className="awbacts">
                      <button className="awbact" onClick={() => { setAssignId(assignId === e.encounterId ? null : e.encounterId); setTargetBed(''); setRowError(null) }}>
                        Assign bed
                      </button>
                    </span>
                  </div>
                  {assignId === e.encounterId && (
                    <div className="awbconfirm" role="dialog" aria-label="Bed assignment selection">
                      <span>Assign <b>{e.patientName}</b> to:</span>
                      <select value={targetBed} onChange={ev => setTargetBed(ev.target.value)} aria-label="Free bed">
                        <option value="" disabled>Free bed…</option>
                        {freeBeds.map(b => <option key={b.bedId} value={b.bedId}>{b.bedId} · {b.wardLabel ?? b.area}</option>)}
                      </select>
                      <button className="awbact primary" disabled={!targetBed || busy} onClick={() => doAssign(e.encounterId)}>
                        {busy ? 'Assigning…' : 'Confirm assignment'}
                      </button>
                      <button className="awbact" onClick={() => { setAssignId(null); setTargetBed('') }}>Cancel</button>
                    </div>
                  )}
                  {rowError?.id === e.encounterId && <div className="awberr" role="alert">{rowError.error}</div>}
                </div>
              ))}
              {rows !== null && rows.length === 0 && <div className="awbempty">No patients awaiting a bed.</div>}
              {rows === null && <div className="awbempty">Awaiting-bed list not read — the list requires the live server.</div>}
            </div>
          </Card>
        </main>
      </div>
      <Toast state={toast} accent="amber" />
    </div>
  )
}

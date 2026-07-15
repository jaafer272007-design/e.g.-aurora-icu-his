import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import './Discharges.css'
import { AppHeader, type KpiSpec } from '../../components/AppHeader'
import { NavSidebar } from '../../components/NavSidebar'
import { Card } from '../../components/Card'
import { BedChip } from '../../components/Tag'
import { Toast, useToast } from '../../components/Toast'
import { IconBed, IconDischarge, IconUsers } from '../../components/icons'
import { DISPOSITIONS, dischargeEncounter, dispositionLabel, getAdtBeds, getEncounters, transferEncounter } from '../../lib/api'
import type { AdtBed, DispositionCode, Encounter } from '../../lib/api/types'
import { getSession, hasPermission, initialsOf, profileOf } from '../../lib/session'
import { displayStamp } from '../../lib/time'

/** Layer 2 — ADT Discharges & Transfers (/discharges). Discharge closes the
 *  Encounter and frees the bed (doctor authority, adt.discharge); transfer
 *  moves the open Encounter to a different FREE bed (nursing action,
 *  adt.transfer — doctors cannot transfer, mirroring implement/MAR).
 *  Profiles see only the actions their permissions grant. Writes are
 *  REAL-ONLY — ADT is the durable system of record. */
export function Discharges() {
  const navigate = useNavigate()
  const { toast, showToast } = useToast()
  const session = getSession()!
  const canDischarge = hasPermission(session.jobTitle, 'adt.discharge')
  const canTransfer = hasPermission(session.jobTitle, 'adt.transfer')

  const [open, setOpen] = useState<Encounter[] | null>(null)
  const [discharged, setDischarged] = useState<Encounter[] | null>(null)
  const [beds, setBeds] = useState<AdtBed[] | null>(null)
  const [confirmId, setConfirmId] = useState<string | null>(null)
  /* discharge disposition — the stay's OUTCOME, REQUIRED before confirm
     (the server stores it on the encounter; mortality derives from it) */
  const [disposition, setDisposition] = useState<DispositionCode | ''>('')
  const [transferId, setTransferId] = useState<string | null>(null)
  const [targetBed, setTargetBed] = useState('')
  const [busy, setBusy] = useState(false)
  const [rowError, setRowError] = useState<{ id: string; error: string } | null>(null)

  const reload = useCallback(() => {
    getEncounters({ status: 'open' }).then(setOpen)
    getEncounters({ status: 'discharged' }).then(d => setDischarged(d.slice().reverse()))
    getAdtBeds().then(setBeds)
  }, [])
  useEffect(() => { reload() }, [reload])

  const freeBeds = useMemo(() => (beds ?? []).filter(b => !b.patientId), [beds])

  const kpis: KpiSpec[] = [
    { icon: <IconUsers size={14} stroke="var(--blue)" />, iconBg: 'rgba(var(--blue-rgb),.15)', value: open?.length ?? '—', label: 'Open Encounters' },
    { icon: <IconDischarge size={14} stroke="var(--amber)" />, iconBg: 'rgba(var(--amber-rgb),.14)', value: discharged?.length ?? '—', label: 'Discharged (all time)' },
    { icon: <IconBed size={14} stroke="var(--green)" />, iconBg: 'rgba(var(--green-rgb),.13)', value: beds ? freeBeds.length : '—', label: 'Beds Free' },
  ]

  async function doDischarge(encounterId: string) {
    if (!disposition) return
    setBusy(true); setRowError(null)
    const res = await dischargeEncounter(encounterId, disposition)
    setBusy(false); setConfirmId(null); setDisposition('')
    if (res.kind === 'ok') {
      showToast('Discharged', `${res.data.patientName} discharged (${dispositionLabel(res.data.disposition) || 'disposition not recorded'}) — ${res.data.bedId} is now free`)
      reload()
    } else if (res.kind === 'rejected') {
      setRowError({ id: encounterId, error: res.error })
    } else {
      setRowError({ id: encounterId, error: 'ADT requires the live server — the discharge was NOT recorded' })
    }
  }

  async function doTransfer(encounterId: string) {
    if (!targetBed) return
    setBusy(true); setRowError(null)
    const res = await transferEncounter(encounterId, targetBed)
    setBusy(false)
    if (res.kind === 'ok') {
      showToast('Transferred', `${res.data.patientName} moved to ${res.data.bedId}`)
      setTransferId(null); setTargetBed('')
      reload()
    } else if (res.kind === 'rejected') {
      setRowError({ id: encounterId, error: res.error })
    } else {
      setRowError({ id: encounterId, error: 'ADT requires the live server — the transfer was NOT recorded' })
    }
  }

  return (
    <div className="app-frame dis">
      <AppHeader
        subtitle="Discharges & Transfers · ADT"
        kpis={kpis}
        user={{ initials: initialsOf(session.name), name: session.name, role: `${session.jobTitle} · ${profileOf(session.jobTitle)} profile` }}
      />
      <div className="shell">
        <NavSidebar active="discharges" footerLines={[`Role: ${profileOf(session.jobTitle)} profile`, 'ADT · Aurora Core']} />

        <main>
          {!canDischarge && !canTransfer && (
            <div className="disnote" role="note">
              View only — discharge requires doctor-level authority (adt.discharge); transfer is a nursing action (adt.transfer).
            </div>
          )}

          <div className="discols">
            <Card icon={<IconUsers size={15} stroke="var(--blue)" />} title="Open Encounters" aside={open ? `${open.length} admitted` : '—'}>
              <div className="disrows">
                {(open ?? []).map(e => (
                  <div className="disrow" key={e.encounterId}>
                    <div className="dismain">
                      <BedChip bedId={e.bedId} />
                      <button className="diswho" onClick={() => navigate(`/patients/${e.patientId}`)} aria-label={`Open chart: ${e.patientName}`}>
                        <b>{e.patientName}</b>
                        <small>{e.diagnosis}</small>
                      </button>
                      <span className="dismeta">
                        <span className="num">{e.encounterId}</span>
                        <small>{e.attending}{e.admittedAt ? ` · admitted ${displayStamp(e.admittedAt)}` : ''}</small>
                      </span>
                      <span className="disacts">
                        {canTransfer && (
                          <button className="disact" onClick={() => { setTransferId(transferId === e.encounterId ? null : e.encounterId); setTargetBed(''); setRowError(null) }}>
                            Transfer
                          </button>
                        )}
                        {canDischarge && (
                          <button className="disact warn" onClick={() => { setConfirmId(confirmId === e.encounterId ? null : e.encounterId); setDisposition(''); setRowError(null) }}>
                            Discharge
                          </button>
                        )}
                      </span>
                    </div>
                    {confirmId === e.encounterId && (
                      <div className="disconfirm" role="alertdialog" aria-label="Confirm discharge">
                        <span>Close encounter <b className="num">{e.encounterId}</b> and free <b>{e.bedId}</b>?</span>
                        {/* the stay's OUTCOME — required before confirm; stored on
                            the encounter (unlocks honest mortality tracking) */}
                        <select value={disposition} onChange={ev => setDisposition(ev.target.value as DispositionCode | '')} aria-label="Discharge disposition">
                          <option value="" disabled>Disposition…</option>
                          {DISPOSITIONS.map(d => <option key={d.code} value={d.code}>{d.label}</option>)}
                        </select>
                        <button className="disact warn" disabled={!disposition || busy} onClick={() => doDischarge(e.encounterId)}>
                          {busy ? 'Discharging…' : 'Confirm discharge'}
                        </button>
                        <button className="disact" onClick={() => { setConfirmId(null); setDisposition('') }}>Cancel</button>
                      </div>
                    )}
                    {transferId === e.encounterId && (
                      <div className="disconfirm" role="dialog" aria-label="Transfer bed selection">
                        <span>Move <b>{e.patientName}</b> from <b>{e.bedId}</b> to:</span>
                        <select value={targetBed} onChange={ev => setTargetBed(ev.target.value)} aria-label="Target bed">
                          <option value="" disabled>Free bed…</option>
                          {freeBeds.map(b => <option key={b.bedId} value={b.bedId}>{b.bedId} · {b.area}</option>)}
                        </select>
                        <button className="disact" disabled={!targetBed || busy} onClick={() => doTransfer(e.encounterId)}>
                          {busy ? 'Transferring…' : 'Confirm transfer'}
                        </button>
                        <button className="disact" onClick={() => { setTransferId(null); setTargetBed('') }}>Cancel</button>
                      </div>
                    )}
                    {rowError?.id === e.encounterId && <div className="diserr" role="alert">{rowError.error}</div>}
                  </div>
                ))}
              </div>
            </Card>

            <Card icon={<IconDischarge size={15} stroke="var(--amber)" />} title="Recently Discharged" aside="closed encounters — durable record">
              <div className="disrows">
                {(discharged ?? []).slice(0, 12).map(e => (
                  <div className="disrow done" key={e.encounterId}>
                    <div className="dismain">
                      <BedChip bedId={e.bedId} />
                      <span className="diswho asplain">
                        <b>{e.patientName}</b>
                        <small>{e.diagnosis}</small>
                      </span>
                      <span className="dismeta">
                        <span className="num">{e.encounterId}</span>
                        <small>{e.dischargedAt ? `discharged ${displayStamp(e.dischargedAt)} · ${e.dischargedBy}` : 'discharged'}</small>
                        {/* honest outcome display: pre-feature discharges have
                            none recorded — never fabricated */}
                        <small>{dispositionLabel(e.disposition) || 'disposition not recorded'}</small>
                      </span>
                    </div>
                  </div>
                ))}
                {discharged?.length === 0 && <div className="disempty">No discharged encounters yet.</div>}
              </div>
            </Card>
          </div>
        </main>
      </div>
      <Toast state={toast} accent="amber" />
    </div>
  )
}

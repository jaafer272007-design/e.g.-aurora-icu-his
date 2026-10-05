import { useEffect, useRef, useState } from 'react'
import type { MouseEvent, ReactNode } from 'react'
import { Card } from '../../components/Card'
import { BedChip } from '../../components/Tag'
import {
  LATE_THRESHOLD_MINUTES, datedEpoch, displayStamp, dueStateFor, formatHm, hmOf, localStamp, minutesPastStamp,
  stampDiffMinutes, useNow, wireStampOfLocal,
} from '../../lib/time'
import { dayLabel, groupMarDays, isActionable, isEligibleNow, stampOnCard, unlocksAt, type MarDayCard } from './marDays'
import type { AdministrationAction, AssignedPatient, MarRow } from '../../lib/api/types'

const DOCUMENTED_META: Record<AdministrationAction, { label: string; cls: string }> = {
  given: { label: 'GIVEN', cls: 'st-given' },
  held: { label: 'HELD', cls: 'st-held' },
  refused: { label: 'REFUSED', cls: 'st-refused' },
}

const PENDING_META = {
  overdue: { label: 'OVERDUE', cls: 'st-overdue' },
  due: { label: 'DUE', cls: 'st-due' },
  /* within the due-soon window but before the scheduled time: locked */
  soon: { label: 'DUE SOON', cls: 'st-due' },
  upcoming: { label: 'LATER', cls: 'st-upcoming' },
  prn: { label: 'PRN', cls: 'st-prn' },
  /* an order whose frequency has no derivable dose grid (continuous,
     sliding scale, per protocol…) — the honest-source rule: the row says
     so instead of inventing a schedule; doses are documented on demand */
  ondemand: { label: 'ON DEMAND', cls: 'st-prn' },
}

/* the render-horizon summary: undocumented instances older than the
   window, counted out loud — never silently truncated */
const MISSED_META = { label: 'MISSED', cls: 'st-overdue' }

/** what the card shows for an order with a documentation in progress */
export interface MarBusy {
  phase: 'saving' | 'checking' | 'unconfirmed'
  action: AdministrationAction
  /** the documented minute, display clock */
  at: string
}

interface MarCardProps {
  rows: MarRow[]
  patients: AssignedPatient[]
  /** orders with a documentation saving, awaiting the server read that
   *  settles it, or UNCONFIRMED (no answer — SAFE RETRY, ### F) — every
   *  documenting control of that order is disabled meanwhile */
  busy: ReadonlyMap<string, MarBusy>
  /** the last refusal per order, shown on its current row */
  notices: Record<string, string>
  onDocument: (orderId: string, adminId: string, action: AdministrationAction, reason?: string, administeredAt?: string) => void
  /** re-send the order's UNCONFIRMED attempt — the same documentation, never a new dose */
  onRetry: (orderId: string) => void
}

type ReasonAction = 'held' | 'refused' | 'given-late'

/* Held/Refused require a documented reason (validated server-side like a
   discontinue). Given is one click ON TIME; a dose more than
   LATE_THRESHOLD_MINUTES past its scheduled instant opens this prompt in
   'given-late' mode instead (the overdue-delay-reason safety fix,
   server-enforced): the SAME reason pattern held/refused already use,
   plus the actual administration time — auto-filled with the current
   wall-clock time, editable (the #145 editable-timestamp pattern),
   converted to the UTC wire on confirm. The dose is never blocked. */
function MarReasonDialog(
  { row, action, lateLabel, locked, onCancel, onConfirm }:
  {
    row: MarRow; action: ReasonAction; lateLabel?: string
    /** the dose can no longer be documented from this dialog (a save is
     *  running for its order, or it is not open yet) */
    locked: boolean
    onCancel: () => void; onConfirm: (reason: string, administeredAt?: string) => void
  },
) {
  const [reason, setReason] = useState('')
  /* the confirm fires ONCE — a double click cannot submit twice */
  const sent = useRef(false)
  const [givenAt, setGivenAt] = useState(() => localStamp(Date.now()))
  const taRef = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    taRef.current?.focus()
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel() }
    document.addEventListener('keydown', esc)
    return () => document.removeEventListener('keydown', esc)
  }, [onCancel])
  const title = action === 'held' ? 'Hold dose' : action === 'refused' ? 'Refuse dose' : 'Give overdue dose'
  return (
    <div className="marscrim" onClick={onCancel}>
      <div className="mardialog" role="dialog" aria-modal="true" aria-labelledby="marRTitle" onClick={e => e.stopPropagation()}>
        <h2 id="marRTitle">{title} · <span className="num">{row.medication} {row.dose}</span></h2>
        {action === 'given-late' && (
          <p className="marlatehint" role="note">
            Scheduled <span className="num">{displayStamp(row.scheduledTime)}</span> — {lateLabel} overdue.
            The dose can still be given; document why it is late.
          </p>
        )}
        <div className="field">
          <label htmlFor="marReason">{action === 'given-late' ? 'Reason for the delay (required)' : 'Reason (required)'}</label>
          <textarea
            ref={taRef} id="marReason" value={reason}
            placeholder={action === 'held' ? 'e.g. SBP 82 — holding per parameters…'
              : action === 'refused' ? 'e.g. Patient declined — nausea…'
              : 'e.g. Patient off the floor for CT — given on return…'}
            onChange={e => setReason(e.target.value)}
          />
        </div>
        {action === 'given-late' && (
          <div className="field">
            <label htmlFor="marGivenAt">Actual administration time (editable)</label>
            <input
              id="marGivenAt" className="num" value={givenAt}
              onChange={e => setGivenAt(e.target.value)}
            />
          </div>
        )}
        <div className="mardfoot">
          <button className="btn ghost" onClick={onCancel}>Cancel</button>
          <button className={`btn ${action === 'refused' ? 'danger' : 'primary'}`} disabled={!reason.trim() || locked}
            onClick={e => {
              if (sent.current || locked || e.detail > 1) return
              sent.current = true
              onConfirm(reason.trim(),
              /* typed as WALL TIME on the display clock; the wire stays
                 UTC — a malformed shape passes through raw so the
                 server's validation message stays the messenger */
              action === 'given-late' ? (wireStampOfLocal(givenAt.trim()) ?? givenAt.trim()) : undefined)
            }}>
            {action === 'held' ? '⊘ Hold dose' : action === 'refused' ? '✕ Refuse dose' : '✓ Give dose (late)'}
          </button>
        </div>
      </div>
    </div>
  )
}

/** "in 42 min" / "in 2 h 05 min" until an unlock */
const untilLabel = (ms: number): string => {
  const min = Math.ceil(ms / 60_000)
  if (min < 1) return 'in under a minute'
  return min < 60 ? `in ${min} min` : `in ${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')} min`
}

/** Medication Administration Record — a derived view over the canonical
 *  Order model (administrations of ACTIVE medication orders). Nurse RBAC:
 *  administer + document ONLY; every action is a documentation event on the
 *  order's audit history. Due states are computed against the clock.
 *  DAILY PRESCRIPTION CARDS (2026-10-04, marDays.ts): under each patient the
 *  rows are grouped into one card per prescription per hospital day — a
 *  presentation of the same rows; the actions, the dialog and the due
 *  count are unchanged and still bound to each row's orderId + adminId. */
export function MarCard({ rows, patients, busy, notices, onDocument, onRetry }: MarCardProps) {
  /* ONE ACTION PER ROUND (owner's correction, 2026-10-05): the shared
     30-second clock, plus an exact wake-up at the next scheduled unlock so
     a round's controls open at its scheduled time, not up to 30 s later */
  const tickNow = useNow()
  const [unlockTick, setUnlockTick] = useState(0)
  const nowMs = Math.max(tickNow.getTime(), unlockTick)
  const now = new Date(nowMs)
  const nextUnlock = rows.reduce<number | null>((soonest, r) => {
    const at = unlocksAt(r)
    return at !== null && at > nowMs && (soonest === null || at < soonest) ? at : soonest
  }, null)
  useEffect(() => {
    if (nextUnlock === null) return
    const t = window.setTimeout(() => setUnlockTick(Date.now()), Math.min(Math.max(0, nextUnlock - Date.now() + 25), 3_600_000))
    return () => window.clearTimeout(t)
  }, [nextUnlock, unlockTick])
  const [pending, setPending] = useState<{ row: MarRow; action: ReasonAction } | null>(null)
  /* a reason dialog whose dose is no longer the current row (documented
     meanwhile — here or at another station) closes: it cannot submit */
  useEffect(() => {
    if (pending && !rows.some(r => r.orderId === pending.row.orderId && r.adminId === pending.row.adminId && isActionable(r)))
      setPending(null)
  }, [rows, pending])
  /* historical cards the nurse opened, by STABLE card key — survives the
     poll's fresh rows (keys are patient|order|day, never row identity) */
  const [openKeys, setOpenKeys] = useState<Set<string>>(() => new Set())
  const toggle = (key: string) => setOpenKeys(prev => {
    const next = new Set(prev)
    if (next.has(key)) next.delete(key); else next.add(key)
    return next
  })
  /* the delay-reason trigger — minutes a DATED scheduled instance is past
     its instant (PRN/on-demand rows have no schedule and are never late);
     mirrors the server's enforcement threshold exactly */
  const lateMinutes = (r: MarRow): number =>
    r.prn || r.scheduleNote ? 0 : (minutesPastStamp(r.scheduledTime, now) ?? 0)
  const lateLabelOf = (mins: number) => `${Math.floor(mins / 60)}h ${String(Math.floor(mins % 60)).padStart(2, '0')}m`
  const stateOf = (r: MarRow) =>
    r.status === 'missed-earlier'
      ? MISSED_META
      : r.status !== 'scheduled'
        ? DOCUMENTED_META[r.status]
        : r.prn ? PENDING_META.prn
          : r.scheduleNote ? PENDING_META.ondemand
            /* the due-soon reminder of a round that is not open yet says
               so — it is a reminder, not permission */
            : !isEligibleNow(r, nowMs) && dueStateFor(r.scheduledTime, now) === 'due' ? PENDING_META.soon
              : PENDING_META[dueStateFor(r.scheduledTime, now)]
  /* unchanged: counted over the actionable ROWS, never over cards */
  const dueCount = rows.filter(
    r => r.status === 'scheduled' && !r.prn && dueStateFor(r.scheduledTime, now) !== 'upcoming',
  ).length
  const jumpTo = (domId: string) => {
    const el = document.getElementById(domId)
    el?.scrollIntoView({ block: 'nearest' })
    el?.focus()
  }

  /* one compact round row — read-only unless it is the actionable row */
  const roundRow = (r: MarRow, card: MarDayCard, patientName: string): ReactNode => {
    const meta = stateOf(r)
    const scheduled = datedEpoch(r.scheduledTime) !== null
      ? formatHm(hmOf(r.scheduledTime))
      : r.scheduledTime ? displayStamp(r.scheduledTime) : '—'
    const docMs = datedEpoch(r.documentedTime ?? '')
    const current = isActionable(r)
    const unlock = unlocksAt(r)
    const open = isEligibleNow(r, nowMs)
    const saving = busy.get(r.orderId)
    const locked = !open || saving !== undefined
    const lockId = `${r.orderId}-${r.adminId}-lock`.replace(/[^A-Za-z0-9_-]/g, '-')
    /* the click is re-checked against the real clock and the busy state —
       never only the last render — and the 2nd/3rd click of a double or
       triple click is ignored (event.detail = the click count): a fast
       save can finish between the clicks of one double click, and an
       on-demand / PRN row is open again once it has */
    const act = (fn: () => void) => (e: MouseEvent) => {
      if (e.detail > 1 || !isEligibleNow(r, Date.now()) || busy.has(r.orderId)) return
      fn()
    }
    return (
      <div className={`marrow ${meta.cls}`} key={`${r.orderId}-${r.adminId}`}>
        <span className="martime num" title={datedEpoch(r.scheduledTime) !== null ? `scheduled ${localStamp(datedEpoch(r.scheduledTime)!)} (hospital time)` : undefined}>{scheduled}</span>
        <div className="marmed">
          <div className="mn">
            {r.round ? <span className="marround">round {r.round}</span> : <span className="markind">{r.prn ? 'PRN' : r.scheduleNote ? 'on demand' : 'dose'}</span>}
          </div>
          {r.status === 'missed-earlier' ? (
            <div className="mroute">⚠ {r.missedEarlier} earlier expected dose{(r.missedEarlier ?? 0) > 1 ? 's' : ''} never documented (oldest shown)</div>
          ) : r.status === 'scheduled' ? (
            <div className="mroute">
              {r.scheduleNote ?? (r.prn ? 'available as required'
                /* the order's first dose is open on signing (### F) */
                : r.firstDose ? `first dose — available now (scheduled ${scheduled})` : 'current round')}
              {/* why the current round is due when it is: the previous
                  round's GIVEN time, or its scheduled time when it was
                  held/refused (the rolling timer) */}
              {r.timerFrom && (
                <span className="martimer">
                  {' '}· timed from the {r.timerRule === 'given' ? 'dose given' : 'skipped dose due'} {stampOnCard(r.timerFrom, card.day)}
                </span>
              )}
            </div>
          ) : (
            <div className="mardoc num" title={docMs !== null ? `${localStamp(docMs)} (hospital time)` : undefined}>
              {/* GIVEN: the recorded actual administration time. HELD /
                  REFUSED: no dose was given — the stamp is when it was
                  documented, and says so */}
              {r.status === 'given' ? 'given at ' : `${r.status} · documented `}
              {stampOnCard(r.documentedTime, card.day) || '—'}
              {r.status === 'given'
                && (stampDiffMinutes(r.scheduledTime, r.documentedTime) ?? 0) > LATE_THRESHOLD_MINUTES
                && <span className="marlate">LATE</span>}
              {r.reason && <span className="marreason">— {r.reason}</span>}
            </div>
          )}
        </div>
        <span className={`marstate ${meta.cls}`}>{meta.label}</span>
        {current && (
          <div className="maracts" role="group" aria-label={`Document ${r.medication} for ${patientName}`}>
            {/* ON TIME: one click. Past the late threshold the SAME button
                opens the delay-reason prompt — the dose is never blocked,
                the lateness gets a documented reason (server-enforced).
                ONE ACTION PER ROUND: all three are disabled until the
                round's scheduled time, and while its order saves */}
            <button className="mab given" disabled={locked} aria-describedby={locked ? lockId : undefined}
              onClick={act(() => (lateMinutes(r) > LATE_THRESHOLD_MINUTES
                ? setPending({ row: r, action: 'given-late' })
                : void onDocument(r.orderId, r.adminId, 'given')))}
              aria-label={`${r.medication}: given`}>✓ Given</button>
            <button className="mab held" disabled={locked} aria-describedby={locked ? lockId : undefined}
              onClick={act(() => setPending({ row: r, action: 'held' }))} aria-label={`${r.medication}: held`}>⊘ Held</button>
            <button className="mab refused" disabled={locked} aria-describedby={locked ? lockId : undefined}
              onClick={act(() => setPending({ row: r, action: 'refused' }))} aria-label={`${r.medication}: refused`}>✕ Refused</button>
          </div>
        )}
        {current && (locked || notices[r.orderId]) && (
          <div className="marlockline" id={lockId}>
            {saving?.phase === 'saving' ? <span className="marbusy">Saving…</span>
              : saving?.phase === 'checking' ? <span className="marbusy">Checking the record — the controls reopen once the server confirms</span>
                : saving?.phase === 'unconfirmed' ? (
                  /* SAFE RETRY (### F): no answer — the documentation may
                     already be saved. Only the record settles it; the
                     retry re-sends the SAME documentation */
                  <span className="marwarn" role="status">
                    ⚠ Not confirmed — your {saving.action} documentation ({saving.at}) may already be saved; checking the record.{' '}
                    <button type="button" className="marretry" onClick={e => { if (e.detail <= 1) onRetry(r.orderId) }}>
                      Retry saving
                    </button>
                    {' '}(sends the same documentation — it can never be recorded twice)
                  </span>
                )
                : !open && unlock !== null
                  ? <span className="marlock">🔒 Opens {stampOnCard(r.scheduledTime, card.day)} ({untilLabel(unlock - nowMs)}) — one action per round</span>
                  : null}
            {notices[r.orderId] && <span className="marnotice" role="alert">{notices[r.orderId]}</span>}
          </div>
        )}
      </div>
    )
  }

  const summaryOf = (c: MarDayCard): string => {
    const n = (s: MarRow['status']) => c.rows.filter(r => r.status === s).length
    const parts = ([['given', n('given')], ['held', n('held')], ['refused', n('refused')]] as const)
      .filter(([, k]) => k > 0).map(([l, k]) => `${k} ${l}`)
    return parts.join(' · ') || (c.rows.length ? '' : 'no doses this day yet')
  }

  return (
    <Card
      icon={<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--cyan)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="7" y="2" width="10" height="20" rx="4" /><path d="M7 9h10M7 15h10" /></svg>}
      title="Medication Administration Record"
      aside={`${dueCount} due · administer & document only`}
    >
      {patients.map(p => {
        const mine = rows.filter(r => r.patientId === p.patientId)
        if (!mine.length) return null
        const cards = groupMarDays(mine, now.getTime())
        return (
          <div className="margroup" key={p.patientId}>
            <div className="marpt"><BedChip bedId={p.bedId} /><b>{p.name}</b><span className="marallergy">⚠ {p.allergies}</span></div>
            {cards.map(c => {
              const open = c.pinnedOpen || openKeys.has(c.key)
              const bodyId = `${c.domId}-body`
              const head = (
                <>
                  <span className="mdhead">
                    <span className="mn">{c.medication} <span className="mdose num">{c.dose}</span></span>
                    <span className="mroute">{c.route}</span>
                  </span>
                  <span className={`mddate num${c.relation === 'today' ? ' today' : ''}`}>{dayLabel(c)}</span>
                  {!open && <span className="mdsum">{summaryOf(c)}</span>}
                </>
              )
              return (
                <section
                  className={`mardaycard${open ? ' open' : ''}${c.pinnedOpen ? ' pinned' : ''}${c.relation === 'undated' ? ' undated' : ''}`}
                  key={c.key} id={c.domId} tabIndex={-1}
                  aria-label={`${c.medication} ${c.dose} — ${dayLabel(c)}`}
                >
                  {c.pinnedOpen ? (
                    <div className="mdbar">{head}</div>
                  ) : (
                    /* completed history: collapsed by default, the
                       nurse's choice kept across polls */
                    <button type="button" className="mdbar mdtoggle" aria-expanded={open} aria-controls={bodyId} onClick={() => toggle(c.key)}>
                      {head}
                      <span className="mdchev" aria-hidden="true">{open ? '▾' : '▸'}</span>
                    </button>
                  )}
                  {open && (
                    <div className="mdbody" id={bodyId}>
                      {c.reference && (
                        /* the actionable row lives on another day's card:
                           point there — never a second set of controls */
                        <div className={`mdref ${c.reference.direction}`} role="note">
                          {c.reference.direction === 'earlier'
                            ? <>{c.reference.row.round ? `Round ${c.reference.row.round}` : 'A dose'} scheduled {c.reference.day} {formatHm(hmOf(c.reference.row.scheduledTime))} is still outstanding — document it on that day's card.</>
                            : <>Next: {c.reference.row.round ? `round ${c.reference.row.round}` : 'the dose'} is scheduled {c.reference.day} {formatHm(hmOf(c.reference.row.scheduledTime))} — on that day's card.</>}
                          {' '}<button type="button" className="mdjump" onClick={() => jumpTo(c.reference!.targetDomId)}>Go to {c.reference.day} card</button>
                        </div>
                      )}
                      {c.rows.map(r => roundRow(r, c, p.name))}
                    </div>
                  )}
                </section>
              )
            })}
          </div>
        )
      })}
      {pending && (
        <MarReasonDialog
          row={pending.row}
          action={pending.action}
          lateLabel={pending.action === 'given-late' ? lateLabelOf(lateMinutes(pending.row)) : undefined}
          onCancel={() => setPending(null)}
          locked={busy.has(pending.row.orderId) || !isEligibleNow(pending.row, nowMs)}
          onConfirm={(reason, administeredAt) => {
            void onDocument(pending.row.orderId, pending.row.adminId,
              pending.action === 'given-late' ? 'given' : pending.action, reason, administeredAt)
            setPending(null)
          }}
        />
      )}
    </Card>
  )
}

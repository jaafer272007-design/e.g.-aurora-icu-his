import { useEffect, useRef, useState } from 'react'
import { Card } from '../../components/Card'
import { agoLabel, useNow } from '../../lib/time'
import type { LabDraw } from '../../lib/api/types'

interface CustomResultsCardProps {
  /** CUSTOM draws only (unstructured / unflagged), both acknowledged and not */
  draws: LabDraw[]
  /** derived from the session's permissions (results.acknowledge) */
  canAcknowledge: boolean
  onAcknowledge: (labId: string) => void
  /** reverse an acknowledgment — requires a documented reason; same
   *  permission as acknowledge (the existing lab unacknowledge endpoint) */
  onUnacknowledge: (labId: string, reason: string) => void
}

/* Labs & Imaging display fix (bug 1): custom results are unstructured — they
   are (correctly) excluded from the numeric trends chart, and the results
   inbox only lists UNACKNOWLEDGED results, so an acknowledged custom result
   previously had no home on this screen at all and appeared to vanish. This
   card is the custom results' permanent home: every custom draw stays
   visible — value/unit as typed, the display-only reference context, the
   note, provenance, and the acknowledged state with who signed it off —
   mirroring the ImagingCard's acknowledged-state pattern. Still UNFLAGGED:
   no normal/abnormal/critical is ever shown for a custom result. */

function UnackReasonDialog(
  { draw, onCancel, onConfirm }:
  { draw: LabDraw; onCancel: () => void; onConfirm: (reason: string) => void },
) {
  const [reason, setReason] = useState('')
  const taRef = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    taRef.current?.focus()
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel() }
    document.addEventListener('keydown', esc)
    return () => document.removeEventListener('keydown', esc)
  }, [onCancel])
  return (
    <div className="liscrim" onClick={onCancel}>
      <div className="lidialog" role="dialog" aria-modal="true" aria-labelledby="liCusUnackTitle" onClick={e => e.stopPropagation()}>
        <h2 id="liCusUnackTitle">Reverse acknowledgment · <span className="num">{draw.label}</span></h2>
        <p className="lidnote">
          The original acknowledgment ({draw.acknowledgedBy} · {draw.acknowledgedAt}) is preserved in the
          audit history; the result returns to the results inbox.
        </p>
        <div className="field">
          <label htmlFor="liCusUnackReason">Reason (required)</label>
          <textarea
            ref={taRef} id="liCusUnackReason" value={reason}
            placeholder="e.g. Acknowledged in error — value queried with the lab…"
            onChange={e => setReason(e.target.value)}
          />
        </div>
        <div className="lidfoot">
          <button className="btn ghost" onClick={onCancel}>Cancel</button>
          <button className="btn danger" disabled={!reason.trim()} onClick={() => onConfirm(reason.trim())}>
            ↩ Reverse acknowledgment
          </button>
        </div>
      </div>
    </div>
  )
}

/** the documenting clinician + time from the result's audit history */
function provenance(d: LabDraw): { actor: string; time: string } | null {
  const evt = d.history?.find(e => e.action === 'documented') ?? d.history?.find(e => e.action === 'resulted')
  return evt ? { actor: evt.actor, time: evt.time } : null
}

/* Lab Result Editing §2a: a documented result is not acknowledgeable inside
   its 5-minute self-correction window (server-enforced — this is the honest
   display of that state) */
const WINDOW_MS = 5 * 60_000
const docMs = (d: LabDraw) => (d.documentedAt ? Date.parse(`${d.documentedAt.replace(' ', 'T')}Z`) : NaN)
const inWindow = (d: LabDraw, now: Date) => !!d.documentedAt && now.getTime() - docMs(d) <= WINDOW_MS
const windowLeft = (d: LabDraw, now: Date) =>
  Math.min(WINDOW_MS / 60_000, Math.max(0, Math.ceil((WINDOW_MS - (now.getTime() - docMs(d))) / 60_000)))

export function CustomResultsCard({ draws, canAcknowledge: canAck, onAcknowledge, onUnacknowledge }: CustomResultsCardProps) {
  const now = useNow()
  const [unackTarget, setUnackTarget] = useState<LabDraw | null>(null)
  /* newest first — labId is monotonic */
  const sorted = [...draws].sort((a, b) => (a.labId < b.labId ? 1 : a.labId > b.labId ? -1 : 0))

  return (
    <Card
      icon={<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--violet)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z" /></svg>}
      title="Custom / Other Results"
      aside="unstructured · recorded as typed · no computed flag"
    >
      {sorted.map(d => {
        const prov = provenance(d)
        return (
          <div className="licustom" key={d.labId}>
            <div className="lisr1">
              <span className="licustag">custom · unflagged</span>
              <b className="lidesc">{d.label}</b>
              <span className="licusval num">{d.customValue}{d.customUnit && <small>{d.customUnit}</small>}</span>
              {d.customRefRange && (
                <span className="licusref" title="display-only reference context — does not drive a flag">
                  ref: {d.customRefRange} (context only)
                </span>
              )}
            </div>
            {d.note && <div className="linote">note: {d.note}</div>}
            <div className="lismeta num">
              documented {d.resultedAt} ({agoLabel(d.resultedAt, now)})
              {prov && <> · by {prov.actor}</>}
              {d.source === 'manual' && <> · ✎ manual</>}
              {(d.amendments?.length ?? 0) > 0 && <> · <span className="liedited">edited ×{d.amendments!.length}</span></>}
            </div>
            {/* Lab Result Editing: the amend-not-erase history — every
                correction shows original → new; a §2b entry carries its
                after-acknowledgment marker */}
            {(d.amendments?.length ?? 0) > 0 && (
              <div className="lihistory">
                {d.amendments!.map((a, i) => (
                  <div className="liamend" key={i}>
                    {a.target}: <s>{a.previousValue || '—'}</s> → <b>{a.newValue}</b> by {a.amendedBy} ({a.amenderRole}) at {a.amendedAt}
                    {a.reason && <i> — “{a.reason}”</i>}
                    {a.afterAcknowledgment && <span className="lipostack" title="this correction happened AFTER the acknowledgment below — the sign-off covers the previous value, not this one">after acknowledgment</span>}
                  </div>
                ))}
              </div>
            )}
            <div className="lisack">
              {d.acknowledged ? (
                <>
                  <span className="liacked">
                    ✓ Acknowledged by {d.acknowledgedBy} · {d.acknowledgedAt}
                    {/* §2b safeguard: the acknowledged-then-edited ordering,
                        stated ON the sign-off line so the old acknowledgment
                        is never read as covering the corrected value */}
                    {d.amendments?.some(a => a.afterAcknowledgment) &&
                      <b className="lipostackinline"> — then edited AFTER this acknowledgment (history above)</b>}
                  </span>
                  {canAck && (
                    <button
                      className="liunackbtn"
                      onClick={() => setUnackTarget(d)}
                      aria-label={`Reverse acknowledgment of ${d.label}`}
                    >
                      ↩ Reverse
                    </button>
                  )}
                </>
              ) : inWindow(d, now) ? (
                /* §2a: not acknowledgeable inside the 5-minute self-correction
                   window — server-enforced; said honestly here */
                <span className="liwindow">
                  ⏳ acknowledgeable in {windowLeft(d, now)} min — the value stabilises through its self-correction window first
                </span>
              ) : canAck ? (
                <button className="liackbtn" onClick={() => onAcknowledge(d.labId)} aria-label={`Acknowledge ${d.label}`}>
                  ✓ Acknowledge
                </button>
              ) : (
                <span className="liviewonly">View only — acknowledgement requires physician role</span>
              )}
            </div>
          </div>
        )
      })}
      {unackTarget && (
        <UnackReasonDialog
          draw={unackTarget}
          onCancel={() => setUnackTarget(null)}
          onConfirm={reason => { onUnacknowledge(unackTarget.labId, reason); setUnackTarget(null) }}
        />
      )}
    </Card>
  )
}

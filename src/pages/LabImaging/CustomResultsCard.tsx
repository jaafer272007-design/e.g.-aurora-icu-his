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
            </div>
            <div className="lisack">
              {d.acknowledged ? (
                <>
                  <span className="liacked">✓ Acknowledged by {d.acknowledgedBy} · {d.acknowledgedAt}</span>
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

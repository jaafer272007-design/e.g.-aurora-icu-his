import { useState } from 'react'
import { Card } from '../../components/Card'
import { IconPencil } from '../../components/icons'
import type { OrderPriority } from '../../lib/api/types'
import {
  NURSING_INTERVAL_MAX_MINUTES, formatNursingInterval, nursingIntervalMinutes,
} from '../../lib/nursingRounds'

/** what the form hands the page: instructions + priority + the schedule
 *  (null = one-time) */
export interface NursingOrderEntry {
  instructions: string
  priority: OrderPriority
  intervalMinutes: number | null
}

interface NursingOrderCardProps {
  /** orders.sign — without it only Pending is offered (the server 403s a
   *  signed create regardless) */
  canSign: boolean
  /** resolves true when the order was created (the form then resets) */
  onCreate: (entry: NursingOrderEntry, sign: boolean) => Promise<boolean>
}

/** New Nursing Order (icu-update-nursing-patient-chart.md §2): required
 *  free-text instructions, the existing Routine/Urgent/STAT priority,
 *  ONE-TIME by default, an optional Repeat with a positive whole-number
 *  interval in minutes or hours (1 minute through 48 hours), and the
 *  existing Pending / Sign & Order workflow. Its rounds are completed from
 *  Orders to Implement; the first is open as soon as it is signed. */
export function NursingOrderCard({ canSign, onCreate }: NursingOrderCardProps) {
  const [instructions, setInstructions] = useState('')
  const [priority, setPriority] = useState<OrderPriority>('Routine')
  const [repeat, setRepeat] = useState(false)
  const [every, setEvery] = useState('')
  const [unit, setUnit] = useState<'minutes' | 'hours'>('hours')
  const [busy, setBusy] = useState(false)

  const interval = repeat ? nursingIntervalMinutes(every, unit) : null
  const intervalProblem = repeat && every.trim() !== '' && interval === null
    ? `Enter a whole number from 1 minute to ${NURSING_INTERVAL_MAX_MINUTES / 60} hours.`
    : null
  const ready = instructions.trim() !== '' && (!repeat || interval !== null) && !busy

  const submit = async (sign: boolean) => {
    if (!ready) return
    setBusy(true)
    try {
      const ok = await onCreate({ instructions: instructions.trim(), priority, intervalMinutes: repeat ? interval : null }, sign)
      if (ok) {
        setInstructions('')
        setPriority('Routine')
        setRepeat(false)
        setEvery('')
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card icon={<IconPencil size={15} stroke="var(--amber)" />} title="New Nursing Order" aside="one-time or repeating">
      <div className="field">
        <label htmlFor="nuInstr">Instructions</label>
        <textarea
          id="nuInstr" value={instructions} maxLength={2000} required
          onChange={e => setInstructions(e.target.value)}
          placeholder="e.g. Reposition patient and check pressure areas"
        />
      </div>
      <div className="omgrid2">
        <div className="field">
          <label htmlFor="nuPriority">Priority</label>
          <select id="nuPriority" value={priority} onChange={e => setPriority(e.target.value as OrderPriority)}>
            {(['Routine', 'Urgent', 'STAT'] as const).map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
        <div className="field">
          <span className="omnulbl" id="nuSchedLbl">Schedule</span>
          <div className="omnusched" role="group" aria-labelledby="nuSchedLbl">
            <button type="button" className={`omnuopt${!repeat ? ' on' : ''}`} aria-pressed={!repeat} onClick={() => setRepeat(false)}>One-time</button>
            <button type="button" className={`omnuopt${repeat ? ' on' : ''}`} aria-pressed={repeat} onClick={() => setRepeat(true)}>Repeat</button>
          </div>
        </div>
      </div>
      {repeat && (
        <div className="omnurepeat">
          <div className="omnurepeatrow">
            <label htmlFor="nuEvery">Every</label>
            <input
              id="nuEvery" type="number" inputMode="numeric" min={1} step={1} value={every}
              onChange={e => setEvery(e.target.value)}
              aria-invalid={intervalProblem !== null} aria-describedby="nuEveryHint"
            />
            <select value={unit} onChange={e => setUnit(e.target.value as 'minutes' | 'hours')} aria-label="Interval unit">
              <option value="minutes">Minutes</option>
              <option value="hours">Hours</option>
            </select>
          </div>
          <div id="nuEveryHint" className={`omnuhint${intervalProblem ? ' bad' : ''}`} role={intervalProblem ? 'alert' : undefined}>
            {intervalProblem
              ?? (interval !== null
                ? `Due again ${formatNursingInterval(interval).replace('every ', '')} after each completion.`
                : '1 minute to 48 hours. Each round is due this long after the previous one is done.')}
          </div>
        </div>
      )}
      <div className="omdfoot">
        <button className="btn ghost" disabled={!ready} onClick={() => void submit(false)}>Pending</button>
        {canSign && <button className="btn primary" disabled={!ready} onClick={() => void submit(true)}>Sign &amp; order</button>}
      </div>
      <div className="omhint">
        {repeat ? 'Repeats until discontinued or discharge.' : 'Completed once.'} The first round opens when the order is signed.
        To change a signed schedule, discontinue it and create a new order.
      </div>
    </Card>
  )
}

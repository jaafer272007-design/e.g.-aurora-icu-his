import { useEffect, useState } from 'react'
import { Card } from '../../components/Card'
import { BedChip } from '../../components/Tag'
import { IconCheck } from '../../components/icons'
import type { NursingTask } from '../../lib/api/types'

type TaskDueState = 'overdue' | 'due' | 'upcoming'

/** a pending task counts as "due" this far ahead of its due time */
const DUE_SOON_MINUTES = 30

const toMinutes = (hm: string) => {
  const [h, m] = hm.split(':').map(Number)
  return h * 60 + m
}

/** Due state is always computed against the current time — never stored. */
export function dueStateFor(dueTime: string, now: Date): TaskDueState {
  const nowMin = now.getHours() * 60 + now.getMinutes()
  const dueMin = toMinutes(dueTime)
  if (dueMin < nowMin) return 'overdue'
  if (dueMin - nowMin <= DUE_SOON_MINUTES) return 'due'
  return 'upcoming'
}

interface TasksCardProps {
  tasks: NursingTask[]
  onToggle: (taskId: string) => void
}

/** Time-driven Nursing Task Checklist — sorted by due time; overdue/due flags
 *  are re-evaluated against the clock every 30 s (real-time-ready, rule 8). */
export function TasksCard({ tasks, onToggle }: TasksCardProps) {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000)
    return () => clearInterval(t)
  }, [])

  const open = tasks.filter(t => !t.done).length
  const sorted = [...tasks].sort((a, b) => a.dueTime.localeCompare(b.dueTime))
  return (
    <Card
      icon={<IconCheck size={15} stroke="var(--green)" strokeWidth={2} />}
      title="Nursing Tasks"
      aside={`${open} open · by due time`}
    >
      <div className="tsklist">
        {sorted.map(t => {
          const dueState = dueStateFor(t.dueTime, now)
          return (
            <button
              key={t.taskId}
              className={`tskrow${t.done ? ' done' : ''}`}
              aria-pressed={t.done}
              onClick={() => onToggle(t.taskId)}
            >
              <span className="cb"><IconCheck size={11} /></span>
              <span className={`tsktime num td-${dueState}`}>
                {t.dueTime}
                {!t.done && dueState === 'overdue' && <em className="tskover">OVERDUE</em>}
              </span>
              <span className="tsklabel">{t.label}</span>
              <span className="tskmeta"><BedChip bedId={t.bedId} className="bedchip tskbed" /><i className="tskrec">{t.recurrence}</i></span>
            </button>
          )
        })}
      </div>
    </Card>
  )
}

import { Card } from '../../components/Card'
import { BedChip } from '../../components/Tag'
import { IconCheck } from '../../components/icons'
import { dueStateFor, useNow } from '../../lib/time'
import type { NursingTask } from '../../lib/api/types'

interface TasksCardProps {
  tasks: NursingTask[]
  onToggle: (taskId: string) => void
}

/** Time-driven Nursing Task Checklist — sorted by due time; overdue/due flags
 *  are re-evaluated against the clock every 30 s (real-time-ready, rule 8). */
export function TasksCard({ tasks, onToggle }: TasksCardProps) {
  const now = useNow()
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

import { Card } from '../../components/Card'
import type { OrganName, OrganStatus } from '../../lib/api/types'

const STATUS_TEXT: Record<OrganStatus, string> = { ok: 'Stable', watch: 'Watch', crit: 'Critical' }

const CIRC_STROKE: Record<OrganStatus, string> = {
  ok: 'rgba(61,232,160,.5)',
  watch: 'rgba(255,180,84,.65)',
  crit: 'rgba(255,93,108,.75)',
}

export function DigitalTwin({ organs }: { organs: Record<OrganName, OrganStatus> }) {
  const cls = (name: OrganName) => `organ o-${organs[name]}`
  return (
    <Card
      icon={<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--cyan)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="5" r="3" /><path d="M12 8v5m0 0l-4 8m4-8l4 8M6 12h12" /></svg>}
      title="Patient Digital Twin" aside="Organ status"
    >
      <div className="twin">
        <svg viewBox="0 0 120 240" aria-label="Body diagram">
          <defs>
            <linearGradient id="bodyG" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="rgba(140,175,225,.16)" /><stop offset="1" stopColor="rgba(140,175,225,.06)" />
            </linearGradient>
          </defs>
          {/* silhouette */}
          <g fill="url(#bodyG)" stroke="rgba(150,185,235,.35)" strokeWidth="1.4">
            <circle cx="60" cy="26" r="16" />
            <path d="M60 42c-14 0-22 8-24 20l-4 34c-1 8 2 12 6 12l2 44c0 6 3 10 8 10h24c5 0 8-4 8-10l2-44c4 0 7-4 6-12l-4-34c-2-12-10-20-24-20z" />
            <path d="M36 66l-10 40c-1 5 1 8 4 9l4 1 8-46" />
            <path d="M84 66l10 40c1 5-1 8-4 9l-4 1-8-46" />
            <path d="M50 162l-3 60c0 4 2 7 6 7h4l3-64" />
            <path d="M70 162l3 60c0 4-2 7-6 7h-4l-3-64" />
          </g>
          {/* circulation ring */}
          <ellipse className="organ" cx="60" cy="118" rx="30" ry="66" fill="none" stroke={CIRC_STROKE[organs.Circulation]} strokeWidth="2" strokeDasharray="4 7" />
          {/* organs */}
          <ellipse className={cls('Brain')} cx="60" cy="24" rx="10" ry="8" />
          <path className={cls('Lungs')} d="M54 62c-8 0-12 8-12 18s3 16 9 16c4 0 6-4 6-10V68c0-4-1-6-3-6z" />
          <path className={cls('Lungs')} d="M66 62c8 0 12 8 12 18s-3 16-9 16c-4 0-6-4-6-10V68c0-4 1-6 3-6z" />
          <path className={cls('Heart')} d="M60 74c3-4 9-4 11 0 2 3 1 7-3 11l-8 7-8-7c-4-4-5-8-3-11 2-4 8-4 11 0z" />
          <path className={cls('Liver')} d="M46 104c-5 1-8 5-7 10 1 4 5 6 11 5l16-4c4-1 5-5 3-8-3-4-14-5-23-3z" />
          <ellipse className={cls('Kidneys')} cx="48" cy="128" rx="5" ry="8" />
          <ellipse className={cls('Kidneys')} cx="72" cy="128" rx="5" ry="8" />
        </svg>
        <div className="organlist">
          {(Object.entries(organs) as [OrganName, OrganStatus][]).map(([name, st]) => (
            <div key={name} className={`orow st-${st}`}>
              <span className="odot" />
              <span className="on">{name}</span>
              <span className="os">{STATUS_TEXT[st]}</span>
            </div>
          ))}
        </div>
      </div>
    </Card>
  )
}

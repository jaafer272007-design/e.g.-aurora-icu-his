import type { CSSProperties, ReactNode } from 'react'
import './Card.css'

interface CardProps {
  id?: string
  className?: string
  style?: CSSProperties
  icon?: ReactNode
  title?: ReactNode
  aside?: ReactNode
  headId?: string
  children?: ReactNode
}

/** Glass panel card with the standard `chead` header row. */
export function Card({ id, className, style, icon, title, aside, headId, children }: CardProps) {
  return (
    <section id={id} className={`card${className ? ' ' + className : ''}`} style={style} aria-labelledby={headId}>
      {(icon || title || aside) && (
        <div className="chead">
          {icon}
          <span className="t" id={headId}>{title}</span>
          {aside !== undefined && <span className="x">{aside}</span>}
        </div>
      )}
      {children}
    </section>
  )
}

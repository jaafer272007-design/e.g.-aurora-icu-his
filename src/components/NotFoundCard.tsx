import { useNavigate } from 'react-router-dom'
import './NotFoundCard.css'
import { IconAlertTriangle } from './icons'

/** Locked pattern: an ID in a URL that doesn't resolve renders this explicit
 *  state with a route back — never a redirect, never another record's data. */
export function NotFoundCard() {
  const navigate = useNavigate()
  return (
    <section className="card notfound" role="alert">
      <IconAlertTriangle size={28} stroke="var(--amber)" />
      <h2>Patient Not Found</h2>
      <p>No patient found for this ID — they may have been discharged, transferred, or this link is outdated.</p>
      <button className="nf-btn" onClick={() => navigate('/beds')}>← Back to Bed Overview</button>
    </section>
  )
}

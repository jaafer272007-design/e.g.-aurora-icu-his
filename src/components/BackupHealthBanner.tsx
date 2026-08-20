import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import './BackupHealthBanner.css'
import { getBackupStatus } from '../lib/api'
import type { BackupStatus } from '../lib/api/types'
import { getSession, hasPermission } from '../lib/session'
import { usePollTick } from '../hooks/useLive'

/* ==================== backup ruling 2 — the shell banner ====================
   PUSH, NOT PULL. The field finding this exists for: a production install
   ran with NO nightly backup task, and the only surface that said so was
   one screen behind one permission that nobody had reason to open. A screen
   nobody opens is exactly what failed, so the answer is not a better
   screen — the truth comes to whoever holds the read atom, on every screen.

   - Renders for a session holding `backup.status.view` (office
     Administrator and SystemAdministrator) — the read atom split from
     backup.manage, because the person who should panic about no backups
     is not necessarily the person who runs restores.
   - Fires on health `none` or `stale` ONLY (the owner's ruling): no backup
     has ever succeeded, or the newest one breaches the 24h RPO. The
     lesser states (`failed` with a fresh good copy, the offsite-* tiers)
     stay the /backup dashboard's business — a banner that cries on every
     degradation teaches people to ignore the banner.
   - PERSISTENT AND NOT DISMISSIBLE while the condition holds: there is no
     close control, deliberately. It leaves the screen only when a fresh
     read reports the condition gone.
   - DELIBERATELY NOT in the clinical Alerts centre: an infrastructure
     alert in a clinical stream teaches people to ignore the stream.
   - An unanswered read renders NOTHING: this banner asserts a MEASURED
     condition, never a guess (the display-honesty rule — reassurance may
     not default, and neither may alarm). An unreachable API has its own
     app-wide surface (EnvironmentGate's overlay); this component does not
     duplicate it. */
export function BackupHealthBanner() {
  const location = useLocation()
  const navigate = useNavigate()
  const tick = usePollTick()
  const [status, setStatus] = useState<BackupStatus | null>(null)

  const session = getSession()
  const canSee = !!session && hasPermission(session.jobTitle, 'backup.status.view')
  const canManage = !!session && hasPermission(session.jobTitle, 'backup.manage')

  useEffect(() => {
    if (!canSee) { setStatus(null); return }
    let alive = true
    getBackupStatus().then(s => { if (alive) setStatus(s) })
    return () => { alive = false }
    /* location keys the re-check across login/logout navigations; tick is
       the shared LIVE_POLL_MS cadence — backup staleness moves by the
       hour, so any shared cadence is fresh enough, and one convention
       beats a bespoke timer */
  }, [canSee, tick, location.pathname])

  if (!canSee || status === null) return null
  if (status.health !== 'none' && status.health !== 'stale') return null

  return (
    <div className="bkbanner" role="alert">
      <span className="bkbadge">{status.health === 'none' ? 'NO BACKUP EXISTS' : 'BACKUP STALE'}</span>
      <span className="bkdetail">{status.healthDetail}</span>
      {canManage && (
        <button className="bkgo" onClick={() => navigate('/backup')}>
          Backup &amp; Recovery →
        </button>
      )}
    </div>
  )
}

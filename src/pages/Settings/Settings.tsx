import { useEffect, useState } from 'react'
import './Settings.css'
import { AppHeader } from '../../components/AppHeader'
import { NavSidebar } from '../../components/NavSidebar'
import { Card } from '../../components/Card'
import { IconSettings } from '../../components/icons'
import { getAdtBeds, getFrontendBuild, getSystemHealth, type SystemHealth } from '../../lib/api'
import type { AdtBed } from '../../lib/api/types'
import { NEWS2_V1, SOFA_V1 } from '../../lib/scoring'
import {
  LIGHT_THEME_AVAILABLE, getPreferences, setPreferences, systemPrefersUnavailableLight,
  type Preferences, type ThemePreference, type TimeFormat,
} from '../../lib/preferences'
import { getSession, initialsOf, profileOf } from '../../lib/session'
import { formatHm } from '../../lib/time'
import { APP_VERSION } from '../../lib/version'

/** Settings — the LAST dead nav item (docs/design/
 *  settings-back-button-design.md). Three layers: User Preferences (the
 *  small new preferences store — theme + time format ONLY), ICU
 *  Preferences (read-only by design), System Information (real values or
 *  honest absence). Everything else is an explicit "not tracked yet"
 *  placeholder naming the missing capability — never fabricated.
 *
 *  RBAC (flagged): NOTHING patient-identifiable renders here (the bed
 *  layout shows bed ids/areas only — beds are places, never occupancy),
 *  so the route carries a session gate with NO permission: all eight
 *  profiles including the office Administrator reach it. */

const NT_USER: { label: string; why: string }[] = [
  { label: 'Language', why: 'no i18n layer exists — a language toggle would be fabrication' },
  { label: 'Notification preferences', why: 'no notifications exist (the D6 decision: alerting is v2) — a preference for a thing that does not exist would be fabrication' },
  { label: 'Default workspace', why: 'the landing route is RBAC/profile-derived today, not a user choice — a preference would be new behaviour' },
  { label: 'Default rounding template', why: 'no rounding-template concept exists' },
]
const NT_SYSTEM: { label: string; why: string }[] = [
  { label: 'Database status', why: 'no deeper status source exists beyond what /healthz reports' },
  { label: 'Connected services', why: 'no service registry exists (the future Integration Layer / LIS would populate this)' },
  { label: 'License', why: 'no licence concept exists anywhere' },
  { label: 'Backup status', why: 'backups are an operational workflow — nothing the app can query' },
]

export function Settings() {
  const session = getSession()!
  const [prefs, setPrefsState] = useState<Preferences>(getPreferences())
  const [beds, setBeds] = useState<AdtBed[] | null>(null)
  const [health, setHealth] = useState<SystemHealth | null | 'loading'>('loading')
  const [feBuild, setFeBuild] = useState<string | null | 'loading'>('loading')

  useEffect(() => {
    getAdtBeds().then(setBeds).catch(() => setBeds(null))
    getSystemHealth().then(setHealth)
    getFrontendBuild().then(setFeBuild)
  }, [])

  const update = (next: Partial<Preferences>) => {
    const merged = { ...getPreferences(), ...next }
    setPreferences(merged)
    setPrefsState(merged)
  }

  const areas = beds ? [...new Set(beds.filter(b => b.active).map(b => b.area))] : []
  const deviceWantsLight = systemPrefersUnavailableLight()

  return (
    <div className="app-frame se">
      <AppHeader
        subtitle="Settings"
        kpis={[]}
        user={{ initials: initialsOf(session.name), name: session.name, role: `${session.jobTitle} · ${profileOf(session.jobTitle)} profile` }}
      />
      <div className="shell">
        <NavSidebar active="settings" footerLines={['Preferences + system info', 'No clinical data on this screen']} />

        <main className="se-main">
          {/* ---------------- A. User Preferences ---------------- */}
          <Card icon={<IconSettings size={15} stroke="var(--blue)" />} title="User Preferences"
            aside="tab-scoped · cleared on sign-out">
            <p className="se-note">
              The preferences store holds exactly two preferences — theme and time format. It is
              tab/session-scoped and cleared on sign-out, the same discipline as the session and
              the patient context; a per-user persisted preference is recorded as future.
            </p>

            <div className="se-row">
              <div className="se-k">Theme</div>
              <div className="se-v">
                <div className="se-opts" role="radiogroup" aria-label="Theme">
                  {([['system', 'Follow system'], ['light', 'Light'], ['dark', 'Dark']] as [ThemePreference, string][]).map(([val, label]) => (
                    <label key={val} className={`se-opt${prefs.theme === val ? ' on' : ''}${val === 'light' && !LIGHT_THEME_AVAILABLE ? ' se-disabled' : ''}`}>
                      <input
                        type="radio" name="theme" value={val}
                        checked={prefs.theme === val}
                        disabled={val === 'light' && !LIGHT_THEME_AVAILABLE}
                        onChange={() => update({ theme: val })}
                      />
                      {label}{val === 'system' ? ' (default)' : ''}
                    </label>
                  ))}
                </div>
                {!LIGHT_THEME_AVAILABLE && (
                  <p className="se-flag">
                    Light theme — flagged, not yet available: the app is styled dark-first across
                    18 screens with several hundred colour usages outside the token layer; shipping
                    a light palette without a dedicated styling pass would break contrast. Follow
                    system and Dark work today{deviceWantsLight ? ' — your device prefers light, and Aurora will follow it once the light styling pass lands' : ''}.
                    Time-based auto-switching is deliberately not built (a 24/7 ICU makes
                    clock-driven switching fight the user).
                  </p>
                )}
              </div>
            </div>

            <div className="se-row">
              <div className="se-k">Time format</div>
              <div className="se-v">
                <div className="se-opts" role="radiogroup" aria-label="Time format">
                  {([['24h', '24-hour'], ['12h', '12-hour']] as [TimeFormat, string][]).map(([val, label]) => (
                    <label key={val} className={`se-opt${prefs.timeFormat === val ? ' on' : ''}`}>
                      <input type="radio" name="timeformat" value={val} checked={prefs.timeFormat === val} onChange={() => update({ timeFormat: val })} />
                      {label}
                    </label>
                  ))}
                </div>
                <p className="se-sub num">
                  display preview: 14:05 renders as {formatHm('14:05')} — applies to the render-time
                  displays (stored records are never rewritten)
                </p>
              </div>
            </div>

            <div className="se-ntlist">
              {NT_USER.map(n => (
                <div className="se-ntrow" key={n.label}>
                  <span className="se-ntbadge">not tracked yet</span>
                  <div><b>{n.label}</b><small>{n.why}</small></div>
                </div>
              ))}
            </div>
          </Card>

          {/* ---------------- B. ICU Preferences (read-only by design) ---------------- */}
          <Card icon={<IconSettings size={15} stroke="var(--cyan)" />} title="ICU Preferences" aside="read-only by design">
            <div className="se-row">
              <div className="se-k">Bed layout</div>
              <div className="se-v">
                {beds === null ? (
                  <p className="se-sub">bed registry unavailable — requires the live server (nothing fabricated)</p>
                ) : (
                  <>
                    {/* the unit's ACTIVE beds (the Bed Registry); retired
                        beds leave the layout but keep rendering on the
                        historical records that carry them */}
                    <p className="se-sub">
                      {beds.filter(b => b.active).length} beds · {areas.map(a => `${a}: ${beds.filter(b => b.active && b.area === a).length}`).join(' · ')}
                      {beds.some(b => !b.active) ? ` · ${beds.filter(b => !b.active).length} retired` : ''}
                    </p>
                    <div className="se-beds num">
                      {beds.filter(b => b.active).map(b => <span className="se-bed" key={b.bedId}>{b.bedId}</span>)}
                    </div>
                  </>
                )}
                <div className="se-ntrow se-ntinline">
                  <span className="se-ntbadge">managed elsewhere</span>
                  <div><b>Bed layout editing</b><small>add/retire beds in Configuration → Bed Registry (beds.manage)</small></div>
                </div>
              </div>
            </div>

            <div className="se-row">
              <div className="se-k">Clinical scores</div>
              <div className="se-v">
                {[SOFA_V1, NEWS2_V1].map(def => (
                  <div className="se-score" key={def.id}>
                    <b>{def.label} · {def.version}</b> <span className="se-sub num">max {def.maxTotal}</span>
                    <small>{def.components.map(c => `${c.label} (0–${c.max})`).join (' · ')}</small>
                  </div>
                ))}
                <p className="se-flag">
                  Scores are versioned, not configurable — deliberately. Editing a validated
                  instrument's thresholds is not a setting: per the locked versioning discipline a
                  variant is a NEW score definition/version (e.g. ICU-EWS v2, a modified SOFA),
                  never a knob that mutates the standard score. This panel shows the active
                  versions; nothing here edits them.
                </p>
              </div>
            </div>

            <div className="se-ntlist">
              <div className="se-ntrow">
                <span className="se-ntbadge">not tracked yet</span>
                <div><b>Units (SI / conventional)</b><small>units are fixed in the catalogue/spec (validator-confirmed) and no conversion layer exists — a toggle would be fabrication</small></div>
              </div>
            </div>
          </Card>

          {/* ---------------- C. System Information ---------------- */}
          <Card icon={<IconSettings size={15} stroke="var(--green)" />} title="System Information" aside="the two halves deploy separately">
            <div className="se-grid">
              <div className="se-info"><span>App version</span><b>{APP_VERSION}</b></div>
              <div className="se-info">
                <span>Frontend build</span>
                <b className="num">{feBuild === 'loading' ? '…' : feBuild ? feBuild.slice(0, 12) : 'no build stamp in this serve'}</b>
                <small>{feBuild && feBuild !== 'loading' ? 'commit SHA from build.txt (written by the Pages deploy)' : 'build.txt is written by the Pages deploy — absent on a local/dev serve (honest absence)'}</small>
              </div>
              <div className="se-info">
                <span>Server build</span>
                <b className="num">{health === 'loading' ? '…' : health ? health.build : '—'}</b>
                <small>{health && health !== 'loading' ? 'from /healthz — the server deploys separately from the frontend' : 'unavailable while the API is unreachable'}</small>
              </div>
              <div className="se-info">
                <span>Environment</span>
                <b>{health === 'loading' ? '…' : health ? health.environment : '—'}</b>
              </div>
            </div>

            <div className={`se-health ${health === 'loading' ? '' : health ? 'ok' : 'down'}`} role="status">
              {health === 'loading' && 'Checking API health…'}
              {health !== 'loading' && health && (
                <>API reachable — service {health.service} · phase {health.phase} · status {health.status} · environment {health.environment} · build <span className="num">{health.build}</span></>
              )}
              {health !== 'loading' && !health && (
                <>API unreachable right now — the server may be asleep (free-tier hosting spins down) or offline. Nothing on this page pretends otherwise.</>
              )}
            </div>

            <div className="se-ntlist">
              {NT_SYSTEM.map(n => (
                <div className="se-ntrow" key={n.label}>
                  <span className="se-ntbadge">not tracked yet</span>
                  <div><b>{n.label}</b><small>{n.why}</small></div>
                </div>
              ))}
            </div>
          </Card>
        </main>
      </div>
    </div>
  )
}

import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import './Login.css'
import { IconPulse } from '../../components/icons'
import { authApiConfigured, login } from '../../lib/api'
import {
  SAMPLE_STAFF, getSession, initialsOf, landingRouteOf, permissionsOf, profileOf,
  signIn, usernameOf,
  type JobTitle, type Session,
} from '../../lib/session'

/** matches typed input against the preset staff (username or full name) —
 *  drives the live RBAC preview and the Stage 9 local-session fallback */
const matchStaff = (input: string): Session | undefined => {
  const norm = input.trim().toLowerCase()
  if (!norm) return undefined
  return SAMPLE_STAFF.find(s => usernameOf(s.name) === norm || s.name.toLowerCase() === norm)
}

/** Stage 10 Phase 2 — real login. POST /api/auth/login exchanges username +
 *  password for a JWT (stored in the session, attached as a Bearer token by
 *  the API adapters). If the auth API is unreachable, falls back to the
 *  Stage 9 LOCAL session (no token, password not verified) — logged to the
 *  console, same resilience pattern as the roster adapter. Profile and
 *  permissions remain derived from the JobTitle at read time, never stored. */
export function Login() {
  const navigate = useNavigate()
  const existing = getSession()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [fallbackNote, setFallbackNote] = useState(false)

  const preview = useMemo(() => matchStaff(username), [username])

  const enter = (name: string, jobTitle: JobTitle, token?: string) => {
    signIn(name, jobTitle, token)
    navigate(landingRouteOf(jobTitle))
  }

  const submit = async () => {
    if (busy) return
    setError('')
    setBusy(true)
    const result = await login(username.trim(), password)
    setBusy(false)
    if (result.ok) {
      /* server-verified identity — trust its name/jobTitle over local presets */
      enter(result.name, result.jobTitle as JobTitle, result.token)
      return
    }
    if (result.reason === 'invalid') {
      /* real rejection from the auth API — generic on purpose */
      setError('Invalid credentials.')
      return
    }
    /* auth API unreachable (or not configured) → Stage 9 local-session fallback */
    console.info('[aurora] auth API unavailable — Stage 9 local session fallback (password NOT verified)')
    const staff = matchStaff(username)
    if (staff) {
      setFallbackNote(true)
      enter(staff.name, staff.jobTitle)
    } else {
      setError('Invalid credentials.')
    }
  }

  return (
    <div className="app-frame lg">
      <main className="lgwrap">
        <section className="lgcard card">
          <div className="lgbrand">
            <div className="logo"><IconPulse size={20} stroke="#06121f" strokeWidth={2.6} /></div>
            <div className="lgtitle">AURORA ICU<small>Hospital Information System · Unit 4B</small></div>
          </div>

          <div className="lgcols">
            <div className="lgleft">
              <h1>Sign in to the unit</h1>
              <p className="lgintro">
                Credentials are verified by the AURORA auth service; a signed shift token (JWT)
                accompanies your API requests. The three-layer permission model resolves
                everything else from your job title:
              </p>
              <ol className="lgchain">
                <li><b>User</b> — verified by username + password</li>
                <li><b>Role (Job Title)</b> — one of 20 real hospital titles, carried in the token</li>
                <li><b>Permission Profile</b> — derived from the title, never stored</li>
                <li><b>Permissions</b> — derived from the profile, enforced in the service layer</li>
              </ol>
              <div className="lgdisclaimer" role="note">
                <b>Prototype credentials — not production.</b> All 20 demo accounts share the
                password <b className="num">Aurora2026!</b> (documented in the project docs); there
                is no registration or password reset yet. If the auth service is unreachable, the
                app falls back to a Stage 9 local session — clearly logged, password not verified.
              </div>
              <details className="lgdirectory">
                <summary>Demo staff directory (usernames)</summary>
                <ul>
                  {SAMPLE_STAFF.map(s => (
                    <li key={s.name}>
                      <span className="num">{usernameOf(s.name)}</span> — {s.name} · {s.jobTitle}
                    </li>
                  ))}
                </ul>
              </details>
            </div>

            <form className="lgform" onSubmit={e => { e.preventDefault(); void submit() }}>
              <label className="lglabel" htmlFor="lguser">Username</label>
              <input
                id="lguser" className="lginput num" type="text" value={username}
                placeholder="e.g. sara.rahman" autoComplete="username" autoFocus
                onChange={e => { setUsername(e.target.value); setError('') }}
              />
              <label className="lglabel" htmlFor="lgpass">Password</label>
              <input
                id="lgpass" className="lginput num" type="password" value={password}
                autoComplete="current-password"
                onChange={e => { setPassword(e.target.value); setError('') }}
              />

              {preview && (
                <div className="lgderived" aria-live="polite">
                  <div className="lgwho">
                    <span className="lgav num">{initialsOf(preview.name)}</span>
                    <div>
                      <b>{preview.name}</b>
                      <small>{preview.jobTitle}</small>
                    </div>
                    <span className="lgprofile">{profileOf(preview.jobTitle)} profile</span>
                  </div>
                  <div className="lgperms">
                    {permissionsOf(preview.jobTitle).map(p => <i key={p} className="lgperm">{p}</i>)}
                  </div>
                  <div className="lglanding">
                    Dashboard resolves to <b className="num">{landingRouteOf(preview.jobTitle)}</b>
                  </div>
                </div>
              )}

              {error && <div className="lgerror" role="alert">⚠ {error}</div>}
              {!authApiConfigured && (
                <div className="lgmode" role="note">
                  Auth service not configured — sign-ins use the Stage 9 local session
                  (no password check).
                </div>
              )}
              {fallbackNote && (
                <div className="lgmode" role="note">Auth service unreachable — signed in with a local session.</div>
              )}

              <button type="submit" className="lgsubmit" disabled={busy}>
                {busy ? 'Verifying…' : 'Sign in →'}
              </button>

              {existing && (
                <div className="lgexisting">
                  Currently signed in as <b>{existing.name}</b> ({existing.jobTitle}) — signing in
                  replaces that session, or{' '}
                  <button type="button" className="lgcontinue" onClick={() => navigate(landingRouteOf(existing.jobTitle))}>
                    continue as {existing.name} →
                  </button>
                </div>
              )}
            </form>
          </div>
        </section>
        <footer className="lgfoot">AURORA HIS v4.2 · Stage 10 Phase 2 authentication · clinical data beyond the roster is mock until later phases</footer>
      </main>
    </div>
  )
}

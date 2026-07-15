import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import './Login.css'
import { IconPulse } from '../../components/icons'
import { authApiConfigured, changePassword, login, selectRole } from '../../lib/api'
import type { LoginResult } from '../../lib/api'
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
  /* multi-role login steps (User Management design §2): the server issues
     NO usable session token until every step completes — these hold the
     short-lived step tokens between calls */
  const [chooser, setChooser] = useState<{ name: string; roles: string[]; selectToken: string } | null>(null)
  const [pwChange, setPwChange] = useState<{ changeToken: string } | null>(null)
  const [newPw, setNewPw] = useState('')
  const [newPw2, setNewPw2] = useState('')

  /* the live RBAC preview matches against the DEMO staff presets —
     dev/staging only; the branch (and with it the preset directory) is
     compiled out of production bundles */
  const preview = useMemo(
    () => (import.meta.env.VITE_APP_ENV !== 'production' ? matchStaff(username) : undefined),
    [username],
  )

  const enter = (name: string, jobTitle: JobTitle, token?: string) => {
    signIn(name, jobTitle, token)
    navigate(landingRouteOf(jobTitle))
  }

  /* one continuation for every auth response: session → in; forced
     change → the change form; multi-role → the chooser (roles are only
     ever present AFTER a correct password — decision 7) */
  const applyResult = (result: LoginResult): boolean => {
    if (result.ok === true) {
      setPwChange(null); setChooser(null)
      enter(result.name, result.jobTitle as JobTitle, result.token)
      return true
    }
    if (result.ok === 'change-password') {
      setChooser(null)
      setPwChange({ changeToken: result.changeToken })
      return true
    }
    if (result.ok === 'choose-role') {
      setPwChange(null) // the change step is done — show the chooser
      setChooser({ name: result.name, roles: result.roles, selectToken: result.selectToken })
      return true
    }
    return false
  }

  const pick = async (role: string) => {
    if (!chooser || busy) return
    setError('')
    setBusy(true)
    const result = await selectRole(chooser.selectToken, role)
    setBusy(false)
    if (applyResult(result)) return
    /* expired/refused step token → start over */
    setChooser(null)
    setError('Role selection expired — sign in again.')
  }

  const submitNewPassword = async () => {
    if (!pwChange || busy) return
    setError('')
    if (newPw !== newPw2) { setError('The two entries do not match.'); return }
    setBusy(true)
    const result = await changePassword(pwChange.changeToken, newPw)
    setBusy(false)
    setNewPw(''); setNewPw2('')
    if (applyResult(result)) return
    if (result.ok === false && result.message) { setError(result.message); return }
    setPwChange(null)
    setError('Password change expired — sign in again.')
  }

  const submit = async () => {
    if (busy) return
    setError('')
    setBusy(true)
    const result = await login(username.trim(), password)
    setBusy(false)
    if (applyResult(result)) return
    if (result.ok === false && result.reason === 'invalid') {
      /* real rejection from the auth API — generic on purpose: wrong
         password, unknown account and deactivated account are all the
         SAME message (no account-state oracle) */
      setError('Invalid credentials.')
      return
    }
    /* auth API unreachable (or not configured) → Stage 9 local-session
       fallback — dev/staging ONLY. The branch is compiled out of
       production bundles: a production sign-in is server-verified or it
       does not happen (no path to an unverified local session exists). */
    if (import.meta.env.VITE_APP_ENV !== 'production') {
      console.info('[aurora] auth API unavailable — Stage 9 local session fallback (password NOT verified)')
      const staff = matchStaff(username)
      if (staff) {
        setFallbackNote(true)
        enter(staff.name, staff.jobTitle)
      } else {
        setError('Invalid credentials.')
      }
      return
    }
    setError('Cannot reach the AURORA service — try again, or contact IT if this persists.')
  }

  return (
    <div className="app-frame lg">
      <main className="lgwrap">
        <section className="lgcard card">
          <div className="lgbrand">
            <div className="logo"><IconPulse size={20} stroke="var(--ink)" strokeWidth={2.6} /></div>
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
              {import.meta.env.VITE_APP_ENV !== 'production' && (
                <>
                  {/* demo credentials + directory: dev/staging only — the
                      block (and the preset list it renders) is compiled
                      out of production bundles */}
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
                </>
              )}
            </div>

            {pwChange ? (
              /* ---- §4: forced password change (first login / after an
                 admin reset) — no session exists until this completes ---- */
              <form className="lgform" onSubmit={e => { e.preventDefault(); void submitNewPassword() }}>
                <div className="lgstep" role="note">
                  <b>Set a new password to continue.</b> Your credential was set by an
                  administrator (new account or reset) — replace it with one only you know.
                  Minimum 8 characters.
                </div>
                <label className="lglabel" htmlFor="lgnew1">New password</label>
                <input id="lgnew1" className="lginput num" type="password" value={newPw}
                  autoComplete="new-password" autoFocus
                  onChange={e => { setNewPw(e.target.value); setError('') }} />
                <label className="lglabel" htmlFor="lgnew2">New password (again)</label>
                <input id="lgnew2" className="lginput num" type="password" value={newPw2}
                  autoComplete="new-password"
                  onChange={e => { setNewPw2(e.target.value); setError('') }} />
                {error && <div className="lgerror" role="alert">⚠ {error}</div>}
                <button type="submit" className="lgsubmit" disabled={busy || !newPw || !newPw2}>
                  {busy ? 'Saving…' : 'Set password and continue →'}
                </button>
                <button type="button" className="lgcontinue" onClick={() => { setPwChange(null); setError('') }}>
                  ← Back to sign-in
                </button>
              </form>
            ) : chooser ? (
              /* ---- §2: the role chooser — this person HOLDS several
                 roles and acts as exactly ONE this session. Shown only
                 AFTER a correct password (decision 7); the session token
                 is issued only once a role is chosen. ---- */
              <div className="lgform" role="group" aria-label="Choose the role for this session">
                <div className="lgstep" role="note">
                  <b>{chooser.name}</b> — you hold {chooser.roles.length} roles. Choose the ONE
                  role to act as for this session; your permissions derive from it alone.
                  Changing role later means signing out and back in.
                </div>
                {chooser.roles.map(r => (
                  <button key={r} type="button" className="lgrole" disabled={busy} onClick={() => void pick(r)}>
                    <b>{r}</b>
                    <small>{profileOf(r as JobTitle)} profile · lands on {landingRouteOf(r as JobTitle)}</small>
                  </button>
                ))}
                {error && <div className="lgerror" role="alert">⚠ {error}</div>}
                <button type="button" className="lgcontinue" onClick={() => { setChooser(null); setError('') }}>
                  ← Back to sign-in
                </button>
              </div>
            ) : (
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
            )}
          </div>
        </section>
        <footer className="lgfoot">
          {import.meta.env.VITE_APP_ENV === 'production'
            ? 'AURORA HIS · authenticated access only'
            : 'AURORA HIS v4.2 · Stage 10 Phase 2 authentication · clinical data beyond the roster is mock until later phases'}
        </footer>
      </main>
    </div>
  )
}

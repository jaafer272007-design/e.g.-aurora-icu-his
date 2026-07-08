import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import './Login.css'
import { IconPulse } from '../../components/icons'
import {
  SAMPLE_STAFF, getSession, initialsOf, landingRouteOf, permissionsOf, profileOf, signIn,
  type PermissionProfile,
} from '../../lib/session'

/* group the preset staff list by their DERIVED profile for the optgroups */
const PROFILE_ORDER: PermissionProfile[] = [
  'Doctor', 'Nurse', 'Pharmacist', 'RespiratoryTherapist', 'Ancillary', 'AlliedHealth', 'Administrator',
]
const PROFILE_LABEL: Record<PermissionProfile, string> = {
  Doctor: 'Medical', Nurse: 'Nursing', Pharmacist: 'Pharmacy',
  RespiratoryTherapist: 'Respiratory Therapy', Ancillary: 'Laboratory & Radiology',
  AlliedHealth: 'Allied Health', Administrator: 'Administration',
}

/** Stage 9 — Login / Role-Switch. LOCAL SESSION ONLY: picks a sample staff
 *  member (name + JobTitle); profile and permissions are derived from the
 *  JobTitle at read time, never stored. Real authentication is Stage 10. */
export function Login() {
  const navigate = useNavigate()
  const existing = getSession()
  const [idx, setIdx] = useState(0)

  const staff = SAMPLE_STAFF[idx]
  const profile = profileOf(staff.jobTitle)
  const permissions = permissionsOf(staff.jobTitle)
  const landing = landingRouteOf(staff.jobTitle)

  const submit = () => {
    signIn(staff.name, staff.jobTitle)
    navigate(landing)
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
                Pick a staff member to enter the ICU module with that role. The three-layer
                permission model resolves everything else:
              </p>
              <ol className="lgchain">
                <li><b>User</b> — who is signed in</li>
                <li><b>Role (Job Title)</b> — one of 20 real hospital titles</li>
                <li><b>Permission Profile</b> — derived from the title, never stored</li>
                <li><b>Permissions</b> — derived from the profile, enforced in the service layer</li>
              </ol>
              <div className="lgdisclaimer" role="note">
                <b>Local session only — not authentication.</b> This is role simulation for
                design review: no passwords, tokens, or user directory. The session lives in
                this browser tab (sessionStorage) and survives refresh. Real authentication
                (JWT + user database) arrives with API integration at Stage 10.
              </div>
            </div>

            <form className="lgform" onSubmit={e => { e.preventDefault(); submit() }}>
              <label className="lglabel" htmlFor="lgstaff">Staff member</label>
              <select
                id="lgstaff" className="lgselect" value={idx}
                onChange={e => setIdx(Number(e.target.value))}
              >
                {PROFILE_ORDER.map(p => (
                  <optgroup key={p} label={PROFILE_LABEL[p]}>
                    {SAMPLE_STAFF.map((s, i) =>
                      profileOf(s.jobTitle) === p
                        ? <option key={s.name} value={i}>{s.name} — {s.jobTitle}</option>
                        : null)}
                  </optgroup>
                ))}
              </select>

              <div className="lgderived" aria-live="polite">
                <div className="lgwho">
                  <span className="lgav num">{initialsOf(staff.name)}</span>
                  <div>
                    <b>{staff.name}</b>
                    <small>{staff.jobTitle}</small>
                  </div>
                  <span className="lgprofile">{profile} profile</span>
                </div>
                <div className="lgperms">
                  {permissions.map(p => <i key={p} className="lgperm">{p}</i>)}
                </div>
                <div className="lglanding">Dashboard resolves to <b className="num">{landing}</b></div>
              </div>

              <button type="submit" className="lgsubmit">Sign in →</button>

              {existing && (
                <div className="lgexisting">
                  Currently signed in as <b>{existing.name}</b> ({existing.jobTitle}) — signing in
                  replaces that local session, or{' '}
                  <button type="button" className="lgcontinue" onClick={() => navigate(landingRouteOf(existing.jobTitle))}>
                    continue as {existing.name} →
                  </button>
                </div>
              )}
            </form>
          </div>
        </section>
        <footer className="lgfoot">AURORA HIS v4.2 · Stage 9 role simulation · predictions &amp; data are mock until Stage 10/11</footer>
      </main>
    </div>
  )
}

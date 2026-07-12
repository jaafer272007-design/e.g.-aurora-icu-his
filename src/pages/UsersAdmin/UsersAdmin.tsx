import { useCallback, useEffect, useMemo, useState } from 'react'
import './UsersAdmin.css'
import { AppHeader, type KpiSpec } from '../../components/AppHeader'
import { NavSidebar } from '../../components/NavSidebar'
import { Card } from '../../components/Card'
import { Toast, useToast } from '../../components/Toast'
import { IconAdmit, IconCheck, IconClock, IconUsers } from '../../components/icons'
import {
  createUser, deactivateUser, editUser, getUsers, reactivateUser, resetUserPassword,
} from '../../lib/api'
import type { AdtWriteResult } from '../../lib/api'
import type { UserAccount } from '../../lib/api/types'
import {
  JOB_TITLES, getSession, initialsOf, permissionsOf, profileOf, usernameOf,
  type JobTitle, type PermissionProfile,
} from '../../lib/session'

/** Layer 3 — User Administration (/admin/users, Aurora Core). Administrator
 *  profile only (users.manage — the route guard renders Access Restricted
 *  for everyone else; the server re-enforces it on every endpoint).
 *
 *  The privilege-escalation surface is the screen's central concern: the
 *  DERIVATION CHAIN (JobTitle → PermissionProfile → Permissions) is shown
 *  live while assigning a title, so an admin sees exactly what authority
 *  they are granting BEFORE they grant it, and clinical titles (Doctor /
 *  Nurse profile) demand a written justification that lands in the
 *  account's immutable audit history. Deactivation is a status change,
 *  never a delete. Writes are REAL-ONLY — identity is the durable system
 *  of record. */

const titleProfileOf = (title: string): PermissionProfile | null =>
  (JOB_TITLES as readonly string[]).includes(title) ? profileOf(title as JobTitle) : null

/* Doctor / SeniorDoctor / Nurse (SeniorDoctor added by Stage 11's F4
   decision — the Consultant title's profile, a Doctor superset) */
const CLINICAL_PROFILES: readonly PermissionProfile[] = ['Doctor', 'SeniorDoctor', 'Nurse']

const isClinical = (title: string): boolean => {
  const p = titleProfileOf(title)
  return p !== null && CLINICAL_PROFILES.includes(p)
}

/** the JobTitle → Profile → Permissions chain, live for the selected title —
 *  what authority is being granted, visible before it is granted */
function DerivationChain({ title }: { title: string }) {
  const prof = titleProfileOf(title)
  if (!prof) return null
  return (
    <div className="uachain" role="note" aria-label="Authority derived from the selected job title">
      <div className="uachainrow">
        <span className="uastep">{title}</span>
        <span className="uaarrow" aria-hidden>→</span>
        <span className={`uastep uaprof ${CLINICAL_PROFILES.includes(prof) ? 'clinical' : ''}`}>{prof} profile</span>
      </div>
      <div className="uaperms">
        {permissionsOf(title as JobTitle).map(p => <span className="uaperm num" key={p}>{p}</span>)}
      </div>
      {isClinical(title) && (
        <div className="uaclinnote">
          Clinical authority — granting this title requires a justification (recorded in the audit history).
        </div>
      )}
    </div>
  )
}

export function UsersAdmin() {
  const { toast, showToast } = useToast()
  const session = getSession()!
  const selfUsername = usernameOf(session.name)

  const [users, setUsers] = useState<UserAccount[] | null>(null)
  const [busy, setBusy] = useState(false)

  /* one inline panel open at a time: edit / reset / confirm-deactivate / history */
  const [panel, setPanel] = useState<{ kind: 'edit' | 'reset' | 'deactivate' | 'history'; username: string } | null>(null)
  const [rowError, setRowError] = useState<{ username: string; error: string } | null>(null)

  /* create form */
  const [cUsername, setCUsername] = useState('')
  const [cName, setCName] = useState('')
  const [cTitle, setCTitle] = useState('')
  const [cPassword, setCPassword] = useState('')
  const [cJustification, setCJustification] = useState('')
  const [formError, setFormError] = useState<string | null>(null)

  /* edit / reset panel fields */
  const [eName, setEName] = useState('')
  const [eTitle, setETitle] = useState('')
  const [eJustification, setEJustification] = useState('')
  const [rPassword, setRPassword] = useState('')

  const reload = useCallback(() => { getUsers().then(setUsers) }, [])
  useEffect(() => { reload() }, [reload])

  const stats = useMemo(() => {
    const all = users ?? []
    return {
      total: all.length,
      active: all.filter(u => u.active).length,
      deactivated: all.filter(u => !u.active).length,
      admins: all.filter(u => u.active && titleProfileOf(u.jobTitle) === 'Administrator').length,
    }
  }, [users])

  const kpis: KpiSpec[] = [
    { icon: <IconUsers size={14} stroke="var(--blue)" />, iconBg: 'rgba(77,163,255,.15)', value: users ? stats.total : '—', label: 'Accounts' },
    { icon: <IconCheck size={12} stroke="var(--green)" />, iconBg: 'rgba(61,232,160,.13)', value: users ? stats.active : '—', label: 'Active' },
    { icon: <IconClock size={14} stroke="var(--amber)" />, iconBg: 'rgba(255,180,84,.14)', value: users ? stats.deactivated : '—', label: 'Deactivated' },
    { icon: <IconAdmit size={14} stroke="var(--violet)" />, iconBg: 'rgba(167,139,250,.14)', value: users ? stats.admins : '—', label: 'Active Administrators' },
  ]

  const offlineMsg = (what: string) => `User administration requires the live server — ${what} was NOT saved`

  async function applyWrite(username: string | null, what: string, run: () => Promise<AdtWriteResult<UserAccount>>, onOk: (u: UserAccount) => void) {
    setBusy(true); setRowError(null); setFormError(null)
    const res = await run()
    setBusy(false)
    if (res.kind === 'ok') { onOk(res.data); reload(); return }
    const error = res.kind === 'rejected' ? res.error : offlineMsg(what)
    if (username) setRowError({ username, error })
    else setFormError(error)
  }

  async function doCreate() {
    await applyWrite(null, 'the account', () => createUser({
      username: cUsername.trim(), name: cName.trim(), jobTitle: cTitle,
      initialPassword: cPassword,
      ...(cJustification.trim() ? { justification: cJustification.trim() } : {}),
    }), u => {
      showToast('Account created', `${u.name} (${u.username}) — ${u.jobTitle}`)
      setCUsername(''); setCName(''); setCTitle(''); setCPassword(''); setCJustification('')
    })
  }

  async function doEdit(u: UserAccount) {
    const draft = {
      ...(eName.trim() && eName.trim() !== u.name ? { name: eName.trim() } : {}),
      ...(eTitle && eTitle !== u.jobTitle ? { jobTitle: eTitle } : {}),
      ...(eJustification.trim() ? { justification: eJustification.trim() } : {}),
    }
    await applyWrite(u.username, 'the change', () => editUser(u.username, draft), upd => {
      showToast('Account updated', `${upd.name} — ${upd.jobTitle}`)
      setPanel(null)
    })
  }

  async function doDeactivate(u: UserAccount) {
    await applyWrite(u.username, 'the deactivation', () => deactivateUser(u.username), upd => {
      showToast('Account deactivated', `${upd.username} can no longer sign in (record kept — never deleted)`)
      setPanel(null)
    })
  }

  async function doReactivate(u: UserAccount) {
    await applyWrite(u.username, 'the reactivation', () => reactivateUser(u.username), upd => {
      showToast('Account reactivated', `${upd.username} can sign in again`)
    })
  }

  async function doReset(u: UserAccount) {
    await applyWrite(u.username, 'the password reset', () => resetUserPassword(u.username, rPassword), upd => {
      showToast('Password reset', `${upd.username} — a new password is set (the old one is never shown)`)
      setPanel(null); setRPassword('')
    })
  }

  function openPanel(kind: 'edit' | 'reset' | 'deactivate' | 'history', u: UserAccount) {
    setRowError(null); setRPassword('')
    if (panel?.kind === kind && panel.username === u.username) { setPanel(null); return }
    if (kind === 'edit') { setEName(u.name); setETitle(u.jobTitle); setEJustification('') }
    setPanel({ kind, username: u.username })
  }

  return (
    <div className="app-frame ua">
      <AppHeader
        subtitle="User Administration · Aurora Core"
        kpis={kpis}
        user={{ initials: initialsOf(session.name), name: session.name, role: `${session.jobTitle} · ${profileOf(session.jobTitle)} profile` }}
      />
      <div className="shell">
        <NavSidebar active="users" alertCount={0} footerLines={['Role: Administrator', 'Identity · Aurora Core']} />

        <main>
          <div className="uanote" role="note">
            Job titles carry authority: the derivation chain (JobTitle → Profile → Permissions) is shown
            before any title is granted. Clinical titles require a justification; every action here is
            recorded on the account&apos;s permanent audit history. Deactivated accounts are kept forever —
            an account that signed an order must stay resolvable.
          </div>

          <div className="uacols">
            <Card icon={<IconUsers size={15} stroke="var(--blue)" />} title="Staff Accounts" aside={users ? `${stats.active} active · ${stats.deactivated} deactivated` : '—'}>
              <div className="uarows">
                {(users ?? []).map(u => {
                  const prof = titleProfileOf(u.jobTitle)
                  const self = u.username === selfUsername
                  const open = panel?.username === u.username ? panel.kind : null
                  return (
                    <div className={`uarow${u.active ? '' : ' off'}`} key={u.username}>
                      <div className="uamain">
                        <span className="uawho">
                          <b>{u.name}{self && <i className="uaself"> · you</i>}</b>
                          <small className="num">{u.username}</small>
                        </span>
                        <span className="uarole">
                          <span>{u.jobTitle}</span>
                          <small className={`uaprofile${prof !== null && CLINICAL_PROFILES.includes(prof) ? ' clinical' : ''}`}>
                            {prof ?? 'unknown title'} profile · derived
                          </small>
                        </span>
                        <span className={`uastatus ${u.active ? 'on' : 'offed'}`}>{u.active ? 'Active' : 'Deactivated'}</span>
                        <span className="uaacts">
                          <button className="uaact" onClick={() => openPanel('history', u)} aria-expanded={open === 'history'}>
                            History ({u.events.length})
                          </button>
                          <button className="uaact" onClick={() => openPanel('edit', u)} aria-expanded={open === 'edit'}>Edit</button>
                          <button className="uaact" onClick={() => openPanel('reset', u)} aria-expanded={open === 'reset'}>Reset password</button>
                          {u.active && !self && (
                            <button className="uaact warn" onClick={() => openPanel('deactivate', u)} aria-expanded={open === 'deactivate'}>Deactivate</button>
                          )}
                          {!u.active && (
                            <button className="uaact" disabled={busy} onClick={() => doReactivate(u)}>Reactivate</button>
                          )}
                        </span>
                      </div>

                      {open === 'history' && (
                        <div className="uapanel" role="region" aria-label={`Audit history: ${u.username}`}>
                          {u.events.length === 0 && <div className="uaempty">No management events — this account predates Layer 3 user administration.</div>}
                          {u.events.map((e, i) => (
                            <div className="uaevent" key={i}>
                              <span className="num">{e.time || '—'}</span>
                              <span><b>{e.action}</b>{e.detail ? ` — ${e.detail}` : ''}</span>
                              <small>by {e.actor}</small>
                            </div>
                          ))}
                        </div>
                      )}

                      {open === 'edit' && (
                        <div className="uapanel" role="region" aria-label={`Edit account: ${u.username}`}>
                          <div className="uafields">
                            <label>Full name
                              <input value={eName} onChange={ev => setEName(ev.target.value)} disabled={busy} />
                            </label>
                            <label>Job title
                              <select value={eTitle} onChange={ev => { setETitle(ev.target.value) }} disabled={busy}>
                                {JOB_TITLES.map(t => <option key={t} value={t}>{t}</option>)}
                              </select>
                            </label>
                            {isClinical(eTitle) && eTitle !== u.jobTitle && (
                              <label className="uawide">Justification (required — clinical authority)
                                <input value={eJustification} onChange={ev => setEJustification(ev.target.value)} disabled={busy}
                                  placeholder="why this account needs ordering/administering authority" />
                              </label>
                            )}
                          </div>
                          {eTitle !== u.jobTitle && <DerivationChain title={eTitle} />}
                          <div className="uapanelacts">
                            <button className="uaact go" disabled={busy} onClick={() => doEdit(u)}>{busy ? 'Saving…' : 'Save changes'}</button>
                            <button className="uaact" onClick={() => setPanel(null)}>Cancel</button>
                          </div>
                        </div>
                      )}

                      {open === 'reset' && (
                        <div className="uapanel" role="region" aria-label={`Reset password: ${u.username}`}>
                          <div className="uafields">
                            <label>New password (min 8 characters — the old password is never shown)
                              <input type="password" value={rPassword} onChange={ev => setRPassword(ev.target.value)} disabled={busy} autoComplete="new-password" />
                            </label>
                          </div>
                          <div className="uapanelacts">
                            <button className="uaact go" disabled={busy || rPassword.length === 0} onClick={() => doReset(u)}>
                              {busy ? 'Resetting…' : 'Set new password'}
                            </button>
                            <button className="uaact" onClick={() => { setPanel(null); setRPassword('') }}>Cancel</button>
                          </div>
                        </div>
                      )}

                      {open === 'deactivate' && (
                        <div className="uapanel" role="alertdialog" aria-label={`Confirm deactivation: ${u.username}`}>
                          <span className="uaconfirm">
                            Deactivate <b>{u.name}</b>? Sign-in is blocked immediately; the account and its
                            history are kept forever (never deleted).
                          </span>
                          <div className="uapanelacts">
                            <button className="uaact warn" disabled={busy} onClick={() => doDeactivate(u)}>{busy ? 'Deactivating…' : 'Confirm deactivation'}</button>
                            <button className="uaact" onClick={() => setPanel(null)}>Cancel</button>
                          </div>
                        </div>
                      )}

                      {rowError?.username === u.username && <div className="uaerr" role="alert">{rowError.error}</div>}
                    </div>
                  )
                })}
                {users?.length === 0 && <div className="uaempty">No accounts.</div>}
              </div>
            </Card>

            <Card icon={<IconAdmit size={15} stroke="var(--cyan)" />} title="Create Account" aside="admin-set initial password">
              <form className="uaform" onSubmit={ev => { ev.preventDefault(); void doCreate() }}>
                <div className="uafields">
                  <label>Username
                    <input value={cUsername} onChange={ev => setCUsername(ev.target.value)} disabled={busy}
                      placeholder="firstname.lastname" autoComplete="off" />
                  </label>
                  <label>Full name
                    <input value={cName} onChange={ev => setCName(ev.target.value)} disabled={busy} placeholder="Dr. Full Name" />
                  </label>
                  <label>Job title
                    <select value={cTitle} onChange={ev => setCTitle(ev.target.value)} disabled={busy}>
                      <option value="" disabled>Select a job title…</option>
                      {JOB_TITLES.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </label>
                  <label>Initial password (min 8 characters)
                    <input type="password" value={cPassword} onChange={ev => setCPassword(ev.target.value)} disabled={busy} autoComplete="new-password" />
                  </label>
                  {isClinical(cTitle) && (
                    <label className="uawide">Justification (required — clinical authority)
                      <input value={cJustification} onChange={ev => setCJustification(ev.target.value)} disabled={busy}
                        placeholder="why this account needs ordering/administering authority" />
                    </label>
                  )}
                </div>
                {cTitle && <DerivationChain title={cTitle} />}
                {formError && <div className="uaerr" role="alert">{formError}</div>}
                <button className="uasubmit" type="submit"
                  disabled={busy || !cUsername.trim() || !cName.trim() || !cTitle || !cPassword || (isClinical(cTitle) && !cJustification.trim())}>
                  {busy ? 'Creating…' : 'Create account'}
                </button>
              </form>
            </Card>
          </div>
        </main>
      </div>
      <Toast state={toast} accent="blue" />
    </div>
  )
}

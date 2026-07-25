import { useCallback, useEffect, useState } from 'react'
import './BackupRecovery.css'
import { AppHeader, type KpiSpec } from '../../components/AppHeader'
import { NavSidebar } from '../../components/NavSidebar'
import { Card } from '../../components/Card'
import { Toast, useToast } from '../../components/Toast'
import { IconCheck, IconClock, IconShield, IconAlertTriangle } from '../../components/icons'
import {
  getBackupEvents, getBackupHistory, getBackupStatus, restoreBackup,
  rotateBackupKey, runBackupNow, testRestoreBackup, verifyBackup,
} from '../../lib/api'
import type {
  BackupEvent, BackupHistoryEntry, BackupRotateKeyResult, BackupStatus,
  BackupTestRestoreResult, BackupVerifyResult,
} from '../../lib/api/types'
import { displayStamp } from '../../lib/time'
import { getSession, initialsOf, profileOf } from '../../lib/session'

/** Backup & Recovery (/backup — BACKUP_DR_DESIGN.md §6). SYSTEM
 *  ADMINISTRATOR only (backup.manage — IT operations, never clinical; the
 *  route guard renders Access Restricted for everyone else and the server
 *  re-enforces it on every endpoint). REAL-ONLY end to end: there is no
 *  mock backup state — offline/demo renders the honest unavailable panel,
 *  never a pretend "backup ok".
 *
 *  The screen's central concern is the design's centerpiece: a backup
 *  that has never been restored is a hope. Every backup listed here was
 *  BORN restore-verified (its manifest counts/digests were taken from a
 *  scratch restore of that exact dump at creation), Test Restore re-proves
 *  reconstruction into an isolated scratch database on demand, and the
 *  🔴 health banner stays LOUDLY red until a backup has succeeded inside
 *  the 24h RPO — a silently-stopped backup is the classic disaster. */

const fmtBytes = (n: number): string =>
  n >= 1 << 30 ? `${(n / (1 << 30)).toFixed(2)} GB`
  : n >= 1 << 20 ? `${(n / (1 << 20)).toFixed(1)} MB`
  : n >= 1 << 10 ? `${(n / (1 << 10)).toFixed(1)} KB` : `${n} B`

const HEALTH_LABEL: Record<BackupStatus['health'], string> = {
  ok: 'HEALTHY', stale: 'BACKUP OVERDUE', failed: 'LAST BACKUP FAILED', none: 'NO BACKUP EXISTS',
  /* off-site states: the primary backup is fine, but the hospital's only copy
     is on the server — never shown as HEALTHY (that false green is the exact
     comfort this area exists to deny) */
  'offsite-none': 'NO OFF-SITE COPY',
  'offsite-stale': 'OFF-SITE COPY OVERDUE',
  'offsite-failed': 'OFF-SITE COPY FAILED',
}

/** off-site severities that must read as a problem, not a footnote */
const OFFSITE_BAD = new Set(['none', 'stale', 'failed'])

type ResultPanel =
  | { kind: 'verify'; data: BackupVerifyResult }
  | { kind: 'test-restore'; data: BackupTestRestoreResult }
  | { kind: 'restore'; data: BackupTestRestoreResult }

export function BackupRecovery() {
  const { toast, showToast } = useToast()
  const session = getSession()!

  const [status, setStatus] = useState<BackupStatus | null>(null)
  const [history, setHistory] = useState<BackupHistoryEntry[] | null>(null)
  const [events, setEvents] = useState<BackupEvent[] | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState<string | null>(null) // the running action's label
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<ResultPanel | null>(null)
  /* Verify-with-supplied-key (the envelope drill): which file's key input
     is open, and the typed key (kept only in this state, sent once) */
  const [keyFor, setKeyFor] = useState<string | null>(null)
  const [keyHex, setKeyHex] = useState('')
  /* rotate-key ceremony: the new key, shown EXACTLY ONCE until dismissed */
  const [shownKey, setShownKey] = useState<BackupRotateKeyResult | null>(null)
  const [confirmRotate, setConfirmRotate] = useState(false)
  const [wizardOpen, setWizardOpen] = useState(false)
  /* DESTRUCTIVE restore: which file's confirm panel is open + the typed
     confirmation. The button enables only when the operator types REPLACE. */
  const [restoreFor, setRestoreFor] = useState<string | null>(null)
  const [restoreConfirm, setRestoreConfirm] = useState('')
  /* the RECORDED key — required only when restoring a backup this server did
     not make (fresh hardware after the original died). Blank = server's key. */
  const [restoreKey, setRestoreKey] = useState('')

  const reload = useCallback(() => {
    void Promise.all([getBackupStatus(), getBackupHistory(), getBackupEvents(100)])
      .then(([s, h, e]) => { setStatus(s); setHistory(h); setEvents(e); setLoaded(true) })
  }, [])
  useEffect(() => { reload() }, [reload])

  async function run<T>(label: string, call: () => Promise<{ kind: 'ok'; data: T } | { kind: 'rejected'; error: string } | { kind: 'offline' }>,
    onOk: (data: T) => void) {
    setBusy(label); setError(null)
    const res = await call()
    setBusy(null)
    if (res.kind === 'ok') { onOk(res.data); reload(); return }
    setError(res.kind === 'rejected' ? res.error
      : 'The live server is unreachable — backup operations cannot run offline.')
  }

  const doBackupNow = () => run('backup', runBackupNow, m => {
    showToast('Backup complete — restore-verified at creation',
      `${m.file} · ${Object.keys(m.tableCounts).length} tables, ${Object.values(m.tableCounts).reduce((a, b) => a + b, 0)} rows · encrypted with key ${m.keyId}`)
  })

  const doVerify = (file: string, key?: string) => run('verify:' + file,
    () => verifyBackup(file, key), data => {
      setResult({ kind: 'verify', data }); setKeyFor(null); setKeyHex('')
    })

  const doTestRestore = (file: string) => run('test-restore:' + file,
    () => testRestoreBackup(file), data => setResult({ kind: 'test-restore', data }))

  const doRestore = (file: string) => run('restore:' + file,
    () => restoreBackup(file, 'REPLACE', restoreKey.trim() || undefined), data => {
      setResult({ kind: 'restore', data }); setRestoreFor(null); setRestoreConfirm(''); setRestoreKey('')
      if (data.ok) showToast('Restore complete — live database replaced', data.summary)
    })

  const doRotate = () => run('rotate-key', rotateBackupKey, r => {
    setConfirmRotate(false); setShownKey(r)
  })

  const kpis: KpiSpec[] = [
    {
      icon: <IconShield size={15} stroke="var(--ink)" />,
      iconBg: status == null ? 'var(--dim)' : status.health === 'ok' ? 'var(--green)' : 'var(--red)',
      value: status == null ? '—' : HEALTH_LABEL[status.health],
      label: 'backup health',
    },
    { icon: <IconClock size={15} stroke="var(--ink)" />, iconBg: 'var(--blue)', value: status?.lastSuccessAt ? displayStamp(status.lastSuccessAt) : 'never', label: 'last backup' },
    { icon: <IconCheck size={13} stroke="var(--ink)" />, iconBg: 'var(--cyan)', value: String(status?.backupCount ?? '—'), label: 'backups held' },
  ]

  const offline = loaded && status === null

  return (
    <div className="app-frame bk">
      <AppHeader
        subtitle="Backup & Disaster Recovery · Aurora Core"
        kpis={kpis}
        user={{ initials: initialsOf(session.name), name: session.name, role: `${session.jobTitle} · ${profileOf(session.jobTitle)} profile` }}
      />
      <div className="shell">
        <NavSidebar active="backup" alertCount={0} footerLines={['System Administrator only', 'Every operation is audited immutably']} />

        <main>
          {/* 🔴 the LOUD persistent health alert (design §6): red until a
              backup has succeeded inside the 24h RPO — never dismissible */}
          {status != null && status.health !== 'ok' && (
            <div className="bkalert" role="alert">
              <IconAlertTriangle size={18} plain />
              <div>
                <b>{HEALTH_LABEL[status.health]}</b>
                <span>{status.healthDetail}</span>
              </div>
            </div>
          )}
          {offline && (
            <div className="bkalert" role="alert">
              <IconAlertTriangle size={18} plain />
              <div>
                <b>BACKUP STATUS UNAVAILABLE</b>
                <span>
                  The live server is unreachable (or this is the offline demo). There is deliberately no
                  mock backup state — a pretend &ldquo;backup ok&rdquo; is the exact false comfort this area exists
                  to prevent. Connect to the appliance to manage backups.
                </span>
              </div>
            </div>
          )}
          {error && <div className="bkerror" role="alert">{error}</div>}

          {/* show-once key ceremony — rendered ABOVE everything until the
              operator confirms it is recorded in all three places */}
          {shownKey && (
            <div className="bkkey" role="alertdialog" aria-label="New backup key — shown exactly once">
              <b>NEW BACKUP KEY — SHOWN EXACTLY ONCE. RECORD IT NOW.</b>
              <div className="bkkeyrow"><span>key id</span><code className="num">{shownKey.newKeyId}</code></div>
              <div className="bkkeyrow"><span>key</span><code className="num bkkeyhex">{shownKey.keyHexShownOnce}</code></div>
              <p>
                Record this key in <b>all three places</b> before doing anything else: the <b>sealed envelope</b> in
                the hospital safe · the enterprise <b>password manager</b> · the <b>hospital-management copy</b>.
                The server keeps its own copy for unattended nightly backups, but the server&apos;s death loses that
                copy — a key that exists only on the server dies with the server. Backups made before this rotation
                still need the <b>old</b> key ({shownKey.oldKeyId || 'none'}) — keep every recorded envelope.
              </p>
              <button className="bkbtn warn" onClick={() => setShownKey(null)}>
                I have recorded the key in all three places — dismiss forever
              </button>
            </div>
          )}

          <div className="bkcols">
            {/* ---------------- Dashboard ---------------- */}
            <Card icon={<IconShield size={15} stroke="var(--blue)" />} title="Backup Dashboard"
              aside={status ? `key ${status.keyId || 'NOT INITIALISED'}` : '—'}>
              {status == null ? <div className="bkempty">No live status.</div> : (
                <>
                  <div className="bkfacts">
                    <div><span>Last successful backup</span><b className="num">{status.lastSuccessAt ? displayStamp(status.lastSuccessAt) : 'never'}</b></div>
                    <div><span>Next scheduled</span><b className="num">{status.nextScheduled ? displayStamp(status.nextScheduled) : '—'}</b></div>
                    <div><span>Schedule</span><b>{status.schedule} (hospital time) · Windows Task Scheduler</b></div>
                    <div><span>On-server target</span><b className="num">{status.backupCount} backups · {fmtBytes(status.totalBytes)} · {status.backupDir}</b></div>
                    <div>
                      <span>Retention (GFS, auto-pruned)</span>
                      <b>{status.retention.dailyHeld}/{status.retention.dailyKeep} daily · {status.retention.weeklyHeld}/{status.retention.weeklyKeep} weekly · {status.retention.monthlyHeld}/{status.retention.monthlyKeep} monthly</b>
                    </div>
                    <div>
                      <span>External USB disk (off-site copy)</span>
                      <b className={OFFSITE_BAD.has(status.externalDisk.severity) ? 'bkbad' : undefined}>
                        {!status.externalDisk.configured
                          ? 'NOT CONFIGURED — backups exist only on this server'
                          : status.externalDisk.lastCopyAt
                            ? `last copy ${displayStamp(status.externalDisk.lastCopyAt)}`
                              + (status.externalDisk.staleDays != null ? ` (${status.externalDisk.staleDays}d ago)` : '')
                              + (status.externalDisk.severity === 'stale' ? ` — OVERDUE, limit ${status.externalDisk.maxAgeDays}d` : '')
                              + (status.externalDisk.severity === 'failed' ? ' — LAST ATTEMPT FAILED' : '')
                            : status.externalDisk.detail ?? 'no copy recorded yet'}
                      </b>
                    </div>
                    <div><span>Encryption</span><b>AES-256-GCM (authenticated) · key id <span className="num">{status.keyId || 'NOT INITIALISED'}</span></b></div>
                  </div>
                  <div className="bkactions">
                    <button className="bkbtn" disabled={busy != null} onClick={doBackupNow}>
                      {busy === 'backup' ? 'Backing up + restore-verifying…' : 'Backup now'}
                    </button>
                    {!confirmRotate
                      ? <button className="bkbtn ghost" disabled={busy != null} onClick={() => setConfirmRotate(true)}>Rotate key…</button>
                      : (
                        <span className="bkconfirm">
                          <span>
                            Rotation generates a NEW key. It <b>cannot show you the current one</b> — nothing can,
                            by design. {(() => {
                              const orphaned = (history ?? []).filter(h => h.keyId === status?.keyId).length
                              return orphaned > 0
                                ? `The ${orphaned} backup${orphaned === 1 ? '' : 's'} made with key ${status?.keyId} will ONLY open with that key from then on — if its envelope is not recorded, ${orphaned === 1 ? 'it becomes' : 'they become'} permanently unreadable.`
                                : 'Existing backups keep needing the key they were made with.'
                            })()} Continue?
                          </span>
                          <button className="bkbtn warn" disabled={busy != null} onClick={doRotate}>
                            {busy === 'rotate-key' ? 'Rotating…' : 'Rotate the key'}
                          </button>
                          <button className="bkbtn ghost" onClick={() => setConfirmRotate(false)}>Cancel</button>
                        </span>
                      )}
                    <button className="bkbtn ghost" onClick={() => setWizardOpen(o => !o)} aria-expanded={wizardOpen}>
                      Restore Wizard
                    </button>
                  </div>
                  <p className="bknote">
                    Every backup is <b>born restore-verified</b>: before it is declared successful, the dump is
                    restored into a scratch database and the manifest&apos;s record counts and per-table content
                    digests are taken from that restored copy — restorability is proven on every run, not
                    just at go-live.
                  </p>
                </>
              )}
            </Card>

            {/* ---------------- Restore Wizard (guided runbook) ---------------- */}
            {wizardOpen && (
              <Card icon={<IconShield size={15} stroke="var(--red)" />} title="Restore Wizard — disaster runbook" aside="for a DEAD server (cross-machine)">
                <p className="bknote" style={{ marginTop: 0 }}>
                  To recover onto THIS running server (e.g. undo a bad change), use the <b>Restore…</b> button on
                  any backup in Backup History below — no commands needed. This runbook is for the harder case:
                  the server itself is <b>gone</b>, and you are rebuilding on a fresh machine from the off-site copy.
                </p>
                <ol className="bkwizard">
                  <li>
                    <b>Gather the FOUR things a rebuild needs.</b> (1) The <b>installer</b>
                    <code> AuroraSetup-&lt;ver&gt;.exe</code> — keep a copy OFF this server, it cannot be rebuilt
                    in a crisis. (2) The newest backup <b>pair</b> from the off-site disk:
                    <code> aurora-*.aurbk</code> <b>and</b> <code>aurora-*.manifest.json</code> — the manifest is
                    mandatory, a restore refuses without it. (3) The <b>backup key</b> from a recorded copy
                    (sealed envelope / password manager / hospital-management copy) — the dead server&apos;s key
                    file is NOT needed, but without a recorded copy the backup can never be opened by anyone.
                    (4) A working <b>administrator username + password from the OLD system</b> — see step 5.
                  </li>
                  <li>
                    <b>Install Aurora normally</b> on the replacement Windows machine — the same
                    next-next-finish install. It comes up empty, with its OWN new backup key. That is expected.
                  </li>
                  <li>
                    <b>Put the backup pair where this machine looks for backups.</b> Copy BOTH files off the
                    off-site disk into the new server&apos;s backup folder (the <b>On-server target</b> path shown
                    on this dashboard). A backup left on the USB does not appear in Backup History.
                  </li>
                  <li>
                    <b>Prove the key first, then restore.</b> On the copied backup use
                    <b> Verify with recorded key…</b> and paste the recorded key — all checks must pass. Then use
                    <b> Restore…</b>; because the backup was made by a DIFFERENT machine, the panel asks for that
                    same recorded key. It is restored into a scratch copy and matched against the manifest
                    BEFORE anything is written, then the live database is replaced and the
                    source-vs-restored table is shown. <b>A restore that completes but loses rows is a FAILED
                    restore</b> — if any count or digest differs, stop and try the previous backup.
                  </li>
                  <li>
                    <b>Sign in with an OLD administrator account.</b> The restore replaces the user table with
                    the dead server&apos;s, so the new install&apos;s fresh <code>admin</code> password is gone —
                    the old system&apos;s credentials are what work now. Spot-check patients, and re-check the
                    hospital timezone in Configuration (a rebuilt machine starts at UTC).
                  </li>
                  <li>
                    <b>Re-establish protection immediately.</b> Confirm the nightly backup task exists, set the
                    off-site disk again, and take one <b>Backup now</b> — until that succeeds the rebuilt
                    hospital has no backup of its own.
                  </li>
                </ol>
                <p className="bknote">
                  Everything above is done from this screen — no command line. If the app cannot be reached at
                  all, the same engine is available as operator commands
                  (<code>AuroraIcu.Api.exe verify | restore --key … </code>) from the install folder.
                </p>
              </Card>
            )}

            {/* ---------------- result panel (verify / test-restore) ---------------- */}
            {result && (
              <Card icon={<IconCheck size={14} stroke={result.data.ok ? 'var(--green)' : 'var(--red)'} />}
                title={result.kind === 'verify' ? `Verify — ${result.data.file}`
                  : result.kind === 'restore' ? `Restore — ${result.data.file}`
                  : `Test Restore — ${result.data.file}`}
                aside={<button className="bkbtn ghost sm" onClick={() => setResult(null)}>Close</button>}>
                {result.kind !== 'verify' && (
                  <div className={`bksummary ${result.data.ok ? 'ok' : 'bad'}`}>{result.data.summary}</div>
                )}
                <div className="bkchecks">
                  {result.data.checks.map(c => (
                    <div key={c.check} className={`bkcheck ${c.ok ? 'ok' : 'bad'}`}>
                      <span className="bkcheckname">{c.ok ? '✓' : '✗'} {c.check}</span>
                      <span>{c.detail}</span>
                    </div>
                  ))}
                </div>
                {result.kind !== 'verify' && result.data.tables.length > 0 && (
                  <div className="bktablewrap">
                    <table className="bktable num">
                      <thead>
                        <tr><th>table</th><th>source</th><th>restored</th><th>counts</th><th>integrity</th></tr>
                      </thead>
                      <tbody>
                        {result.data.tables.map(t => (
                          <tr key={t.table} className={t.countMatch && t.digestMatch ? '' : 'bad'}>
                            <td className="bktname">{t.table}</td>
                            <td>{t.sourceCount}</td>
                            <td>{t.restoredCount}</td>
                            <td>{t.countMatch ? 'MATCH' : 'DIFFER'}</td>
                            <td>{t.digestMatch ? 'MATCH' : 'DIFFER'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Card>
            )}

            {/* ---------------- history ---------------- */}
            <Card icon={<IconClock size={15} stroke="var(--blue)" />} title="Backup History"
              aside={history ? `${history.length} held under GFS retention` : '—'}>
              {(history ?? []).length === 0
                ? <div className="bkempty">{history == null ? 'No live history.' : 'No backups yet — the first nightly run (or Backup now) creates one.'}</div>
                : (
                  <div className="bkrows">
                    {(history ?? []).map(h => (
                      <div className="bkrow" key={h.file}>
                        <div className="bkmain">
                          <span className="bkfile">
                            <b className="num">{h.file}</b>
                            <small className="num">{displayStamp(h.createdAtUtc)} · {fmtBytes(h.sizeBytes)} · {h.tableCount} tables · {h.rowTotal} rows · key {h.keyId} · TZ {h.timeZone}</small>
                          </span>
                          <span className="bkverified">
                            {h.lastVerifiedAt
                              ? <small className={h.lastVerifyKind?.endsWith(':success') ? 'good' : 'badtx'}>{h.lastVerifyKind} · {displayStamp(h.lastVerifiedAt)}</small>
                              : <small>born restore-verified · not re-checked since</small>}
                          </span>
                          <span className="bkacts">
                            <button className="bkbtn sm" disabled={busy != null}
                              onClick={() => doVerify(h.file)}>
                              {busy === 'verify:' + h.file ? 'Verifying…' : 'Verify'}
                            </button>
                            <button className="bkbtn sm ghost" disabled={busy != null}
                              onClick={() => { setKeyFor(keyFor === h.file ? null : h.file); setKeyHex('') }}
                              aria-expanded={keyFor === h.file}>
                              Verify with recorded key…
                            </button>
                            <button className="bkbtn sm" disabled={busy != null}
                              onClick={() => doTestRestore(h.file)}>
                              {busy === 'test-restore:' + h.file ? 'Restoring to scratch…' : 'Test Restore'}
                            </button>
                            <button className="bkbtn sm danger" disabled={busy != null}
                              onClick={() => { setRestoreFor(restoreFor === h.file ? null : h.file); setRestoreConfirm(''); setKeyFor(null) }}
                              aria-expanded={restoreFor === h.file}>
                              Restore…
                            </button>
                          </span>
                        </div>
                        {restoreFor === h.file && (
                          <div className="bkrestore" role="region" aria-label={`Restore the live database from ${h.file}`}>
                            <div className="bkrestorewarn">
                              <IconAlertTriangle size={16} plain />
                              <div>
                                <b>This REPLACES the entire live database with this backup.</b>
                                <span>
                                  Everything entered after this backup (<span className="num">{displayStamp(h.createdAtUtc)}</span>)
                                  is permanently lost, and the system briefly goes offline while it rebuilds. The backup is
                                  first restored into a scratch copy and proven to match — if it doesn&apos;t, the live
                                  database is left untouched. Type <b>REPLACE</b> to confirm.
                                </span>
                              </div>
                            </div>
                            {h.keyId !== status?.keyId && (
                              <label className="bkrestorekey">
                                <span>
                                  This backup was made with key <b className="num">{h.keyId}</b>, but this server&apos;s
                                  key is <b className="num">{status?.keyId || 'none'}</b> — so this is a backup from
                                  ANOTHER machine. Paste the <b>recorded key {h.keyId}</b> (sealed envelope / password
                                  manager) to restore it here:
                                </span>
                                <input className="num" type="password" autoComplete="off" placeholder="64 hex characters"
                                  value={restoreKey} onChange={e => setRestoreKey(e.target.value)} />
                              </label>
                            )}
                            <div className="bkrestorerow">
                              <input aria-label="Type REPLACE to confirm" type="text" autoComplete="off"
                                placeholder="REPLACE" value={restoreConfirm} onChange={e => setRestoreConfirm(e.target.value)} />
                              <button className="bkbtn sm danger" disabled={busy != null || restoreConfirm.trim() !== 'REPLACE'}
                                onClick={() => doRestore(h.file)}>
                                {busy === 'restore:' + h.file ? 'Restoring — replacing live data…' : 'Restore & replace live data'}
                              </button>
                              <button className="bkbtn sm ghost" disabled={busy != null}
                                onClick={() => { setRestoreFor(null); setRestoreConfirm(''); setRestoreKey('') }}>Cancel</button>
                            </div>
                          </div>
                        )}
                        {keyFor === h.file && (
                          <div className="bkkeyentry" role="region" aria-label={`Verify ${h.file} with a recorded key`}>
                            <label htmlFor={`bkkey-${h.file}`}>
                              Paste the key from a RECORDED copy (envelope / password manager) — this drill proves
                              the off-server copy actually decrypts, without touching the server&apos;s key file:
                            </label>
                            <input id={`bkkey-${h.file}`} className="num" type="password" autoComplete="off"
                              placeholder="64 hex characters" value={keyHex} onChange={e => setKeyHex(e.target.value)} />
                            <button className="bkbtn sm" disabled={busy != null || keyHex.trim().length === 0}
                              onClick={() => doVerify(h.file, keyHex.trim())}>
                              {busy === 'verify:' + h.file ? 'Verifying…' : 'Verify with this key'}
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              <p className="bknote">
                <b>Verify</b> checks integrity without a restore: file hash, GCM authentication (every byte),
                dump readability, table count vs manifest. <b>Test Restore</b> fully reconstructs the backup in
                an <b>isolated scratch database</b> and compares source-vs-restored record counts and content
                digests — <b>live data is never touched</b>. <b>Restore…</b> is the real recovery on THIS server:
                it <b>replaces the live database</b> with the backup (you must type <b>REPLACE</b>), and it too
                proves the backup in a scratch copy first, so a bad backup can never wipe your data.
              </p>
            </Card>

            {/* ---------------- immutable audit ---------------- */}
            <Card icon={<IconCheck size={14} stroke="var(--cyan)" />} title="Backup Audit Trail"
              aside={events ? `${events.length} most recent · append-only` : '—'}>
              {(events ?? []).length === 0
                ? <div className="bkempty">{events == null ? 'No live audit.' : 'No backup/DR events recorded yet.'}</div>
                : (
                  <div className="bkevents">
                    {(events ?? []).map(e => (
                      <div className={`bkevent ${e.outcome === 'success' ? '' : 'bad'}`} key={e.id}>
                        <span className="num">{displayStamp(e.at)}</span>
                        <span><b>{e.kind}</b> · {e.outcome}{e.file ? <small className="num"> · {e.file}</small> : null}</span>
                        <small>by {e.actor}</small>
                      </div>
                    ))}
                  </div>
                )}
              <p className="bknote">
                Every backup, verification, test restore, restore, key rotation, retention prune and USB copy
                writes one immutable event — there is no endpoint to edit or delete them, and because the trail
                lives in the hospital database, <b>every backup captures its own audit trail</b>.
              </p>
            </Card>
          </div>
        </main>
      </div>
      <Toast state={toast} accent="blue" />
    </div>
  )
}

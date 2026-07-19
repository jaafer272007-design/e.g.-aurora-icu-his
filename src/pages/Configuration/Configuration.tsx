import { useCallback, useEffect, useMemo, useState } from 'react'
import '../UsersAdmin/UsersAdmin.css'
import { AppHeader, type KpiSpec } from '../../components/AppHeader'
import { NavSidebar } from '../../components/NavSidebar'
import { Card } from '../../components/Card'
import { Toast, useToast } from '../../components/Toast'
import { IconCheck, IconClock, IconFlask, IconGrid, IconPulse, IconSettings } from '../../components/icons'
import {
  createCodeStatus, createImagingStudy, deactivateCodeStatus, deactivateImagingStudy,
  deleteImagingStudy, getCodeStatuses, getHospitalIdentityHistory, getImagingCatalog,
  reactivateCodeStatus, reactivateImagingStudy, updateCodeStatus, updateHospitalIdentity,
  updateImagingStudy,
} from '../../lib/api'
import type { AdtWriteResult } from '../../lib/api'
import type { CodeStatusEntry, HospitalIdentityWithHistory, ImagingStudyDef } from '../../lib/api/types'
import { IMAGING_MODALITIES } from '../../lib/api/types'
import { invalidateHospitalIdentity } from '../../lib/hospitalIdentity'
import { getSession, hasPermission, initialsOf, profileOf } from '../../lib/session'

/* ==================== Configuration (/config) ====================
   The per-hospital CONFIGURATION AREA — what varies from one hospital to
   the next is editable, governed DATA here, never a code change (one
   codebase, many configurations, zero forks).

   MULTI-TENANT (the Config Home + Hospital Identity design — the
   recorded per-section-gating flag from the code-status PR, realized):
   ONE area, each section gated to its OWN authority, and a session sees
   only its sections. The administrative/clinical split, confirmed:
   - HOSPITAL IDENTITY (hospital.configure — office Administrator): the
     install's own name/unit/short name/letterhead address —
     administrative, no clinical data, finally a config surface that IS
     the office profile's. One record: edit-in-place, audited,
     amend-never-erase.
   - CODE STATUS VOCABULARY (codestatus.manage — SeniorDoctor): clinical
     governance, the observations.configure precedent; never the office
     Administrator.
   - IMAGING CATALOGUE (imagingcatalog.manage — Ancillary +
     SeniorDoctor, the lab-catalogue gating; a DISTINCT atom because
     radiology and the lab are different producing services): the coded
     study definitions imaging ordering reads — the third tenant, and
     the one that UNBLOCKED production imaging ordering.
   Future tenants (beds, dispositions, …) add sections here on the same
   pattern — extend, never duplicate.

   Every manager uses the formulary/lab-catalogue pattern: validated
   REAL-ONLY writes, append-only audit, deactivate-never-delete (where a
   lifecycle exists). */
export function Configuration() {
  const { toast, showToast } = useToast()
  const session = getSession()!
  const canIdentity = hasPermission(session.jobTitle, 'hospital.configure')
  const canCodeStatus = hasPermission(session.jobTitle, 'codestatus.manage')
  const canImaging = hasPermission(session.jobTitle, 'imagingcatalog.manage')

  /* ---- code status vocabulary (clinical section) ---- */
  const [entries, setEntries] = useState<CodeStatusEntry[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [panel, setPanel] = useState<{ kind: 'edit' | 'retire' | 'history'; code: string } | null>(null)
  const [rowError, setRowError] = useState<{ code: string; error: string } | null>(null)
  const [formError, setFormError] = useState<string | null>(null)

  const [cCode, setCCode] = useState('')
  const [cLabel, setCLabel] = useState('')
  const [eLabel, setELabel] = useState('')

  /* ---- imaging catalogue (clinical section — lab-catalogue gating) ---- */
  const [imgStudies, setImgStudies] = useState<ImagingStudyDef[] | null>(null)
  const [imgBusy, setImgBusy] = useState(false)
  const [imgPanel, setImgPanel] = useState<{ kind: 'edit' | 'retire' | 'history'; id: string } | null>(null)
  const [imgRowError, setImgRowError] = useState<{ id: string; error: string } | null>(null)
  const [imgFormError, setImgFormError] = useState<string | null>(null)
  const [iId, setIId] = useState('')
  const [iName, setIName] = useState('')
  const [iModality, setIModality] = useState('CXR')
  const [iRegion, setIRegion] = useState('')
  const [iContrast, setIContrast] = useState(false)
  const [iPortable, setIPortable] = useState(false)
  const [eiName, setEiName] = useState('')
  const [eiModality, setEiModality] = useState('CXR')
  const [eiRegion, setEiRegion] = useState('')
  const [eiContrast, setEiContrast] = useState(false)
  const [eiPortable, setEiPortable] = useState(false)

  /* ---- hospital identity (administrative section) ---- */
  const [ident, setIdent] = useState<HospitalIdentityWithHistory | null>(null)
  const [identLoaded, setIdentLoaded] = useState(false)
  const [hName, setHName] = useState('')
  const [hUnit, setHUnit] = useState('')
  const [hShort, setHShort] = useState('')
  const [hAddr, setHAddr] = useState('')
  const [identBusy, setIdentBusy] = useState(false)
  const [identError, setIdentError] = useState<string | null>(null)
  const [identHistoryOpen, setIdentHistoryOpen] = useState(false)

  const reload = useCallback(() => {
    if (canCodeStatus) getCodeStatuses().then(setEntries)
    if (canImaging) getImagingCatalog().then(setImgStudies)
    if (canIdentity) {
      getHospitalIdentityHistory().then(r => {
        setIdent(r); setIdentLoaded(true)
        setHName(r.name); setHUnit(r.unitName); setHShort(r.shortName); setHAddr(r.address)
      }).catch(() => setIdentLoaded(true))
    }
  }, [canCodeStatus, canIdentity, canImaging])
  useEffect(() => { reload() }, [reload])

  const stats = useMemo(() => {
    const all = entries ?? []
    return { total: all.length, active: all.filter(e => e.active).length, retired: all.filter(e => !e.active).length }
  }, [entries])

  const kpis: KpiSpec[] = [
    ...(canIdentity ? [{
      icon: <IconGrid size={14} stroke="var(--cyan)" />, iconBg: 'rgba(var(--cyan-rgb),.13)',
      value: identLoaded ? (ident?.configured ? ident.name : 'Not configured') : '—', label: 'Hospital Identity',
    } satisfies KpiSpec] : []),
    ...(canImaging ? [{
      icon: <IconFlask size={14} stroke="var(--violet)" />, iconBg: 'rgba(var(--violet-rgb),.13)',
      value: imgStudies ? `${imgStudies.filter(s => s.active).length}/${imgStudies.length}` : '—', label: 'Imaging Studies (active)',
    } satisfies KpiSpec] : []),
    ...(canCodeStatus ? [
      { icon: <IconPulse size={14} stroke="var(--red)" />, iconBg: 'rgba(var(--red-rgb),.13)', value: entries ? stats.total : '—', label: 'Code Statuses' },
      { icon: <IconCheck size={12} stroke="var(--green)" />, iconBg: 'rgba(var(--green-rgb),.13)', value: entries ? stats.active : '—', label: 'Active' },
      { icon: <IconClock size={14} stroke="var(--amber)" />, iconBg: 'rgba(var(--amber-rgb),.14)', value: entries ? stats.retired : '—', label: 'Retired' },
    ] satisfies KpiSpec[] : []),
  ]

  const offlineMsg = (what: string) => `Configuration changes require the live server — ${what} was NOT saved`

  async function applyWrite(code: string | null, what: string,
    run: () => Promise<AdtWriteResult<CodeStatusEntry>>, onOk: (e: CodeStatusEntry) => void) {
    setBusy(true); setRowError(null); setFormError(null)
    const res = await run()
    setBusy(false)
    if (res.kind === 'ok') { onOk(res.data); reload(); return }
    const error = res.kind === 'rejected' ? res.error : offlineMsg(what)
    if (code) setRowError({ code, error })
    else setFormError(error)
  }

  async function doCreate() {
    await applyWrite(null, 'the entry', () => createCodeStatus({ code: cCode.trim(), label: cLabel.trim() }), e => {
      showToast('Code status added', `${e.label} (${e.code}) is selectable at the bedside`)
      setCCode(''); setCLabel('')
    })
  }

  async function doEdit(e: CodeStatusEntry) {
    await applyWrite(e.code, 'the change', () => updateCodeStatus(e.code, { label: eLabel.trim() }), upd => {
      showToast('Code status updated', `${upd.label} — the change is on the entry's audit history`)
      setPanel(null)
    })
  }

  async function doRetire(e: CodeStatusEntry) {
    await applyWrite(e.code, 'the retirement', () => deactivateCodeStatus(e.code), upd => {
      showToast('Code status retired', `${upd.label} cannot be newly assigned (patients carrying it keep rendering)`)
      setPanel(null)
    })
  }

  async function doReactivate(e: CodeStatusEntry) {
    await applyWrite(e.code, 'the reactivation', () => reactivateCodeStatus(e.code), upd => {
      showToast('Code status reactivated', `${upd.label} is selectable again`)
    })
  }

  function openPanel(kind: 'edit' | 'retire' | 'history', e: CodeStatusEntry) {
    setRowError(null)
    if (panel?.kind === kind && panel.code === e.code) { setPanel(null); return }
    if (kind === 'edit') setELabel(e.label)
    setPanel({ kind, code: e.code })
  }

  /* ---- imaging catalogue writes (REAL-ONLY, the shared refusal) ---- */
  async function applyImgWrite(id: string | null, what: string,
    run: () => Promise<AdtWriteResult<ImagingStudyDef>>, onOk: (st: ImagingStudyDef) => void) {
    setImgBusy(true); setImgRowError(null); setImgFormError(null)
    const res = await run()
    setImgBusy(false)
    if (res.kind === 'ok') { onOk(res.data); reload(); return }
    const error = res.kind === 'rejected' ? res.error : offlineMsg(what)
    if (id) setImgRowError({ id, error })
    else setImgFormError(error)
  }

  async function doImgCreate() {
    await applyImgWrite(null, 'the study', () => createImagingStudy({
      studyId: iId.trim(), name: iName.trim(), modality: iModality,
      ...(iRegion.trim() ? { region: iRegion.trim() } : {}),
      contrast: iContrast, portable: iPortable,
    }), st => {
      showToast('Imaging study added', `${st.name} (${st.studyId}) is orderable immediately`)
      setIId(''); setIName(''); setIRegion(''); setIContrast(false); setIPortable(false)
    })
  }

  async function doImgEdit(st: ImagingStudyDef) {
    await applyImgWrite(st.studyId, 'the change', () => updateImagingStudy(st.studyId, {
      name: eiName.trim(), modality: eiModality, region: eiRegion.trim(),
      contrast: eiContrast, portable: eiPortable,
    }), upd => {
      showToast('Imaging study updated', `${upd.name} — the change is on the study's audit history`)
      setImgPanel(null)
    })
  }

  async function doImgRetire(st: ImagingStudyDef) {
    await applyImgWrite(st.studyId, 'the retirement', () => deactivateImagingStudy(st.studyId), upd => {
      showToast('Imaging study retired', `${upd.name} is off the ordering menu (historical orders keep rendering)`)
      setImgPanel(null)
    })
  }

  async function doImgReactivate(st: ImagingStudyDef) {
    await applyImgWrite(st.studyId, 'the reactivation', () => reactivateImagingStudy(st.studyId), upd => {
      showToast('Imaging study reactivated', `${upd.name} is orderable again`)
    })
  }

  async function doImgDelete(st: ImagingStudyDef) {
    await applyImgWrite(st.studyId, 'the deletion', () => deleteImagingStudy(st.studyId), del => {
      showToast('Imaging study deleted', `${del.name} was never used (0 orders) — removed outright`)
    })
  }

  function openImgPanel(kind: 'edit' | 'retire' | 'history', st: ImagingStudyDef) {
    setImgRowError(null)
    if (imgPanel?.kind === kind && imgPanel.id === st.studyId) { setImgPanel(null); return }
    if (kind === 'edit') {
      setEiName(st.name); setEiModality(st.modality); setEiRegion(st.region)
      setEiContrast(st.contrast); setEiPortable(st.portable)
    }
    setImgPanel({ kind, id: st.studyId })
  }

  async function doSaveIdentity() {
    setIdentBusy(true); setIdentError(null)
    const res = await updateHospitalIdentity({
      name: hName.trim(), unitName: hUnit.trim(), shortName: hShort.trim(), address: hAddr.trim(),
    })
    setIdentBusy(false)
    if (res.kind === 'ok') {
      setIdent(res.data)
      /* every mounted surface (headers, login, letterhead) re-reads
         through the one resolver */
      invalidateHospitalIdentity()
      showToast('Hospital identity saved', `${res.data.name} — the change is on the identity's audit history`)
      return
    }
    setIdentError(res.kind === 'rejected' ? res.error : offlineMsg('the identity'))
  }

  const identDirty = ident
    ? (hName.trim() !== ident.name || hUnit.trim() !== ident.unitName
      || hShort.trim() !== ident.shortName || hAddr.trim() !== ident.address)
    : (hName.trim().length > 0 || hUnit.trim().length > 0 || hShort.trim().length > 0 || hAddr.trim().length > 0)

  return (
    <div className="app-frame ua">
      <AppHeader
        subtitle="Configuration · Aurora Core"
        kpis={kpis}
        user={{ initials: initialsOf(session.name), name: session.name, role: `${session.jobTitle} · ${profileOf(session.jobTitle)} profile` }}
      />
      <div className="shell">
        <NavSidebar active="config" footerLines={[
          canIdentity ? 'Administrative configuration' : 'Clinical governance',
          'Configuration · Aurora Core']} />

        <main>
          <div className="uanote" role="note">
            <b>Configuration</b> — what varies per hospital is editable, governed data, never a code
            change. One area, each section gated to its own authority: <b>hospital identity</b> is
            administrative (office Administrator), <b>clinical vocabularies</b> are clinically
            governed. Every change lands on a permanent audit history — amended, never erased.
          </div>

          {canIdentity && (
            <div className="uacols">
              <Card icon={<IconGrid size={15} stroke="var(--cyan)" />} title="Hospital Identity"
                aside={identLoaded ? (ident?.configured ? 'configured' : 'NOT CONFIGURED') : '—'}>
                {!identLoaded && <div className="uaempty">Loading the identity record…</div>}
                {identLoaded && (
                  <form className="uaform" onSubmit={ev => { ev.preventDefault(); void doSaveIdentity() }}>
                    {!ident?.configured && (
                      <span className="uaconfirm">
                        This install&apos;s identity is <b>not configured</b> — every surface (print
                        letterhead, headers, login) shows a neutral placeholder until it is set here.
                        Nothing defaults to a demo hospital&apos;s name.
                      </span>
                    )}
                    <div className="uafields">
                      <label>Hospital name (letterhead + every identity surface)
                        <input value={hName} onChange={e => setHName(e.target.value)} disabled={identBusy}
                          placeholder="e.g. St. Mary's Teaching Hospital" maxLength={120} />
                      </label>
                      <label>Unit / ICU name (headers, bed board — this install&apos;s one unit)
                        <input value={hUnit} onChange={e => setHUnit(e.target.value)} disabled={identBusy}
                          placeholder="e.g. Adult ICU — Unit 1" maxLength={80} />
                      </label>
                      <label>Short name / abbreviation (compact headers)
                        <input value={hShort} onChange={e => setHShort(e.target.value)} disabled={identBusy}
                          placeholder="e.g. SMTH" maxLength={20} />
                      </label>
                      <label>Address block (printed under the letterhead; optional)
                        <textarea value={hAddr} onChange={e => setHAddr(e.target.value)} disabled={identBusy}
                          rows={3} maxLength={400} placeholder={'Street, City\nPhone · Fax'} />
                      </label>
                    </div>
                    {identError && <div className="uaerr" role="alert">{identError}</div>}
                    <div className="uapanelacts">
                      <button className="uasubmit" type="submit" disabled={identBusy || !identDirty || !hName.trim()}>
                        {identBusy ? 'Saving…' : (ident?.configured ? 'Save identity changes' : 'Configure identity')}
                      </button>
                      <button className="uaact" type="button" aria-expanded={identHistoryOpen}
                        onClick={() => setIdentHistoryOpen(o => !o)}>
                        History ({ident?.history.length ?? 0})
                      </button>
                    </div>
                    {identHistoryOpen && (
                      <div className="uapanel" role="region" aria-label="Hospital identity history">
                        {(ident?.history.length ?? 0) === 0 && (
                          <span className="uaconfirm">
                            No recorded events{ident?.configured
                              ? ' — a seeded identity (historical data carries no invented audit).'
                              : ' — the identity has never been configured.'}
                          </span>
                        )}
                        {ident?.history.map((ev, i) => (
                          <div className="uaevent" key={i}>
                            <span className="num">{ev.time}</span> · {ev.actor} · {ev.action}{ev.detail ? ` — ${ev.detail}` : ''}
                          </div>
                        ))}
                      </div>
                    )}
                  </form>
                )}
              </Card>

              <Card icon={<IconSettings size={15} stroke="var(--faint)" />} title="Coming to this area" aside="built over successive PRs">
                <div className="uaempty">
                  Next tenants on this same pattern: bed management, the imaging catalogue, then the
                  smaller vocabularies (isolation types, dispositions). A letterhead <b>logo image </b>
                  is a recorded fast-follow to identity. The Formulary and Lab Catalogue keep their
                  existing managers (linked from the sidebar).
                </div>
              </Card>
            </div>
          )}

          {canCodeStatus && (
          <div className="uacols">
            <Card icon={<IconPulse size={15} stroke="var(--red)" />} title="Code Status Vocabulary"
              aside={entries ? `${stats.active} active · ${stats.retired} retired` : '—'}>
              <div className="uarows">
                {(entries ?? []).map(e => {
                  const open = panel?.code === e.code ? panel.kind : null
                  return (
                    <div className={`uarow${e.active ? '' : ' off'}`} key={e.code}>
                      <div className="uamain">
                        <span className="uawho">
                          <b>{e.label}</b>
                          <small className="num">{e.code}</small>
                        </span>
                        <span className="uarole">
                          <span>Resuscitation instruction</span>
                          <small className="uaprofile">selected at admission / bedside — never typed</small>
                        </span>
                        <span className={`uastatus ${e.active ? 'on' : 'offed'}`}>{e.active ? 'Active' : 'Retired'}</span>
                        <span className="uaacts">
                          <button className="uaact" onClick={() => openPanel('history', e)} aria-expanded={open === 'history'}>
                            History ({e.history.length})
                          </button>
                          <button className="uaact" onClick={() => openPanel('edit', e)} aria-expanded={open === 'edit'}>Edit</button>
                          {e.active && (
                            <button className="uaact warn" onClick={() => openPanel('retire', e)} aria-expanded={open === 'retire'}>Retire</button>
                          )}
                          {!e.active && (
                            <button className="uaact" disabled={busy} onClick={() => doReactivate(e)}>Reactivate</button>
                          )}
                        </span>
                      </div>

                      {open === 'history' && (
                        <div className="uapanel" role="region" aria-label={`History: ${e.code}`}>
                          {e.history.length === 0 && (
                            <span className="uaconfirm">No recorded events — a seeded entry (historical data carries no invented audit).</span>
                          )}
                          {e.history.map((ev, i) => (
                            <div className="uaevent" key={i}>
                              <span className="num">{ev.time}</span> · {ev.actor} · {ev.action}{ev.detail ? ` — ${ev.detail}` : ''}
                            </div>
                          ))}
                        </div>
                      )}

                      {open === 'edit' && (
                        <div className="uapanel" role="region" aria-label={`Edit code status: ${e.code}`}>
                          <div className="uafields">
                            <label>Label (the code <span className="num">{e.code}</span> is permanent)
                              <input value={eLabel} onChange={ev => setELabel(ev.target.value)} disabled={busy} maxLength={60} />
                            </label>
                          </div>
                          <div className="uapanelacts">
                            <button className="uaact go" disabled={busy || eLabel.trim().length === 0} onClick={() => doEdit(e)}>
                              {busy ? 'Saving…' : 'Save change'}
                            </button>
                            <button className="uaact" onClick={() => setPanel(null)}>Cancel</button>
                          </div>
                        </div>
                      )}

                      {open === 'retire' && (
                        <div className="uapanel" role="alertdialog" aria-label={`Confirm retirement: ${e.code}`}>
                          <span className="uaconfirm">
                            Retire <b>{e.label}</b>? It can no longer be newly assigned — admission and
                            bedside selection exclude it and the server refuses it. Every patient
                            currently carrying it keeps rendering it (never deleted). Reversible via
                            Reactivate.
                          </span>
                          <div className="uapanelacts">
                            <button className="uaact warn" disabled={busy} onClick={() => doRetire(e)}>
                              {busy ? 'Retiring…' : 'Confirm retirement'}
                            </button>
                            <button className="uaact" onClick={() => setPanel(null)}>Cancel</button>
                          </div>
                        </div>
                      )}

                      {rowError?.code === e.code && <div className="uaerr" role="alert">{rowError.error}</div>}
                    </div>
                  )
                })}
                {entries?.length === 0 && <div className="uaempty">No vocabulary entries — add the hospital&apos;s resuscitation categories.</div>}
              </div>
            </Card>

            <Card icon={<IconSettings size={15} stroke="var(--cyan)" />} title="Add Code Status" aside="new entries are selectable immediately">
              <form className="uaform" onSubmit={ev => { ev.preventDefault(); void doCreate() }}>
                <div className="uafields">
                  <label>Code (permanent — lowercase, digits, underscore)
                    <input value={cCode} onChange={e => setCCode(e.target.value)} disabled={busy}
                      placeholder="dnr_dni" autoComplete="off" maxLength={40} />
                  </label>
                  <label>Label (shown at the bedside and on every record)
                    <input value={cLabel} onChange={e => setCLabel(e.target.value)} disabled={busy}
                      placeholder="DNR / DNI" maxLength={60} />
                  </label>
                </div>
                {formError && <div className="uaerr" role="alert">{formError}</div>}
                <button className="uasubmit" type="submit"
                  disabled={busy || !cCode.trim() || !cLabel.trim()}>
                  {busy ? 'Adding…' : 'Add to vocabulary'}
                </button>
              </form>
            </Card>
          </div>
          )}

          {canImaging && (
          <div className="uacols">
            <Card icon={<IconFlask size={15} stroke="var(--violet)" />} title="Imaging Catalogue"
              aside={imgStudies ? `${imgStudies.filter(s => s.active).length} active · ${imgStudies.filter(s => !s.active).length} retired` : '—'}>
              <div className="uarows">
                {(imgStudies ?? []).map(st => {
                  const open = imgPanel?.id === st.studyId ? imgPanel.kind : null
                  return (
                    <div className={`uarow${st.active ? '' : ' off'}`} key={st.studyId}>
                      <div className="uamain">
                        <span className="uawho">
                          <b>{st.name}</b>
                          <small className="num">{st.studyId}</small>
                        </span>
                        <span className="uarole">
                          <span>{st.modality}{st.region ? ` · ${st.region}` : ''}</span>
                          <small className="uaprofile">{st.contrast ? 'contrast' : 'no contrast'} · {st.portable ? 'portable' : 'department'}</small>
                        </span>
                        <span className={`uastatus ${st.active ? 'on' : 'offed'}`}>{st.active ? 'Active' : 'Retired'}</span>
                        <span className="uaacts">
                          <button className="uaact" onClick={() => openImgPanel('history', st)} aria-expanded={open === 'history'}>
                            History ({st.history.length})
                          </button>
                          <button className="uaact" onClick={() => openImgPanel('edit', st)} aria-expanded={open === 'edit'}>Edit</button>
                          {st.active && (
                            <button className="uaact warn" onClick={() => openImgPanel('retire', st)} aria-expanded={open === 'retire'}>Retire</button>
                          )}
                          {!st.active && (
                            <button className="uaact" disabled={imgBusy} onClick={() => doImgReactivate(st)}>Reactivate</button>
                          )}
                          <button className="uaact" disabled={imgBusy} onClick={() => doImgDelete(st)}
                            title="TRUE delete — never-used studies only; a referenced study answers 409 directing retire">
                            Delete
                          </button>
                        </span>
                      </div>

                      {open === 'history' && (
                        <div className="uapanel" role="region" aria-label={`History: ${st.studyId}`}>
                          {st.history.length === 0 && (
                            <span className="uaconfirm">No recorded events — a seeded study (historical data carries no invented audit).</span>
                          )}
                          {st.history.map((ev, i) => (
                            <div className="uaevent" key={i}>
                              <span className="num">{ev.time}</span> · {ev.actor} · {ev.action}{ev.detail ? ` — ${ev.detail}` : ''}
                            </div>
                          ))}
                        </div>
                      )}

                      {open === 'edit' && (
                        <div className="uapanel" role="region" aria-label={`Edit imaging study: ${st.studyId}`}>
                          <div className="uafields">
                            <label>Name (the id <span className="num">{st.studyId}</span> is permanent)
                              <input value={eiName} onChange={ev => setEiName(ev.target.value)} disabled={imgBusy} maxLength={80} />
                            </label>
                            <label>Modality (fixed vocabulary — one source with result entry)
                              <select value={eiModality} onChange={ev => setEiModality(ev.target.value)} disabled={imgBusy}>
                                {IMAGING_MODALITIES.map(m => <option key={m} value={m}>{m}</option>)}
                              </select>
                            </label>
                            <label>Body region (optional)
                              <input value={eiRegion} onChange={ev => setEiRegion(ev.target.value)} disabled={imgBusy} maxLength={40} />
                            </label>
                            <label>Attributes
                              <span className="uaconfirm">
                                <label><input type="checkbox" checked={eiContrast} onChange={ev => setEiContrast(ev.target.checked)} disabled={imgBusy} /> contrast</label>
                                {' '}
                                <label><input type="checkbox" checked={eiPortable} onChange={ev => setEiPortable(ev.target.checked)} disabled={imgBusy} /> portable</label>
                              </span>
                            </label>
                          </div>
                          <div className="uapanelacts">
                            <button className="uaact go" disabled={imgBusy || eiName.trim().length === 0} onClick={() => doImgEdit(st)}>
                              {imgBusy ? 'Saving…' : 'Save change'}
                            </button>
                            <button className="uaact" onClick={() => setImgPanel(null)}>Cancel</button>
                          </div>
                        </div>
                      )}

                      {open === 'retire' && (
                        <div className="uapanel" role="alertdialog" aria-label={`Confirm retirement: ${st.studyId}`}>
                          <span className="uaconfirm">
                            Retire <b>{st.name}</b>? It leaves the ordering menu and the server refuses
                            new orders for it. Historical orders carrying it keep rendering (never
                            deleted). Reversible via Reactivate.
                          </span>
                          <div className="uapanelacts">
                            <button className="uaact warn" disabled={imgBusy} onClick={() => doImgRetire(st)}>
                              {imgBusy ? 'Retiring…' : 'Confirm retirement'}
                            </button>
                            <button className="uaact" onClick={() => setImgPanel(null)}>Cancel</button>
                          </div>
                        </div>
                      )}

                      {imgRowError?.id === st.studyId && <div className="uaerr" role="alert">{imgRowError.error}</div>}
                    </div>
                  )
                })}
                {imgStudies?.length === 0 && <div className="uaempty">No imaging studies — add the studies this hospital performs.</div>}
              </div>
            </Card>

            <Card icon={<IconSettings size={15} stroke="var(--violet)" />} title="Add Imaging Study" aside="orderable immediately (hospital finalises the list)">
              <form className="uaform" onSubmit={ev => { ev.preventDefault(); void doImgCreate() }}>
                <div className="uafields">
                  <label>Study id (permanent — lowercase, digits, underscore)
                    <input value={iId} onChange={e => setIId(e.target.value)} disabled={imgBusy}
                      placeholder="ct_head_plain" autoComplete="off" maxLength={40} />
                  </label>
                  <label>Name (shown on ordering chips and order summaries)
                    <input value={iName} onChange={e => setIName(e.target.value)} disabled={imgBusy}
                      placeholder="CT Head without contrast" maxLength={80} />
                  </label>
                  <label>Modality (fixed vocabulary)
                    <select value={iModality} onChange={e => setIModality(e.target.value)} disabled={imgBusy}>
                      {IMAGING_MODALITIES.map(m => <option key={m} value={m}>{m}</option>)}
                    </select>
                  </label>
                  <label>Body region (optional)
                    <input value={iRegion} onChange={e => setIRegion(e.target.value)} disabled={imgBusy}
                      placeholder="Head" maxLength={40} />
                  </label>
                  <label>Attributes
                    <span className="uaconfirm">
                      <label><input type="checkbox" checked={iContrast} onChange={e => setIContrast(e.target.checked)} disabled={imgBusy} /> contrast</label>
                      {' '}
                      <label><input type="checkbox" checked={iPortable} onChange={e => setIPortable(e.target.checked)} disabled={imgBusy} /> portable</label>
                    </span>
                  </label>
                </div>
                {imgFormError && <div className="uaerr" role="alert">{imgFormError}</div>}
                <button className="uasubmit" type="submit"
                  disabled={imgBusy || !iId.trim() || !iName.trim()}>
                  {imgBusy ? 'Adding…' : 'Add to catalogue'}
                </button>
              </form>
            </Card>
          </div>
          )}
        </main>
      </div>
      <Toast state={toast} accent="blue" />
    </div>
  )
}

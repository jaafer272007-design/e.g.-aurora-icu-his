import { useCallback, useEffect, useState } from 'react'
import '../UsersAdmin/UsersAdmin.css'
import './Configuration.css'
import { AppHeader, type KpiSpec } from '../../components/AppHeader'
import { NavSidebar } from '../../components/NavSidebar'
import { Card } from '../../components/Card'
import { Toast, useToast } from '../../components/Toast'
import {
  IconBed, IconClock, IconDischarge, IconFlask, IconGrid, IconPulse, IconSettings, IconUsers,
} from '../../components/icons'
import {
  createBed, createCodeStatus, createDisposition, createFrequency, createImagingStudy,
  createIsolationType, createShift, deactivateCodeStatus, deactivateDisposition,
  deactivateFrequency, deactivateImagingStudy, deactivateIsolationType, deactivateShift,
  deleteImagingStudy, getAdtBeds, getCodeStatuses, getDispositions, getFrequencyEntries,
  getHospitalIdentityHistory, getImagingCatalog, getIsolationTypes, getObservationCatalog,
  getShifts, reactivateBed,
  reactivateCodeStatus, reactivateDisposition, reactivateFrequency, reactivateImagingStudy,
  reactivateIsolationType, reactivateShift, retireBed, updateCodeStatus, updateDisposition,
  updateHospitalIdentity, updateImagingStudy, updateIsolationType, updateShift,
} from '../../lib/api'
import type { AdtWriteResult } from '../../lib/api'
import type {
  AdtBed, CodeStatusEntry, DispositionEntry, FrequencyEntry, HospitalIdentityWithHistory,
  ImagingStudyDef, IsolationTypeEntry, ObsCatalogGroup, ShiftEntry,
} from '../../lib/api/types'
import { IMAGING_MODALITIES } from '../../lib/api/types'
import { invalidateHospitalIdentity } from '../../lib/hospitalIdentity'
import { getSession, hasPermission, initialsOf, profileOf, type Permission } from '../../lib/session'
import { ObservationCatalogManager } from './ObservationCatalogManager'
import { VocabManager, type VocabRow } from './VocabManager'

/* ==================== Configuration (/config) ====================
   The per-hospital CONFIGURATION AREA — what varies from one hospital to
   the next is editable, governed DATA here, never a code change (one
   codebase, many configurations, zero forks).

   THE COHERENT FAMILY (Configuration Vocabularies design §6 — the
   validator's request): the area is a GROUPED SET of managers, one
   tenant on screen at a time behind a section rail —
   - HOSPITAL — identity (hospital.configure, office Administrator).
   - CLINICAL VOCABULARIES — code status (codestatus.manage), discharge
     dispositions (dispositions.manage — 'died' reserved, isDeath
     immutable), isolation types (isolation.manage), shifts
     (shifts.manage) — all SeniorDoctor; named frequencies
     (frequencies.manage, Pharmacist). Every simple vocabulary renders
     through ONE shared VocabManager so the pattern cannot drift.
   - CATALOGUES & REGISTRY — the imaging catalogue (imagingcatalog.manage,
     Ancillary + SeniorDoctor) and the bed registry (beds.manage,
     SeniorDoctor + office Administrator; the occupancy-guarded,
     never-renamed tenant). The Formulary and Lab Catalogue keep their
     own full pages (linked from the sidebar).
   A session sees ONLY its sections; groups with nothing visible hide.

   Every manager: validated REAL-ONLY writes, append-only audit,
   deactivate-never-delete (where a lifecycle exists). */

type SectionId =
  | 'identity' | 'codestatus' | 'dispositions' | 'isolation' | 'shifts' | 'frequencies'
  | 'imaging' | 'beds' | 'obscatalog'

export function Configuration() {
  const { toast, showToast } = useToast()
  const session = getSession()!
  const can = (atom: Permission) => hasPermission(session.jobTitle, atom)

  /* ---- the section rail (grouped; RBAC-filtered) ---- */
  const groups: { title: string; items: { id: SectionId; title: string; allowed: boolean }[] }[] = [
    {
      title: 'Hospital',
      items: [{ id: 'identity', title: 'Hospital Identity', allowed: can('hospital.configure') }],
    },
    {
      title: 'Clinical vocabularies',
      items: [
        { id: 'codestatus', title: 'Code Status', allowed: can('codestatus.manage') },
        { id: 'dispositions', title: 'Dispositions', allowed: can('dispositions.manage') },
        { id: 'isolation', title: 'Isolation Types', allowed: can('isolation.manage') },
        { id: 'shifts', title: 'Shifts', allowed: can('shifts.manage') },
        { id: 'frequencies', title: 'Named Frequencies', allowed: can('frequencies.manage') },
      ],
    },
    {
      title: 'Catalogues & registry',
      items: [
        { id: 'imaging', title: 'Imaging Catalogue', allowed: can('imagingcatalog.manage') },
        { id: 'obscatalog', title: 'Observations', allowed: can('observations.configure') },
        { id: 'beds', title: 'Bed Registry', allowed: can('beds.manage') },
      ],
    },
  ]
  const visible = groups.map(g => ({ ...g, items: g.items.filter(i => i.allowed) }))
    .filter(g => g.items.length > 0)
  const firstSection = visible[0]?.items[0]?.id ?? null
  const [section, setSection] = useState<SectionId | null>(null)
  const active: SectionId | null = section ?? firstSection

  /* ---- tenant data ---- */
  const [codeStatuses, setCodeStatuses] = useState<CodeStatusEntry[] | null>(null)
  const [dispositions, setDispositions] = useState<DispositionEntry[] | null>(null)
  const [isolationTypes, setIsolationTypes] = useState<IsolationTypeEntry[] | null>(null)
  const [shifts, setShifts] = useState<ShiftEntry[] | null>(null)
  const [frequencies, setFrequencies] = useState<FrequencyEntry[] | null>(null)
  const [imgStudies, setImgStudies] = useState<ImagingStudyDef[] | null>(null)
  const [obsGroups, setObsGroups] = useState<ObsCatalogGroup[] | null>(null)
  const [bedRows, setBedRows] = useState<AdtBed[] | null>(null)
  const [ident, setIdent] = useState<HospitalIdentityWithHistory | null>(null)
  const [identLoaded, setIdentLoaded] = useState(false)

  const reload = useCallback(() => {
    if (can('codestatus.manage')) getCodeStatuses().then(setCodeStatuses).catch(() => setCodeStatuses(null))
    if (can('dispositions.manage')) getDispositions().then(setDispositions).catch(() => setDispositions(null))
    if (can('isolation.manage')) getIsolationTypes().then(setIsolationTypes).catch(() => setIsolationTypes(null))
    if (can('shifts.manage')) getShifts().then(setShifts).catch(() => setShifts(null))
    if (can('frequencies.manage')) getFrequencyEntries().then(setFrequencies).catch(() => setFrequencies(null))
    if (can('imagingcatalog.manage')) getImagingCatalog().then(setImgStudies).catch(() => setImgStudies(null))
    if (can('observations.configure')) getObservationCatalog().then(setObsGroups).catch(() => setObsGroups(null))
    if (can('beds.manage')) getAdtBeds().then(setBedRows).catch(() => setBedRows(null))
    if (can('hospital.configure')) {
      getHospitalIdentityHistory().then(r => {
        setIdent(r); setIdentLoaded(true)
        setHName(r.name); setHUnit(r.unitName); setHShort(r.shortName); setHAddr(r.address)
      }).catch(() => setIdentLoaded(true))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.jobTitle])
  useEffect(() => { reload() }, [reload])

  /* section counts for the rail (active/total where a lifecycle exists) */
  const counts: Partial<Record<SectionId, string>> = {
    codestatus: codeStatuses ? `${codeStatuses.filter(e => e.active).length}/${codeStatuses.length}` : undefined,
    dispositions: dispositions ? `${dispositions.filter(e => e.active).length}/${dispositions.length}` : undefined,
    isolation: isolationTypes ? `${isolationTypes.filter(e => e.active).length}/${isolationTypes.length}` : undefined,
    shifts: shifts ? `${shifts.filter(e => e.active).length}/${shifts.length}` : undefined,
    frequencies: frequencies ? `${frequencies.filter(e => e.active).length}/${frequencies.length}` : undefined,
    imaging: imgStudies ? `${imgStudies.filter(s => s.active).length}/${imgStudies.length}` : undefined,
    obscatalog: obsGroups
      ? `${obsGroups.flatMap(g => g.types).filter(t => t.active).length}/${obsGroups.flatMap(g => g.types).length}`
      : undefined,
    beds: bedRows ? `${bedRows.filter(b => b.active).length}/${bedRows.length}` : undefined,
    identity: identLoaded ? (ident?.configured ? 'set' : 'unset') : undefined,
  }

  const kpis: KpiSpec[] = [
    ...(can('hospital.configure') ? [{
      icon: <IconGrid size={14} stroke="var(--cyan)" />, iconBg: 'rgba(var(--cyan-rgb),.13)',
      value: identLoaded ? (ident?.configured ? ident.name : 'Not configured') : '—', label: 'Hospital Identity',
    } satisfies KpiSpec] : []),
    ...(can('dispositions.manage') ? [{
      icon: <IconDischarge size={14} stroke="var(--amber)" />, iconBg: 'rgba(var(--amber-rgb),.14)',
      value: counts.dispositions ?? '—', label: 'Dispositions (active)',
    } satisfies KpiSpec] : []),
    ...(can('isolation.manage') ? [{
      icon: <IconUsers size={14} stroke="var(--violet)" />, iconBg: 'rgba(var(--violet-rgb),.13)',
      value: counts.isolation ?? '—', label: 'Isolation Types (active)',
    } satisfies KpiSpec] : []),
    ...(can('shifts.manage') ? [{
      icon: <IconClock size={14} stroke="var(--green)" />, iconBg: 'rgba(var(--green-rgb),.13)',
      value: counts.shifts ?? '—', label: 'Shifts (active)',
    } satisfies KpiSpec] : []),
    ...(can('frequencies.manage') ? [{
      icon: <IconClock size={14} stroke="var(--cyan)" />, iconBg: 'rgba(var(--cyan-rgb),.13)',
      value: counts.frequencies ?? '—', label: 'Named Frequencies (active)',
    } satisfies KpiSpec] : []),
    ...(can('codestatus.manage') ? [{
      icon: <IconPulse size={14} stroke="var(--red)" />, iconBg: 'rgba(var(--red-rgb),.13)',
      value: counts.codestatus ?? '—', label: 'Code Statuses (active)',
    } satisfies KpiSpec] : []),
    ...(can('imagingcatalog.manage') ? [{
      icon: <IconFlask size={14} stroke="var(--violet)" />, iconBg: 'rgba(var(--violet-rgb),.13)',
      value: counts.imaging ?? '—', label: 'Imaging Studies (active)',
    } satisfies KpiSpec] : []),
    ...(can('beds.manage') ? [{
      icon: <IconBed size={14} stroke="var(--blue)" />, iconBg: 'rgba(var(--blue-rgb),.13)',
      value: counts.beds ?? '—', label: 'Beds (active)',
    } satisfies KpiSpec] : []),
  ].slice(0, 5)

  const offlineMsg = (what: string) => `Configuration changes require the live server — ${what} was NOT saved`

  /* ---- the five simple vocabularies → ONE shared manager ---- */
  const codeStatusRows: VocabRow[] | null = codeStatuses
    ? codeStatuses.map(e => ({ key: e.code, label: e.label, active: e.active, history: e.history }))
    : null
  const dispositionRows: VocabRow[] | null = dispositions
    ? dispositions.map(e => ({
      key: e.code, label: e.label, active: e.active, history: e.history,
      tags: e.isDeath ? ['Counts as death — deceased guard + mortality'] : undefined,
      reserved: e.code === 'died'
        ? "Reserved — the deceased re-admission guard and the mortality statistics depend on a death outcome always being recordable; 'died' can never be retired"
        : undefined,
    }))
    : null
  const isolationRows: VocabRow[] | null = isolationTypes
    ? isolationTypes.map(e => ({
      key: e.code, label: e.label, active: e.active, history: e.history,
      tags: e.code === 'unspecified'
        ? ['the honest migration target — clinicians refine it to a real type'] : undefined,
    }))
    : null
  const shiftRows: VocabRow[] | null = shifts
    ? shifts.map(e => ({ key: e.code, label: e.label, active: e.active, history: e.history }))
    : null
  const frequencyRows: VocabRow[] | null = frequencies
    ? frequencies.map(e => ({
      key: e.value, label: e.value, active: e.active, history: e.history,
      tags: e.referencedBy.length > 0
        ? [`listed by ${e.referencedBy.length} drug${e.referencedBy.length === 1 ? '' : 's'}: ${e.referencedBy.slice(0, 4).join(', ')}${e.referencedBy.length > 4 ? '…' : ''}`]
        : undefined,
    }))
    : null

  /* ---- imaging catalogue (CORRECTED model: modality + free-text name
     only — the internal id is generated and never shown) ---- */
  const [imgBusy, setImgBusy] = useState(false)
  const [imgPanel, setImgPanel] = useState<{ kind: 'edit' | 'retire' | 'history'; id: string } | null>(null)
  const [imgRowError, setImgRowError] = useState<{ id: string; error: string } | null>(null)
  const [imgFormError, setImgFormError] = useState<string | null>(null)
  const [iName, setIName] = useState('')
  const [iModality, setIModality] = useState('CXR')
  const [eiName, setEiName] = useState(''); const [eiModality, setEiModality] = useState('CXR')

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
  const doImgCreate = () => applyImgWrite(null, 'the study', () => createImagingStudy({
    name: iName.trim(), modality: iModality,
  }), st => {
    showToast('Imaging study added', `${st.name} is orderable immediately`)
    setIName('')
  })
  const doImgEdit = (st: ImagingStudyDef) => applyImgWrite(st.studyId, 'the change', () => updateImagingStudy(st.studyId, {
    name: eiName.trim(), modality: eiModality,
  }), upd => { showToast('Imaging study updated', `${upd.name} — the change is on the study's audit history`); setImgPanel(null) })
  const doImgRetire = (st: ImagingStudyDef) => applyImgWrite(st.studyId, 'the retirement', () => deactivateImagingStudy(st.studyId),
    upd => { showToast('Imaging study retired', `${upd.name} is off the ordering menu (historical orders keep rendering)`); setImgPanel(null) })
  const doImgReactivate = (st: ImagingStudyDef) => applyImgWrite(st.studyId, 'the reactivation', () => reactivateImagingStudy(st.studyId),
    upd => showToast('Imaging study reactivated', `${upd.name} is orderable again`))
  const doImgDelete = (st: ImagingStudyDef) => applyImgWrite(st.studyId, 'the deletion', () => deleteImagingStudy(st.studyId),
    del => showToast('Imaging study deleted', `${del.name} was never used (0 orders) — removed outright`))
  function openImgPanel(kind: 'edit' | 'retire' | 'history', st: ImagingStudyDef) {
    setImgRowError(null)
    if (imgPanel?.kind === kind && imgPanel.id === st.studyId) { setImgPanel(null); return }
    if (kind === 'edit') { setEiName(st.name); setEiModality(st.modality) }
    setImgPanel({ kind, id: st.studyId })
  }

  /* ---- bed registry (specialized: live occupancy; never renamed) ---- */
  const [bedBusy, setBedBusy] = useState(false)
  const [bedPanel, setBedPanel] = useState<{ kind: 'retire' | 'history'; id: string } | null>(null)
  const [bedRowError, setBedRowError] = useState<{ id: string; error: string } | null>(null)
  const [bedFormError, setBedFormError] = useState<string | null>(null)
  const [bId, setBId] = useState(''); const [bArea, setBArea] = useState(''); const [bSeq, setBSeq] = useState('')

  async function applyBedWrite(id: string | null, what: string,
    run: () => Promise<AdtWriteResult<AdtBed>>, onOk: (b: AdtBed) => void) {
    setBedBusy(true); setBedRowError(null); setBedFormError(null)
    const res = await run()
    setBedBusy(false)
    if (res.kind === 'ok') { onOk(res.data); reload(); return }
    const error = res.kind === 'rejected' ? res.error : offlineMsg(what)
    if (id) setBedRowError({ id, error })
    else setBedFormError(error)
  }
  const doBedCreate = () => {
    const seq = bSeq.trim()
    return applyBedWrite(null, 'the bed', () => createBed({
      bedId: bId.trim(), area: bArea.trim(), ...(seq ? { seq: Number(seq) } : {}),
    }), b => {
      showToast('Bed added', `${b.bedId} (${b.area}) is on the board and admittable immediately`)
      setBId(''); setBArea(''); setBSeq('')
    })
  }
  const doBedRetire = (b: AdtBed) => applyBedWrite(b.bedId, 'the retirement', () => retireBed(b.bedId), upd => {
    showToast('Bed retired', `${upd.bedId} left the board and the admit/transfer pickers (historical records keep rendering it)`)
    setBedPanel(null)
  })
  const doBedReactivate = (b: AdtBed) => applyBedWrite(b.bedId, 'the reactivation', () => reactivateBed(b.bedId),
    upd => showToast('Bed reactivated', `${upd.bedId} is back on the board and admittable`))
  function openBedPanel(kind: 'retire' | 'history', b: AdtBed) {
    setBedRowError(null)
    if (bedPanel?.kind === kind && bedPanel.id === b.bedId) { setBedPanel(null); return }
    setBedPanel({ kind, id: b.bedId })
  }

  /* ---- hospital identity (specialized: one record, edit-in-place) ---- */
  const [hName, setHName] = useState(''); const [hUnit, setHUnit] = useState('')
  const [hShort, setHShort] = useState(''); const [hAddr, setHAddr] = useState('')
  const [identBusy, setIdentBusy] = useState(false)
  const [identError, setIdentError] = useState<string | null>(null)
  const [identHistoryOpen, setIdentHistoryOpen] = useState(false)

  async function doSaveIdentity() {
    setIdentBusy(true); setIdentError(null)
    const res = await updateHospitalIdentity({
      name: hName.trim(), unitName: hUnit.trim(), shortName: hShort.trim(), address: hAddr.trim(),
    })
    setIdentBusy(false)
    if (res.kind === 'ok') {
      setIdent(res.data)
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

  const sectionMeta: Record<SectionId, { blurb: React.ReactNode }> = {
    identity: { blurb: <>The install&apos;s own name, unit, short name and letterhead address — administrative configuration (office Administrator). One record: edit-in-place, audited, amend-never-erase.</> },
    codestatus: { blurb: <>The resuscitation-instruction vocabulary every bedside surface selects from — clinical governance (Senior Doctor). A retired entry keeps rendering on patients that carry it.</> },
    dispositions: { blurb: <>The discharge OUTCOMES — the stay&apos;s recorded end. <b>&lsquo;Died&rsquo; is reserved</b> (never retireable) and death semantics ride each entry&apos;s immutable attribute, so no edit here can rewrite a recorded outcome or break the deceased re-admission guard.</> },
    isolation: { blurb: <>The IPC precaution types patients are marked with at the bedside (contact, droplet, airborne, protective — and this hospital&apos;s own). Pre-vocabulary isolation flags were preserved as <b>&ldquo;Isolation (unspecified)&rdquo;</b> — a clinician refines them; a type is never guessed.</> },
    shifts: { blurb: <>The working shifts assignments are made against. Two-shift day/night was itself an assumption — three-shift ICUs are real, so the list is yours. Retiring a shift never touches existing assignments (the stored shift is a snapshot).</> },
    frequencies: { blurb: <>The NAMED medication frequencies (&ldquo;daily&rdquo;, &ldquo;with meals&rdquo;…) orders and per-drug lists validate against — pharmacy governance. The structured <b className="num">q1h–q48h</b> pattern is a safety rule in code, never a hospital list.</> },
    imaging: { blurb: <>The coded imaging study definitions ordering reads — clinical, on the lab-catalogue gating (radiology + Senior Doctor). Retired studies leave the menu; historical orders keep rendering.</> },
    beds: { blurb: <>The unit&apos;s physical beds. Retiring an <b>occupied</b> bed is refused by live occupancy, and beds are <b>never renamed</b> (a renamed occupied bed is a wrong-patient-location risk) — add, retire, reactivate only.</> },
    obscatalog: { blurb: <>What this hospital can <b>observe</b> at the bedside. Add custom numeric observations and set the flagging ranges that drive abnormal/critical display. <b>🔒 NEWS2/SOFA score inputs are locked</b> — every part of their definition — because an editable score input silently turns a validated score into an unvalidated one. Ranges here are display flagging only; the score bands live in validated code.</> },
  }

  return (
    <div className="app-frame ua cfg">
      <AppHeader
        subtitle="Configuration · Aurora Core"
        kpis={kpis}
        user={{ initials: initialsOf(session.name), name: session.name, role: `${session.jobTitle} · ${profileOf(session.jobTitle)} profile` }}
      />
      <div className="shell">
        <NavSidebar active="config" footerLines={[
          can('hospital.configure') ? 'Administrative configuration' : 'Clinical governance',
          'Configuration · Aurora Core']} />

        <main>
          <div className="uanote" role="note">
            <b>Configuration</b> — what varies per hospital is editable, governed data, never a code
            change. One area, each section gated to its own authority; every change lands on a
            permanent audit history — amended, never erased. Retired entries leave new selection but
            keep rendering on every record that carries them.
          </div>

          {visible.length === 0 && (
            <div className="uaempty">No configuration sections are available to this profile.</div>
          )}

          {visible.length > 0 && (
          <div className="cfglayout">
            {/* the section rail — grouped, calm, one tenant at a time */}
            <nav className="cfgnav" aria-label="Configuration sections">
              {visible.map(g => (
                <div className="cfggroup" key={g.title}>
                  <div className="cfggrouptitle">{g.title}</div>
                  {g.items.map(it => (
                    <button key={it.id}
                      className={`cfgitem${active === it.id ? ' on' : ''}`}
                      aria-current={active === it.id ? 'true' : undefined}
                      onClick={() => setSection(it.id)}>
                      <span>{it.title}</span>
                      {counts[it.id] && <small className="num">{counts[it.id]}</small>}
                    </button>
                  ))}
                </div>
              ))}
            </nav>

            <div className="cfgbody">
              {active && <div className="cfgblurb" role="note">{sectionMeta[active].blurb}</div>}

              {active === 'codestatus' && (
                <VocabManager title="Code Status Vocabulary"
                  icon={<IconPulse size={15} stroke="var(--red)" />} accent="var(--red)"
                  spec={{
                    noun: 'code status', usedAt: 'at admission / bedside',
                    retireNote: 'It can no longer be newly assigned — admission and bedside selection exclude it and the server refuses it.',
                    codePlaceholder: 'dnr_dni', labelPlaceholder: 'DNR / DNI',
                  }}
                  rows={codeStatusRows}
                  api={{ create: d => createCodeStatus(d), update: (k, label) => updateCodeStatus(k, { label }), deactivate: deactivateCodeStatus, reactivate: reactivateCodeStatus }}
                  onChanged={reload} showToast={showToast} />
              )}

              {active === 'dispositions' && (
                <VocabManager title="Discharge Dispositions"
                  icon={<IconDischarge size={15} stroke="var(--amber)" />} accent="var(--amber)"
                  spec={{
                    noun: 'disposition', usedAt: 'at discharge',
                    retireNote: 'It can no longer be newly recorded at discharge and the server refuses it.',
                    createDeathAttr: true,
                    codePlaceholder: 'hospice', labelPlaceholder: 'Hospice / palliative transfer',
                  }}
                  rows={dispositionRows}
                  api={{ create: d => createDisposition(d), update: (k, label) => updateDisposition(k, { label }), deactivate: deactivateDisposition, reactivate: reactivateDisposition }}
                  onChanged={reload} showToast={showToast} />
              )}

              {active === 'isolation' && (
                <VocabManager title="Isolation Types"
                  icon={<IconUsers size={15} stroke="var(--violet)" />} accent="var(--violet)"
                  spec={{
                    noun: 'isolation type', usedAt: 'at the bedside',
                    retireNote: 'It can no longer be newly selected for a patient and the server refuses it.',
                    codePlaceholder: 'neutropenic', labelPlaceholder: 'Neutropenic precautions',
                  }}
                  rows={isolationRows}
                  api={{ create: d => createIsolationType(d), update: (k, label) => updateIsolationType(k, { label }), deactivate: deactivateIsolationType, reactivate: reactivateIsolationType }}
                  onChanged={reload} showToast={showToast} />
              )}

              {active === 'shifts' && (
                <VocabManager title="Shifts"
                  icon={<IconClock size={15} stroke="var(--green)" />} accent="var(--green)"
                  spec={{
                    noun: 'shift', usedAt: 'on assignments',
                    retireNote: 'New assignments can no longer select it; every EXISTING assignment keeps its stored shift (a snapshot — nothing changes retroactively).',
                    codePlaceholder: 'evening', labelPlaceholder: 'Evening (15–23)',
                  }}
                  rows={shiftRows}
                  api={{ create: d => createShift(d), update: (k, label) => updateShift(k, { label }), deactivate: deactivateShift, reactivate: reactivateShift }}
                  onChanged={reload} showToast={showToast} />
              )}

              {active === 'frequencies' && (
                <VocabManager title="Named Frequencies"
                  icon={<IconClock size={15} stroke="var(--cyan)" />} accent="var(--cyan)"
                  spec={{
                    noun: 'named frequency', usedAt: 'on new orders',
                    retireNote: 'New orders and new per-drug lists can no longer select it (the server answers 409/400); every stored order keeps rendering it.',
                    valueKeyed: true,
                    codePlaceholder: 'with meals',
                  }}
                  rows={frequencyRows}
                  api={{ create: d => createFrequency(d.label), deactivate: deactivateFrequency, reactivate: reactivateFrequency }}
                  onChanged={reload} showToast={showToast} />
              )}

              {active === 'identity' && (
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
                              placeholder="e.g. St. Mary's Teaching Hospital" />
                          </label>
                          <label>Unit / ICU name (headers, bed board — this install&apos;s one unit)
                            <input value={hUnit} onChange={e => setHUnit(e.target.value)} disabled={identBusy}
                              placeholder="e.g. Adult ICU — Unit 1" />
                          </label>
                          <label>Short name / abbreviation (compact headers)
                            <input value={hShort} onChange={e => setHShort(e.target.value)} disabled={identBusy}
                              placeholder="e.g. SMTH" />
                          </label>
                          <label>Address block (printed under the letterhead; optional)
                            <textarea value={hAddr} onChange={e => setHAddr(e.target.value)} disabled={identBusy}
                              rows={3} placeholder={'Street, City\nPhone · Fax'} />
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

                  <Card icon={<IconSettings size={15} stroke="var(--faint)" />} title="About this area" aside="grows tenant by tenant">
                    <div className="uaempty">
                      The configurability arc&apos;s vocabulary work is COMPLETE: identity, code status,
                      imaging, beds, dispositions, isolation types, shifts and named frequencies are
                      all per-hospital data. A letterhead <b>logo image</b> is a recorded fast-follow;
                      the first-run wizard and the production seed split are the next majors.
                    </div>
                  </Card>
                </div>
              )}

              {active === 'imaging' && (
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
                              </span>
                              <span className="uarole">
                                <span>{st.modality}</span>
                                <small className="uaprofile">region &amp; contrast are chosen at order time</small>
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
                                  <button className="uaact" disabled={imgBusy} onClick={() => void doImgReactivate(st)}>Reactivate</button>
                                )}
                                <button className="uaact" disabled={imgBusy} onClick={() => void doImgDelete(st)}
                                  title="TRUE delete — never-used studies only; a referenced study answers 409 directing retire">
                                  Delete
                                </button>
                              </span>
                            </div>

                            {open === 'history' && (
                              <div className="uapanel" role="region" aria-label={`History: ${st.name}`}>
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
                              <div className="uapanel" role="region" aria-label={`Edit imaging study: ${st.name}`}>
                                <div className="uafields">
                                  <label>Name (free text — whatever the hospital calls it)
                                    <input value={eiName} onChange={ev => setEiName(ev.target.value)} disabled={imgBusy} />
                                  </label>
                                  <label>Modality (fixed vocabulary — one source with result entry)
                                    <select value={eiModality} onChange={ev => setEiModality(ev.target.value)} disabled={imgBusy}>
                                      {IMAGING_MODALITIES.map(m => <option key={m} value={m}>{m}</option>)}
                                    </select>
                                  </label>
                                </div>
                                <div className="uapanelacts">
                                  <button className="uaact go" disabled={imgBusy || eiName.trim().length === 0} onClick={() => void doImgEdit(st)}>
                                    {imgBusy ? 'Saving…' : 'Save change'}
                                  </button>
                                  <button className="uaact" onClick={() => setImgPanel(null)}>Cancel</button>
                                </div>
                              </div>
                            )}

                            {open === 'retire' && (
                              <div className="uapanel" role="alertdialog" aria-label={`Confirm retirement: ${st.name}`}>
                                <span className="uaconfirm">
                                  Retire <b>{st.name}</b>? It leaves the ordering menu and the server refuses
                                  new orders for it. Historical orders carrying it keep rendering (never
                                  deleted). Reversible via Reactivate.
                                </span>
                                <div className="uapanelacts">
                                  <button className="uaact warn" disabled={imgBusy} onClick={() => void doImgRetire(st)}>
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
                        <label>Name (free text — whatever the hospital calls it; region &amp; contrast are chosen when ordering)
                          <input value={iName} onChange={e => setIName(e.target.value)} disabled={imgBusy}
                            placeholder="CT" autoComplete="off" />
                        </label>
                        <label>Modality (fixed vocabulary)
                          <select value={iModality} onChange={e => setIModality(e.target.value)} disabled={imgBusy}>
                            {IMAGING_MODALITIES.map(m => <option key={m} value={m}>{m}</option>)}
                          </select>
                        </label>
                      </div>
                      {imgFormError && <div className="uaerr" role="alert">{imgFormError}</div>}
                      <button className="uasubmit" type="submit"
                        disabled={imgBusy || !iName.trim()}>
                        {imgBusy ? 'Adding…' : 'Add to catalogue'}
                      </button>
                    </form>
                  </Card>
                </div>
              )}

              {active === 'obscatalog' && (
                <ObservationCatalogManager groups={obsGroups} onChanged={reload} showToast={showToast} />
              )}

              {active === 'beds' && (
                <div className="uacols">
                  <Card icon={<IconBed size={15} stroke="var(--blue)" />} title="Bed Registry"
                    aside={bedRows ? `${bedRows.filter(b => b.active).length} active · ${bedRows.filter(b => !b.active).length} retired` : '—'}>
                    <div className="uarows">
                      {bedRows === null && (
                        <div className="uaempty">bed registry unavailable — requires the live server (nothing fabricated)</div>
                      )}
                      {(bedRows ?? []).map(b => {
                        const open = bedPanel?.id === b.bedId ? bedPanel.kind : null
                        return (
                          <div className={`uarow${b.active ? '' : ' off'}`} key={b.bedId}>
                            <div className="uamain">
                              <span className="uawho">
                                <b className="num">{b.bedId}</b>
                                <small>{b.area}</small>
                              </span>
                              <span className="uarole">
                                <span>{b.patientId ? `Occupied · ${b.patientName ?? b.patientId}` : 'Free'}</span>
                                <small className="uaprofile">{b.patientId ? `${b.patientId} · ${b.encounterId}` : 'no open encounter'}</small>
                              </span>
                              <span className={`uastatus ${b.active ? 'on' : 'offed'}`}>{b.active ? 'Active' : 'Retired'}</span>
                              <span className="uaacts">
                                <button className="uaact" onClick={() => openBedPanel('history', b)} aria-expanded={open === 'history'}>
                                  History ({b.history.length})
                                </button>
                                {b.active && (
                                  <button className="uaact warn" onClick={() => openBedPanel('retire', b)} aria-expanded={open === 'retire'}>Retire</button>
                                )}
                                {!b.active && (
                                  <button className="uaact" disabled={bedBusy} onClick={() => void doBedReactivate(b)}>Reactivate</button>
                                )}
                              </span>
                            </div>

                            {open === 'history' && (
                              <div className="uapanel" role="region" aria-label={`History: ${b.bedId}`}>
                                {b.history.length === 0 && (
                                  <span className="uaconfirm">No recorded events — a seeded bed (historical data carries no invented audit).</span>
                                )}
                                {b.history.map((ev, i) => (
                                  <div className="uaevent" key={i}>
                                    <span className="num">{ev.time}</span> · {ev.actor} · {ev.action}{ev.detail ? ` — ${ev.detail}` : ''}
                                  </div>
                                ))}
                              </div>
                            )}

                            {open === 'retire' && (
                              <div className="uapanel" role="alertdialog" aria-label={`Confirm retirement: ${b.bedId}`}>
                                <span className="uaconfirm">
                                  Retire <b className="num">{b.bedId}</b>? It leaves the board and the admit/transfer
                                  pickers; historical records carrying it keep rendering. The server REFUSES
                                  this while a patient is in the bed. Reversible via Reactivate.
                                </span>
                                <div className="uapanelacts">
                                  <button className="uaact warn" disabled={bedBusy} onClick={() => void doBedRetire(b)}>
                                    {bedBusy ? 'Retiring…' : 'Confirm retirement'}
                                  </button>
                                  <button className="uaact" onClick={() => setBedPanel(null)}>Cancel</button>
                                </div>
                              </div>
                            )}

                            {bedRowError?.id === b.bedId && <div className="uaerr" role="alert">{bedRowError.error}</div>}
                          </div>
                        )
                      })}
                      {bedRows?.length === 0 && <div className="uaempty">No beds — add the unit&apos;s beds below.</div>}
                    </div>
                  </Card>

                  <Card icon={<IconSettings size={15} stroke="var(--blue)" />} title="Add Bed" aside="on the board and admittable immediately">
                    <form className="uaform" onSubmit={ev => { ev.preventDefault(); void doBedCreate() }}>
                      <div className="uafields">
                        <label>Bed label (free text — permanent, never renamed once created)
                          <input value={bId} onChange={e => setBId(e.target.value)} disabled={bedBusy}
                            placeholder="B-17" autoComplete="off" />
                        </label>
                        <label>Area (free text — the board groups beds by area)
                          <input value={bArea} onChange={e => setBArea(e.target.value)} disabled={bedBusy}
                            placeholder="Pod C" />
                        </label>
                        <label>Position (optional — ordering on the board; appended last when omitted)
                          <input value={bSeq} onChange={e => setBSeq(e.target.value.replace(/[^0-9]/g, ''))} disabled={bedBusy}
                            placeholder="17" inputMode="numeric" maxLength={4} />
                        </label>
                      </div>
                      {bedFormError && <div className="uaerr" role="alert">{bedFormError}</div>}
                      <button className="uasubmit" type="submit"
                        disabled={bedBusy || !bId.trim() || !bArea.trim()}>
                        {bedBusy ? 'Adding…' : 'Add bed'}
                      </button>
                    </form>
                  </Card>
                </div>
              )}
            </div>
          </div>
          )}
        </main>
      </div>
      <Toast state={toast} accent="blue" />
    </div>
  )
}

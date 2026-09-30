import { useEffect, useId, useRef, useState } from 'react'
import type { FocusEvent, KeyboardEvent, PointerEvent as ReactPointerEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import './NavSidebar.css'
import {
  IconAdmit, IconAlertTriangle, IconBed, IconBrain, IconClock, IconDischarge, IconFlask, IconGrid, IconPencil, IconPill, IconPrinter, IconPulse, IconSettings, IconShield, IconStats, IconUsers,
} from './icons'
import { lastPatientId } from '../lib/patientContext'
import { getSession, hasPermission, landingRouteOf, type Permission } from '../lib/session'
import { useAiSection } from '../lib/aiAvailability'
import { useEdition } from '../lib/edition'
import { APP_VERSION } from '../lib/version'

export type NavKey = 'dashboard' | 'beds' | 'observations' | 'orders' | 'labs' | 'labentry' | 'timeline' | 'ai' | 'reception' | 'awaiting' | 'admissions' | 'discharges' | 'discharged' | 'print' | 'users' | 'backup' | 'formulary' | 'labcatalog' | 'ordersets' | 'config' | 'alerts' | 'statistics' | 'settings'

interface NavItem {
  key: NavKey
  label: string
  icon: JSX.Element
  to?: string
  badge?: number
  /** required permission — items the session's profile lacks are hidden */
  perm?: Permission
  /** any-of permissions for MULTI-TENANT areas (Configuration: shown to
   *  whoever holds at least one section's authority) */
  anyPerm?: Permission[]
  /** false HIDES the item regardless of permission — for a feature the
   *  server reports as not on this install (the AI Assistant on a no-AI
   *  build, lib/aiAvailability.ts). Permission still applies on top. */
  when?: boolean
}

interface NavSidebarProps {
  active: NavKey
  /** accepted for caller compatibility but NO LONGER RENDERED: the Alerts
   *  badge was a hardcoded fabricated count (the dead-nav "5") — removed
   *  with the Attention Center build. A real live count would need the
   *  full multi-source derivation on every screen; the Alerts page itself
   *  shows the real counts (never a fabricated number). */
  alertCount?: number
  /** Lines shown under "AURORA HIS v4.2" in the sidebar footer. */
  footerLines: string[]
}

/* ---------------- COLLAPSIBLE SECTION SIDEBAR (owner's request, 2026-09-30) ----------------
   docs/design/icu-update-batch-1.md §3. The rail sits COLLAPSED (≈64px,
   icons + tooltips + accessible names) and expands to the labeled width:
   - mouse devices: while the pointer is over it (short hover intent so a
     pointer merely crossing the rail never expands it; a close delay
     longer than the width transition so the moving edge can never outrun
     the pointer and flicker), and while KEYBOARD focus is inside it
     (focus-visible — a mouse click's focus never pins it open);
   - touch / no-hover devices: only by the labeled tap toggle
     (aria-expanded), never by a tap on a section — which just navigates.
   The expanded state is published as .nav-open; the parent .shell's nav
   column follows it through the shared --nav-col (tokens.css), so the
   page's main content takes the space the collapsed rail frees. Only on
   a narrow screen (or an engine without :has) does the expanded rail
   OVERLAY the content instead — an explicit, dismissible drawer.
   All state is local to this component: expanding never re-renders the
   page, so drafts, scroll and patient context are untouched. */
const HOVER_OPEN_MS = 90
const HOVER_CLOSE_MS = 180
/** no hover-capable primary pointer → the tap toggle, never hover */
const TOUCH_QUERY = '(hover: none), (pointer: coarse)'
/** too narrow to push the content — MUST match the width in tokens.css */
const OVERLAY_QUERY = '(max-width: 760px)'
const supportsHas = typeof CSS !== 'undefined' && typeof CSS.supports === 'function' && CSS.supports('selector(:has(*))')

function useMedia(query: string): boolean {
  const read = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(query).matches
  const [matches, setMatches] = useState(read)
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const mq = window.matchMedia(query)
    const sync = () => setMatches(mq.matches)
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [query])
  return matches
}

/** Primary navigation rail. "Dashboard" resolves to the signed-in profile's
 *  landing view, and items are filtered by the profile's permissions —
 *  both derived from the session's JobTitle at render (Stage 9 RBAC). */
export function NavSidebar({ active, footerLines }: NavSidebarProps) {
  const navigate = useNavigate()
  const navId = useId()
  const navRef = useRef<HTMLElement>(null)
  const toggleRef = useRef<HTMLButtonElement>(null)
  const touchMode = useMedia(TOUCH_QUERY)
  const overlay = useMedia(OVERLAY_QUERY) || !supportsHas
  const [hovered, setHovered] = useState(false)
  const [keyboardInside, setKeyboardInside] = useState(false)
  const [pinned, setPinned] = useState(false)
  const timer = useRef<number | undefined>(undefined)
  const clearTimer = () => {
    if (timer.current !== undefined) window.clearTimeout(timer.current)
    timer.current = undefined
  }
  useEffect(() => clearTimer, [])
  const expanded = touchMode ? pinned : hovered || keyboardInside

  /* mouse hover (touch/pen contacts are ignored — no hover behaviour is
     forced onto touch users) */
  const onPointerEnter = (e: ReactPointerEvent) => {
    if (touchMode || e.pointerType !== 'mouse') return
    clearTimer()
    if (!hovered) timer.current = window.setTimeout(() => { timer.current = undefined; setHovered(true) }, HOVER_OPEN_MS)
  }
  /* a page that mounts UNDER a resting pointer gets no enter event —
     the first move inside counts as one */
  const onPointerMove = (e: ReactPointerEvent) => {
    if (!hovered && timer.current === undefined) onPointerEnter(e)
  }
  const onPointerLeave = (e: ReactPointerEvent) => {
    if (touchMode || e.pointerType !== 'mouse') return
    clearTimer()
    if (hovered) timer.current = window.setTimeout(() => { timer.current = undefined; setHovered(false) }, HOVER_CLOSE_MS)
  }
  /* keyboard focus anywhere inside keeps it open; leaving collapses */
  const onFocus = (e: FocusEvent) => {
    let keyboard = true
    try { keyboard = (e.target as HTMLElement).matches(':focus-visible') } catch { /* engine without :focus-visible — treat as keyboard */ }
    setKeyboardInside(keyboard)
  }
  const onBlur = (e: FocusEvent) => {
    if (!navRef.current?.contains(e.relatedTarget as Node | null)) setKeyboardInside(false)
  }
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && pinned) { setPinned(false); toggleRef.current?.focus() }
  }
  /* the narrow-screen drawer closes on a tap outside it (it overlays the
     content; closing moves nothing underneath, so the tap lands where the
     user aimed). The push layout never closes this way — collapsing would
     slide the content under the finger mid-tap. */
  useEffect(() => {
    if (!(pinned && overlay)) return
    const onDown = (e: PointerEvent) => {
      if (!navRef.current?.contains(e.target as Node)) setPinned(false)
    }
    document.addEventListener('pointerdown', onDown, true)
    return () => document.removeEventListener('pointerdown', onDown, true)
  }, [pinned, overlay])
  const session = getSession()
  const title = session?.jobTitle
  const allowed = (p?: Permission) => !p || (!!title && hasPermission(title, p))
  /* the AI section exists only where the server reports the AI enabled
     (no-AI installs show no entry at all — owner's decision 2026-09-06) */
  const aiSection = useAiSection()
  /* the module-2 screens (Reception, Awaiting Bed) exist only on the FULL
     edition — the hospital exe ships the ICU edition (owner's decision
     2026-09-06, lib/edition.ts) */
  const edition = useEdition()

  /* Persistent patient context: the six patient-scoped sections carry the
     last-viewed patient across section switches (pick Ahmed → Lab Entry →
     Observations → Orders stays Ahmed). The route param remains the source
     of truth — this only changes where the sidebar POINTS; with no
     remembered patient the bare path behaves exactly as before. */
  const pid = lastPatientId()
  const withPatient = (base: string) => (pid ? `${base}/${pid}` : base)

  const all: NavItem[] = [
    { key: 'dashboard', label: 'Dashboard', icon: <IconGrid />, to: title ? landingRouteOf(title) : '/login' },
    { key: 'beds', label: 'ICU Beds', icon: <IconBed />, to: '/beds', perm: 'patients.view' },
    { key: 'observations', label: 'Observations', icon: <IconPulse />, to: withPatient('/observations'), perm: 'patients.view' },
    { key: 'orders', label: 'Orders & Meds', icon: <IconPill />, to: withPatient('/orders'), perm: 'orders.view' },
    { key: 'labs', label: 'Labs & Imaging', icon: <IconFlask size={16} />, to: withPatient('/labs'), perm: 'results.view' },
    { key: 'labentry', label: 'Lab Entry', icon: <IconPencil size={16} />, to: withPatient('/lab-entry'), perm: 'results.document' },
    { key: 'timeline', label: 'Timeline', icon: <IconClock />, to: withPatient('/timeline'), perm: 'patients.view' },
    { key: 'ai', label: 'AI Assistant', icon: <IconBrain />, to: withPatient('/ai'), perm: 'ai.view', when: aiSection === 'shown' },
    /* Inpatient Reception — the ward's FRONT DOOR (find-or-register the
       patient, create the admission, stop). Gated on `admissions.create`,
       which the office Administrator holds and `adt.admit` is not: the
       reception desk is clerical authority, and the row must be reachable
       by the profile that staffs it. Listed ABOVE Admissions because that
       is the order of the journey — reception opens the episode, ICU's
       Admissions screen assigns the bed. */
    { key: 'reception', label: 'Reception', icon: <IconAdmit />, to: '/reception', perm: 'admissions.create', when: edition === 'full' },
    /* Ward A2 — the awaiting-bed worklist, directly after Reception because
       it is the NEXT step of the same journey: reception opens the episode
       with no bed; this list gives it one. Gated on beds.assign — the
       office Administrator and Nurse, the two profiles that can act on a
       row (design §6). */
    { key: 'awaiting', label: 'Awaiting Bed', icon: <IconBed />, to: '/awaiting-bed', perm: 'beds.assign', when: edition === 'full' },
    { key: 'admissions', label: 'Admissions', icon: <IconAdmit />, to: '/admissions', perm: 'patients.view' },
    { key: 'discharges', label: 'Discharges', icon: <IconDischarge />, to: '/discharges', perm: 'patients.view' },
    /* Discharged Patients — the records-retrieval view (browse + search ALL
       discharged, each opening the durable /history record). CLINICAL
       history, so results.view (the office Administrator is locked out) —
       matches the /discharged route gate and the Discharges row wiring. */
    { key: 'discharged', label: 'Discharged Patients', icon: <IconClock />, to: '/discharged', perm: 'results.view' },
    { key: 'print', label: 'Print Center', icon: <IconPrinter />, to: '/print', perm: 'patients.view' },
    { key: 'users', label: 'User Accounts', icon: <IconUsers size={16} />, to: '/admin/users', perm: 'users.manage' },
    { key: 'backup', label: 'Backup & Recovery', icon: <IconShield size={16} />, to: '/backup', perm: 'backup.manage' },
    { key: 'formulary', label: 'Formulary', icon: <IconPill />, to: '/formulary', perm: 'formulary.manage' },
    { key: 'labcatalog', label: 'Lab Catalogue', icon: <IconFlask size={16} />, to: '/lab-catalog', perm: 'labcatalog.manage' },
    { key: 'ordersets', label: 'Order Sets', icon: <IconGrid />, to: '/order-sets', perm: 'ordersets.manage' },
    /* Configuration — the per-hospital configuration area, MULTI-TENANT:
       shown to whoever holds at least one section's authority (hospital
       identity → hospital.configure; code status → codestatus.manage;
       imaging catalogue → imagingcatalog.manage; bed registry →
       beds.manage). Each section inside is gated to its own authority;
       the administrative/clinical split holds. */
    { key: 'config', label: 'Configuration', icon: <IconSettings size={16} />, to: '/config', anyPerm: ['hospital.configure', 'codestatus.manage', 'imagingcatalog.manage', 'beds.manage', 'dispositions.manage', 'isolation.manage', 'shifts.manage', 'frequencies.manage'] },
    /* Alerts — the Clinical Attention Center (was the second dead nav
       item; now a real screen). CLINICAL, patient-identifiable — gated on
       results.view, which every clinical profile carries and the office
       Administrator does NOT (the locked no-clinical-data rule). The old
       hardcoded "5" badge is gone — never a fabricated count. */
    { key: 'alerts', label: 'Alerts', icon: <IconAlertTriangle />, to: '/alerts', perm: 'results.view' },
    /* Statistics — the ICU Analytics Dashboard (was the first dead nav
       item; now a real screen). Gated like the other census-level reads
       on patients.view, which every profile carries — the office
       Administrator's core use is these unit-level aggregates. */
    { key: 'statistics', label: 'Statistics', icon: <IconStats />, to: '/statistics', perm: 'patients.view' },
    /* Settings — the LAST dead nav item, now a real screen. No clinical
       data on the page, so no permission gate: every profile (incl. the
       office Administrator) reaches it. */
    { key: 'settings', label: 'Settings', icon: <IconSettings />, to: '/settings' },
  ]
  const items = all.filter(it =>
    it.when !== false && (it.anyPerm ? (!!title && it.anyPerm.some(p => hasPermission(title, p))) : allowed(it.perm)))

  return (
    <nav
      ref={navRef} id={navId}
      className={`nav-sidebar${expanded ? ' nav-open' : ''}${overlay ? ' nav-overlay' : ''}`}
      aria-label="Primary"
      onPointerEnter={onPointerEnter} onPointerMove={onPointerMove} onPointerLeave={onPointerLeave}
      onFocus={onFocus} onBlur={onBlur} onKeyDown={onKeyDown}
    >
      {touchMode && (
        /* the touch/no-hover control: opening it never navigates */
        <button
          ref={toggleRef} type="button" className="nvtoggle"
          aria-expanded={pinned} aria-controls={navId} aria-label="Section menu"
          title={pinned ? 'Hide section names' : 'Show section names'}
          onClick={() => setPinned(p => !p)}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="3" y="4" width="18" height="16" rx="3" /><path d="M9 4v16" />
            <path d={pinned ? 'M16 10l-2 2 2 2' : 'M13 10l2 2-2 2'} />
          </svg>
          <span aria-hidden="true">{pinned ? 'Collapse' : 'Menu'}</span>
        </button>
      )}
      {items.map(it => (
        <button
          key={it.key}
          className={`nv${it.key === active ? ' on' : ''}`}
          aria-current={it.key === active ? 'page' : undefined}
          /* aria-label + title so the item stays identifiable when the
             sidebar is collapsed to its icon rail (the label span is
             hidden): screen readers get the name, and a hover tooltip
             names each bare icon. Harmless when the label is visible. */
          aria-label={it.label}
          title={it.label}
          onClick={it.to ? () => { setPinned(false); navigate(it.to!) } : undefined}
        >
          {it.icon}
          <span>{it.label}</span>
          {it.badge !== undefined && <span className="nbdg">{it.badge}</span>}
        </button>
      ))}
      <div className="navfoot">
        {APP_VERSION}
        {footerLines.map(l => <span key={l}><br />{l}</span>)}
      </div>
    </nav>
  )
}

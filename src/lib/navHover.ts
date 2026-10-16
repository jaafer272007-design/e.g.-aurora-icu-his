/* SHARED SIDEBAR HOVER (owner's request, 2026-10-04 —
   docs/design/icu-update-sidebar-mar-daily-cards.md §1). Every section
   mounts its own NavSidebar, so a hover held only in component state was
   lost on each navigation: the rail snapped shut under a pointer that
   never moved. This module is the small piece of state that outlives a
   section: whether the MOUSE hover had opened the sidebar, and the last
   mouse position (so a newly mounted sidebar can check whether the
   pointer is really still over it). In memory only — never written to
   storage — and cleared on sign-out (session.ts signOut). Keyboard focus
   and the touch toggle stay local to each sidebar, as before. */

let hovered = false
let point: { x: number; y: number } | null = null
let tracking = false

/** whether mouse hover currently holds the sidebar open */
export const navHovered = (): boolean => hovered
export const setNavHovered = (v: boolean): void => { hovered = v }

/** the last known MOUSE position (client coordinates), or null */
export const lastMousePoint = (): { x: number; y: number } | null => point

/** start following the mouse once per page load (passive, capture — it
 *  observes, never intercepts). Touch and pen are ignored. */
export function trackMousePoint(): void {
  if (tracking || typeof document === 'undefined') return
  tracking = true
  const note = (e: PointerEvent) => { if (e.pointerType === 'mouse') point = { x: e.clientX, y: e.clientY } }
  document.addEventListener('pointermove', note, { capture: true, passive: true })
  document.addEventListener('pointerdown', note, { capture: true, passive: true })
}

/** sign-out: the next session starts with a collapsed sidebar */
export function clearNavHover(): void {
  hovered = false
  point = null
}

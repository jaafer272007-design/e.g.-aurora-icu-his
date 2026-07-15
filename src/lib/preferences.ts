/* User preferences — the SMALL new store the Settings design introduces
   (docs/design/settings-back-button-design.md §1.1A). The audit found no
   preferences store anywhere; this holds exactly TWO preferences — theme
   and time format — and nothing else. Anything more (language,
   notification prefs, default workspace, rounding templates) has no
   capability behind it and stays "not tracked yet" on the Settings page.

   SCOPE (flagged choice, stated): TAB/SESSION-scoped sessionStorage,
   cleared on sign-out — deliberately consistent with the existing
   storage discipline (the session itself and the patient context live
   the same way). A per-user PERSISTED preference (surviving sign-out /
   another device) would belong on the user record server-side — recorded
   as future, not silently half-built here. */

export type ThemePreference = 'system' | 'light' | 'dark'
export type TimeFormat = '24h' | '12h'

export interface Preferences {
  theme: ThemePreference
  timeFormat: TimeFormat
}

const KEY = 'aurora.prefs'

export const DEFAULT_PREFERENCES: Preferences = { theme: 'system', timeFormat: '24h' }

export function getPreferences(): Preferences {
  try {
    const raw = sessionStorage.getItem(KEY)
    if (!raw) return DEFAULT_PREFERENCES
    const p = JSON.parse(raw) as Partial<Preferences>
    return {
      theme: p.theme === 'light' || p.theme === 'dark' || p.theme === 'system' ? p.theme : 'system',
      timeFormat: p.timeFormat === '12h' ? '12h' : '24h',
    }
  } catch {
    return DEFAULT_PREFERENCES
  }
}

export function setPreferences(next: Preferences): void {
  try { sessionStorage.setItem(KEY, JSON.stringify(next)) } catch { /* storage unavailable */ }
  applyTheme()
  window.dispatchEvent(new Event('aurora:preferences'))
}

/** sign-out hygiene — same rule as the patient context */
export function clearPreferences(): void {
  try { sessionStorage.removeItem(KEY) } catch { /* ignore */ }
  applyTheme()
}

/* ---------- theme ----------
   LIGHT THEME — SHIPPED (the styling pass closed the PR #101 open item):
   the ~640 colour usages that were hardcoded outside the token layer now
   route through tokens (rgba triplet tokens + solid role tokens in
   tokens.css) whose dark values are the exact literals they replaced —
   dark is unchanged — and a `[data-theme="light"]` set provides the
   light palette (hues preserved; lightness shifted for WCAG AA). */
export const LIGHT_THEME_AVAILABLE = true

/** what the preference RESOLVES to today (the device signal is read for
 *  real, so "system" is honest about what it would do once light exists) */
export function resolveTheme(pref: ThemePreference): 'dark' | 'light' {
  const wantsLight = pref === 'light'
    || (pref === 'system' && typeof window.matchMedia === 'function'
        && window.matchMedia('(prefers-color-scheme: light)').matches)
  return wantsLight && LIGHT_THEME_AVAILABLE ? 'light' : 'dark'
}

/** true when the DEVICE prefers light but the app renders dark (the
 *  honest note Settings shows instead of pretending to follow) */
export function systemPrefersUnavailableLight(): boolean {
  const pref = getPreferences().theme
  if (LIGHT_THEME_AVAILABLE) return false
  return pref !== 'dark' && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-color-scheme: light)').matches
}

export function applyTheme(): void {
  document.documentElement.dataset.theme = resolveTheme(getPreferences().theme)
}

/** boot + live device-preference tracking (Follow system is the default) */
export function initThemeTracking(): void {
  applyTheme()
  if (typeof window.matchMedia !== 'function') return
  window.matchMedia('(prefers-color-scheme: light)')
    .addEventListener?.('change', () => applyTheme())
}

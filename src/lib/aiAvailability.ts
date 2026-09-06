import { useSyncExternalStore } from 'react'
import { apiHealthUrl } from './api'

/* AI-SECTION AVAILABILITY (owner's decision, 2026-09-06 — the no-AI ICU
   build). The AI Assistant is a feature a hospital install may not HAVE:
   the installer writes AI_PROVIDER=none when the build carried no model
   (or the server has no GPU), and the server reports that on /healthz as
   `aiAssistant: "disabled"`. Until this change the section stayed VISIBLE
   on such installs — an "AI Assistant" entry whose screen answered with a
   503 — honest, but advertising a feature that is not there. Now the
   section (nav entry + the /ai routes) is SHOWN only when the server this
   bundle is wired to reports the AI enabled. Resolved at RUNTIME from the
   same /healthz fetch EnvironmentGate already makes — never baked into the
   bundle — so one bundle serves both kinds of install, and enabling the
   AI later (aurora-enable-ai.ps1 flips AI_PROVIDER and restarts the
   server) makes the section appear on the next page load with no update.
   The permission gate (ai.view) is UNCHANGED and still applies on top.

   States: 'pending' until /healthz has answered — the section is NOT shown
   (hidden-until-reported, so a no-AI install never flashes it); 'shown'
   when the server reports "enabled"; 'hidden' when it reports "disabled",
   reports nothing (a server from before this field), or cannot be reached
   (a server that cannot be reached cannot serve the AI either). A
   pure-mock dev session (no API at all) has no server to ask and keeps the
   section exactly as before — the screen there says the translation is
   not reachable, its existing honest state.

   The server's 503 with the recorded reason is unchanged for direct API
   callers. "Warn and disable, never refuse" is unchanged in substance:
   Aurora runs fully; a feature that is not on the install is simply no
   longer advertised. Settings › System Information states the fact. */

export type AiSectionState = 'pending' | 'shown' | 'hidden'

let state: AiSectionState = apiHealthUrl() === null ? 'shown' : 'pending'
const listeners = new Set<() => void>()

function set(next: AiSectionState) {
  if (next === state) return
  state = next
  listeners.forEach(l => l())
}

/** Called by EnvironmentGate with the parsed /healthz body (null when the
 *  API was unreachable or answered non-JSON). Shown ONLY on the literal
 *  "enabled" — anything else hides the section. */
export function recordAiAvailability(health: unknown): void {
  const v = health !== null && typeof health === 'object'
    ? (health as { aiAssistant?: unknown }).aiAssistant
    : undefined
  set(v === 'enabled' ? 'shown' : 'hidden')
}

const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l) } }
const snapshot = () => state

/** live view of the AI-section state — re-renders when /healthz answers */
export function useAiSection(): AiSectionState {
  return useSyncExternalStore(subscribe, snapshot, snapshot)
}

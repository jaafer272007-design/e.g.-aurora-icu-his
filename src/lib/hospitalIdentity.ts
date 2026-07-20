import { useEffect, useState } from 'react'
import { getHospitalIdentity, hospitalLogoUrl } from './api'
import type { HospitalIdentity } from './api/types'

/* ==================== Hospital identity — ONE resolver ====================
   The house rule (Config Home + Hospital Identity design §2): every
   surface that used to hardcode "AURORA GENERAL HOSPITAL" / "Unit 4B" —
   the print letterhead, app headers, the login screen — reads the
   CONFIGURED identity through this single resolver, so setting it once
   in /config propagates everywhere with zero per-surface edits (the
   #113 display-name-propagation precedent).

   UNSET IS HONEST (design §4): a fresh install has no identity — the
   resolver renders a NEUTRAL placeholder ("Configure hospital name in
   Settings → Configuration"), never "AURORA GENERAL HOSPITAL": shipping
   every hospital branded as the demo hospital, or printing the demo
   name on a real discharge summary, would be a fabrication. Surfaces
   whose identity segment is purely decorative omit it while unset
   (unitSuffix) rather than rendering the placeholder mid-sentence.

   SINGLE-UNIT BOUNDARY (design §5): unitName is the ONE configured
   unit's display name. The future multi-unit project replaces this
   field with a real units catalogue — nothing here scopes patients,
   beds or permissions by unit. */

/** the neutral unset placeholder — the design's recommended wording */
export const HOSPITAL_NAME_UNSET = 'Configure hospital name in Settings → Configuration'

export interface HospitalIdentityView {
  /** configured hospital name, or the neutral placeholder */
  name: string
  /** configured unit name, or '' while unset (callers omit the segment) */
  unitName: string
  /** configured short name, or '' while unset */
  shortName: string
  /** letterhead address block, or '' (letterhead omits the line) */
  address: string
  /** BRANDING (Print Center branding build): the hospital's own header
   *  tagline / footer line for printed documents, or '' (omitted) */
  headerText: string
  footerText: string
  /** the letterhead logo byte-endpoint URL (cache-busted by version),
   *  or null while no logo is set — the letterhead renders its
   *  placeholder box */
  logoUrl: string | null
  /** false = fresh install / identity service unreachable */
  configured: boolean
}

export function resolveHospitalIdentity(id: HospitalIdentity | null): HospitalIdentityView {
  if (!id || !id.configured) {
    return {
      name: HOSPITAL_NAME_UNSET, unitName: '', shortName: '', address: '',
      headerText: '', footerText: '', logoUrl: null, configured: false,
    }
  }
  return {
    name: id.name.length > 0 ? id.name : HOSPITAL_NAME_UNSET,
    unitName: id.unitName, shortName: id.shortName, address: id.address,
    headerText: id.headerText ?? '', footerText: id.footerText ?? '',
    logoUrl: hospitalLogoUrl(id.hasLogo ?? false, id.logoVersion ?? 0),
    configured: id.name.length > 0,
  }
}

/** " · Unit 4B" while configured, '' while unset — for header subtitles
 *  whose unit segment is decorative (never the placeholder mid-title) */
export const unitSuffix = (view: HospitalIdentityView): string =>
  view.unitName ? ` · ${view.unitName}` : ''

/* ---- module-level cache: identity is install-level chrome, fetched
   once per app load and shared by every surface (login, headers,
   letterhead). invalidate() after a /config save re-fetches and
   re-renders every subscribed surface. ---- */

let cached: HospitalIdentityView | null = null
let inflight: Promise<HospitalIdentityView> | null = null
const listeners = new Set<(v: HospitalIdentityView) => void>()

function fetchIdentity(): Promise<HospitalIdentityView> {
  inflight ??= getHospitalIdentity()
    .then(resolveHospitalIdentity)
    .catch(() => resolveHospitalIdentity(null))
    .then(view => {
      cached = view
      inflight = null
      listeners.forEach(l => l(view))
      return view
    })
  return inflight
}

/** re-fetch after a /config save so every mounted surface updates */
export function invalidateHospitalIdentity(): void {
  cached = null
  inflight = null
  void fetchIdentity()
}

/** the resolver as a hook — null while the first fetch is in flight
 *  (surfaces render their previous/neutral chrome, never a flash of a
 *  wrong name) */
export function useHospitalIdentity(): HospitalIdentityView | null {
  const [view, setView] = useState<HospitalIdentityView | null>(cached)
  useEffect(() => {
    listeners.add(setView)
    if (cached) setView(cached)
    else void fetchIdentity()
    return () => { listeners.delete(setView) }
  }, [])
  return view
}

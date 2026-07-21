import { useEffect, useState } from 'react'

/* Shared clock utilities. Locked decision: time-relative states
   (OVERDUE/DUE/ages/…) are computed against the current clock at render
   time — never stored in data.

   SERVER-LOCAL DISPLAY (the Locale/Timezone design §1): STORAGE STAYS
   UTC — every stored stamp and every parser (datedEpoch, the MAR
   derivation, LOS math) is unchanged. What changed is DISPLAY: dated
   stamps render in the SERVER'S OWN timezone (the machine clock — a
   hospital's server is one machine in one place, so its OS zone IS the
   hospital's), primed once per session from the anonymous
   hospital-identity read (serverTimeZone/serverUtcOffsetMinutes) and
   converted through localParts() — the ONE conversion path. nowHm(),
   which used the BROWSER's zone (the audited leak: a dose charted at
   15:00 local displayed as 12:00 UTC — or worse, mixed clocks), now
   renders through the same path. The serverless mock demo has no
   server clock and honestly renders the device's own — there the
   device IS the machine. */

/* ---------- the display clock (server-local rendering) ---------- */

interface ServerClockInfo { timeZone: string; utcOffsetMinutes: number }

let serverClock: ServerClockInfo | null = (() => {
  try {
    const raw = sessionStorage.getItem('aurora.serverClock')
    return raw ? (JSON.parse(raw) as ServerClockInfo) : null
  } catch { return null }
})()

let fmtCache: { zone: string | null; fmt: Intl.DateTimeFormat | null } | null = null

/** Prime the display clock from the server (the api layer calls this off
 *  the anonymous hospital-identity read, and gates data reads on it so
 *  no timestamp-bearing screen paints before the zone is known). Cached
 *  in sessionStorage — reloads are synchronous. */
export function setServerClock(timeZone: string, utcOffsetMinutes: number): void {
  if (serverClock?.timeZone === timeZone && serverClock.utcOffsetMinutes === utcOffsetMinutes) return
  serverClock = { timeZone, utcOffsetMinutes }
  fmtCache = null
  try { sessionStorage.setItem('aurora.serverClock', JSON.stringify(serverClock)) } catch { /* private mode — in-memory only */ }
}

/** the zone display renders in — the server's IANA id once primed,
 *  null in the serverless mock demo (the device's own clock) */
export const clockZone = (): string | null => serverClock?.timeZone ?? null

function zoneFormatter(): Intl.DateTimeFormat | null {
  const zone = serverClock?.timeZone ?? null
  if (fmtCache && fmtCache.zone === zone) return fmtCache.fmt
  let fmt: Intl.DateTimeFormat | null = null
  try {
    fmt = new Intl.DateTimeFormat('en-GB', {
      timeZone: zone ?? undefined, // undefined → the device's zone (mock demo)
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    })
  } catch { fmt = null /* zone id unknown to this browser → fixed-offset fallback */ }
  fmtCache = { zone, fmt }
  return fmt
}

/** epoch ms → the display clock's calendar parts — THE one conversion
 *  every rendered timestamp goes through. Falls back to the reported
 *  fixed offset when Intl doesn't know the zone id; with no server
 *  clock at all (mock demo) Intl renders the device's own zone. */
function localParts(ms: number): { y: number; mo: number; d: number; hm: string } {
  const fmt = zoneFormatter()
  if (fmt) {
    const p: Record<string, string> = {}
    for (const part of fmt.formatToParts(ms)) p[part.type] = part.value
    return { y: +p.year, mo: +p.month, d: +p.day, hm: `${p.hour}:${p.minute}` }
  }
  const shifted = new Date(ms + (serverClock?.utcOffsetMinutes ?? 0) * 60_000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return {
    y: shifted.getUTCFullYear(), mo: shifted.getUTCMonth() + 1, d: shifted.getUTCDate(),
    hm: `${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}`,
  }
}

/** days-since-epoch of the display-clock calendar date containing ms —
 *  "today" and D-n grouping follow the server's day, not the browser's */
export const localDayNumber = (ms: number): number => {
  const { y, mo, d } = localParts(ms)
  return Math.floor(Date.UTC(y, mo - 1, d) / 86_400_000)
}

/** "yyyy-MM-dd" of ms on the display clock (statistics calendar buckets) */
export const localYmd = (ms: number): string => {
  const { y, mo, d } = localParts(ms)
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

/** "yyyy-MM-dd HH:mm" of ms on the display clock (print stamps, window labels) */
export const localStamp = (ms: number): string => {
  const { y, mo, d, hm } = localParts(ms)
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')} ${hm}`
}

/** the display clock's "minutes since local midnight" for a Date — the
 *  wall-clock comparisons (legacy bare-HH:mm forms) use the SAME clock
 *  as rendering, never the browser's */
const localNowMinutes = (now: Date): number => toMinutes(localParts(now.getTime()).hm)

export type DueState = 'overdue' | 'due' | 'upcoming'

/** a pending item counts as "due" this far ahead of its scheduled time */
export const DUE_SOON_MINUTES = 30

/* LATE-ADMINISTRATION THRESHOLD (overdue delay reason — validator
   option a): a dose given more than this long after its scheduled
   instant requires a documented DELAY REASON. Mirrors the server's
   MarSchedule.LateThresholdHours — the server enforces, this drives
   the dialog and the LATE marker. Deliberately distinct from the
   display state above (a row shows OVERDUE the moment it passes);
   this is the clinical-significance line. */
export const LATE_THRESHOLD_MINUTES = 120

/** minutes NOW is past a DATED stamp ("yyyy-MM-dd HH:mm" UTC); null
 *  for undated/absent stamps — lateness needs a real instant */
export function minutesPastStamp(stamp: string | undefined, now: Date): number | null {
  if (!stamp) return null
  const ms = datedEpoch(stamp)
  return ms === null ? null : (now.getTime() - ms) / 60_000
}

/** minutes between two DATED stamps (b − a); null unless both parse */
export function stampDiffMinutes(a: string | undefined, b: string | undefined): number | null {
  if (!a || !b) return null
  const ea = datedEpoch(a); const eb = datedEpoch(b)
  return ea === null || eb === null ? null : (eb - ea) / 60_000
}

export const toMinutes = (hm: string): number => {
  const [h, m] = hm.split(':').map(Number)
  return h * 60 + m
}

export function dueStateFor(scheduledTime: string, now: Date): DueState {
  /* DATED stamps (the MAR derived-schedule fix: every expected dose
     instance carries a real date) use real epoch math — an instance that
     passed STAYS overdue across midnight, it never flips back to
     upcoming. Legacy bare HH:mm (nursing-task fixtures, pre-fix data)
     keeps the same-day wall-clock comparison it always had. */
  const ms = datedEpoch(scheduledTime)
  if (ms !== null) {
    const diffMin = (ms - now.getTime()) / 60_000
    if (diffMin < 0) return 'overdue'
    if (diffMin <= DUE_SOON_MINUTES) return 'due'
    return 'upcoming'
  }
  const nowMin = localNowMinutes(now)
  const dueMin = toMinutes(scheduledTime)
  if (dueMin < nowMin) return 'overdue'
  if (dueMin - nowMin <= DUE_SOON_MINUTES) return 'due'
  return 'upcoming'
}

export const minutesSince = (hm: string, now: Date): number =>
  localNowMinutes(now) - toMinutes(hm)

/** Render-time age label for a timestamp. Prior-day markers ("D-1 22:15")
 *  are absolute, not time-relative — they pass through unchanged. Dated
 *  stamps ("yyyy-MM-dd HH:mm" UTC, the calendar-date fix) use real epoch
 *  math and show the short display form when older than an hour/day. */
export function agoLabel(t: string, now: Date): string {
  if (!t || t.startsWith('D-')) return t
  const dated = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(t)
  if (dated) {
    const ms = Date.parse(t.replace(' ', 'T') + ':00Z')
    if (Number.isNaN(ms)) return t
    const m = Math.floor((now.getTime() - ms) / 60000)
    if (m < 0) return `at ${formatHm(hmOf(t))}`
    if (m < 1) return 'just now'
    if (m < 60) return `${m} min ago`
    if (m < 1440) return `${Math.floor(m / 60)} h ${m % 60} min ago`
    return displayStamp(t) // a day or more ago → the absolute short form
  }
  const m = minutesSince(t, now)
  if (m < 0) return `at ${formatHm(t)}`
  if (m < 1) return 'just now'
  if (m < 60) return `${m} min ago`
  return `${Math.floor(m / 60)} h ${m % 60} min ago`
}

/* Absolute-timestamp helpers. Three stored forms exist:
   - "yyyy-MM-dd HH:mm" (UTC) — every EVENT stamp going forward (the
     calendar-date fix: ADT admit/discharge/transfer, order lifecycle,
     MAR documentation, lab collected/resulted/acknowledged) — matches
     the observation/audit convention, so cross-day math is honest;
   - "D-n HH:MM" — the seeded display convention (n days before today);
   - "HH:MM" — pre-fix live stamps (treated as today, as always).
   These parse stored facts — no time-relative state involved. */

const DATED = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/

/** epoch ms for a dated UTC stamp, or null for the display-convention forms */
export const datedEpoch = (t: string): number | null => {
  if (!DATED.test(t)) return null
  const ms = Date.parse(t.replace(' ', 'T') + ':00Z')
  return Number.isNaN(ms) ? null : ms
}

/** 0 for today, -n for n days ago — real date math for dated stamps
 *  ON THE DISPLAY CLOCK (a 23:30 UTC stamp in a UTC+3 hospital belongs
 *  to the NEXT local day — day grouping follows the wall the staff
 *  read), the "D-n" prefix for the seeded convention, today otherwise */
export const dayOffsetOf = (t: string): number => {
  const ms = datedEpoch(t)
  if (ms !== null) return localDayNumber(ms) - localDayNumber(Date.now())
  const m = /^D-(\d+)/.exec(t)
  return m ? -Number(m[1]) : 0
}

/** the display HH:MM of any form — dated stamps CONVERT to the display
 *  clock (this is where stored UTC becomes the hospital's wall time);
 *  the two legacy display-convention forms pass through */
export const hmOf = (t: string): string => {
  const ms = datedEpoch(t)
  if (ms !== null) return localParts(ms).hm
  const parts = t.split(' ')
  return parts[parts.length - 1]
}

/** total minutes relative to today 00:00 — a sort key across days */
export const timestampMinutes = (t: string): number =>
  dayOffsetOf(t) * 1440 + toMinutes(hmOf(t))

/* ---------- 12h/24h time-format preference (Settings §1.1A) ----------
   A DISPLAY preference over the render-time helpers only — stored stamps
   and every parser stay 24h "HH:mm" (data is never rewritten). Applies to
   displayStamp / agoLabel's absolute forms / nowHm; scheduled MAR times
   and other raw data renders are untouched. Read lazily from the
   preferences store so a change takes effect on the next render. */
function prefers12h(): boolean {
  try {
    const raw = sessionStorage.getItem('aurora.prefs')
    return raw !== null && (JSON.parse(raw) as { timeFormat?: string }).timeFormat === '12h'
  } catch { return false }
}

/** "14:05" → "2:05 PM" when the 12h preference is set; else unchanged */
export const formatHm = (hm: string): string => {
  if (!prefers12h() || !/^\d{2}:\d{2}$/.test(hm)) return hm
  const [h, m] = hm.split(':').map(Number)
  const ampm = h < 12 ? 'AM' : 'PM'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`
}

/** Render-time SHORT display for any stored stamp — the established
 *  bedside convention derived at render: dated stamps show "HH:mm" when
 *  today ON THE DISPLAY CLOCK and "D-n HH:mm" for prior local days; the
 *  two legacy forms pass through (formatted per the 12h/24h preference).
 *  The STORED value keeps its full UTC date (computable); only the
 *  display converts. */
export const displayStamp = (t: string | null | undefined): string => {
  if (!t) return ''
  if (!DATED.test(t)) {
    const m = /^(D-\d+ )?(\d{2}:\d{2})$/.exec(t)
    return m ? `${m[1] ?? ''}${formatHm(m[2])}` : t
  }
  const off = dayOffsetOf(t)
  return off === 0 ? formatHm(hmOf(t)) : `D-${-off} ${formatHm(hmOf(t))}`
}

/** FULL display form of a stored stamp for official documents (the
 *  print surfaces render complete datetimes, not the bedside short
 *  form): dated stamps convert to the display clock's
 *  "yyyy-MM-dd HH:mm"; the legacy display-convention forms pass
 *  through unchanged; empty stays empty (callers dash it). */
export const displayFullStamp = (t: string | null | undefined): string => {
  if (!t) return ''
  const ms = datedEpoch(t)
  return ms === null ? t : localStamp(ms)
}

/** the UTC wire form ("yyyy-MM-dd HH:mm") of a WALL-TIME string typed on
 *  the display clock — the write side of the one conversion path (what a
 *  user types is what the clock on the wall said). null when the shape
 *  is not a dated stamp: callers pass the raw value through so the
 *  server's own validation message stays the messenger. */
export const wireStampOfLocal = (t: string): string | null => {
  const ms = epochOfLocalStamp(t)
  return ms === null ? null : new Date(ms).toISOString().slice(0, 16).replace('T', ' ')
}

/** "now" on the DISPLAY CLOCK — the audited browser-local leak, fixed:
 *  this used the browser's own zone while every stored stamp rendered
 *  from the server's, so the two could disagree on the same screen.
 *  One clock now (localParts), on every surface. */
export const nowHm = () => formatHm(localParts(Date.now()).hm)

/** epoch ms whose DISPLAY-CLOCK wall time equals the given
 *  "yyyy-MM-dd HH:mm" — the WRITE side of the one conversion path: what
 *  a user types into a datetime field is wall time (what the clock on
 *  the wall said), converted here so the wire stays UTC. The two-pass
 *  fixup lands exact for fixed offsets and resolves offset-transition
 *  edges to one consistent side. */
export function epochOfLocalStamp(t: string): number | null {
  if (!DATED.test(t)) return null
  const asUtc = Date.parse(t.replace(' ', 'T') + ':00Z')
  if (Number.isNaN(asUtc)) return null
  let guess = asUtc
  for (let i = 0; i < 2; i++) {
    const p = localParts(guess)
    const [hh, mm] = p.hm.split(':').map(Number)
    const rendered = Date.UTC(p.y, p.mo - 1, p.d, hh, mm)
    if (rendered === asUtc) break
    guess += asUtc - rendered
  }
  return guess
}

/** Re-render on an interval so clock-computed states stay current. */
export function useNow(intervalMs = 30_000): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), intervalMs)
    return () => clearInterval(t)
  }, [intervalMs])
  return now
}

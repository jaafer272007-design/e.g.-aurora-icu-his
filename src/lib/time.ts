import { useEffect, useState } from 'react'

/* Shared clock utilities. Locked decision: time-relative states
   (OVERDUE/DUE/ages/…) are computed against the current clock at render
   time — never stored in data. */

export type DueState = 'overdue' | 'due' | 'upcoming'

/** a pending item counts as "due" this far ahead of its scheduled time */
export const DUE_SOON_MINUTES = 30

export const toMinutes = (hm: string): number => {
  const [h, m] = hm.split(':').map(Number)
  return h * 60 + m
}

export function dueStateFor(scheduledTime: string, now: Date): DueState {
  const nowMin = now.getHours() * 60 + now.getMinutes()
  const dueMin = toMinutes(scheduledTime)
  if (dueMin < nowMin) return 'overdue'
  if (dueMin - nowMin <= DUE_SOON_MINUTES) return 'due'
  return 'upcoming'
}

export const minutesSince = (hm: string, now: Date): number =>
  now.getHours() * 60 + now.getMinutes() - toMinutes(hm)

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
    if (m < 0) return `at ${formatHm(t.split(' ')[1])}`
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

/** 0 for today, -n for n days ago — real date math for dated stamps,
 *  the "D-n" prefix for the seeded convention, today otherwise */
export const dayOffsetOf = (t: string): number => {
  const ms = datedEpoch(t)
  if (ms !== null) {
    const day = 86_400_000
    return Math.floor(ms / day) - Math.floor(Date.now() / day)
  }
  const m = /^D-(\d+)/.exec(t)
  return m ? -Number(m[1]) : 0
}

/** the HH:MM portion of any form (dated stamps end in " HH:mm" too) */
export const hmOf = (t: string): string => {
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
 *  today (UTC) and "D-n HH:mm" for prior days; the two legacy forms pass
 *  through (formatted per the 12h/24h preference). The STORED value keeps
 *  its full date (computable); only the display changes. */
export const displayStamp = (t: string | null | undefined): string => {
  if (!t) return ''
  if (!DATED.test(t)) {
    const m = /^(D-\d+ )?(\d{2}:\d{2})$/.exec(t)
    return m ? `${m[1] ?? ''}${formatHm(m[2])}` : t
  }
  const off = dayOffsetOf(t)
  return off === 0 ? formatHm(hmOf(t)) : `D-${-off} ${formatHm(hmOf(t))}`
}

export const nowHm = () =>
  formatHm(new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }))

/** Re-render on an interval so clock-computed states stay current. */
export function useNow(intervalMs = 30_000): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), intervalMs)
    return () => clearInterval(t)
  }, [intervalMs])
  return now
}

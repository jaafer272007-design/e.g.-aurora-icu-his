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

/** Render-time age label for a today's-HH:MM timestamp.
 *  Prior-day markers ("D-1 22:15") are absolute, not time-relative —
 *  they pass through unchanged. */
export function agoLabel(t: string, now: Date): string {
  if (!t || t.startsWith('D-')) return t
  const m = minutesSince(t, now)
  if (m < 0) return `at ${t}`
  if (m < 1) return 'just now'
  if (m < 60) return `${m} min ago`
  return `${Math.floor(m / 60)} h ${m % 60} min ago`
}

export const nowHm = () =>
  new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })

/** Re-render on an interval so clock-computed states stay current. */
export function useNow(intervalMs = 30_000): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), intervalMs)
    return () => clearInterval(t)
  }, [intervalMs])
  return now
}

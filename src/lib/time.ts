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

/* Absolute-timestamp helpers for the "HH:MM today | D-n HH:MM prior day"
   convention used across the stores. These parse stored facts — no
   time-relative state involved. */

/** 0 for today, -n for "D-n …" */
export const dayOffsetOf = (t: string): number => {
  const m = /^D-(\d+)/.exec(t)
  return m ? -Number(m[1]) : 0
}

/** the HH:MM portion of either form */
export const hmOf = (t: string): string => {
  const parts = t.split(' ')
  return parts[parts.length - 1]
}

/** total minutes relative to today 00:00 — a sort key across days */
export const timestampMinutes = (t: string): number =>
  dayOffsetOf(t) * 1440 + toMinutes(hmOf(t))

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

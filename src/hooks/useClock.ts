import { useEffect, useState } from 'react'

export interface ClockState {
  time: string
  date: string
  shortTime: string
}

function read(): ClockState {
  const d = new Date()
  return {
    time: d.toLocaleTimeString('en-GB'),
    date: d.toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' }),
    shortTime: d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
  }
}

export function useClock(): ClockState {
  const [clock, setClock] = useState<ClockState>(read)
  useEffect(() => {
    const t = setInterval(() => setClock(read()), 1000)
    return () => clearInterval(t)
  }, [])
  return clock
}

export function useReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

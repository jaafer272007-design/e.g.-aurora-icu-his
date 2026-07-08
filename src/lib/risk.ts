/* Shared AI-risk probability → color bands. Severity mapping is fixed
   system-wide (red = critical, amber = high, green = stable). */
export const riskColor = (x: number): string =>
  x >= 70 ? 'var(--red)' : x >= 40 ? 'var(--amber)' : 'var(--green)'

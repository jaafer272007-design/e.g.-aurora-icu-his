import { useEffect, useState } from 'react'

/** Canvas 2D cannot resolve CSS var() — an invalid fillStyle/strokeStyle is
 *  silently ignored (leaving black). Canvas drawing code must read tokens
 *  off the root element at draw time instead. */
export const cssToken = (name: string): string =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim()

/** rgba() from a token RGB triplet (e.g. tokenRgba('--green-rgb', .08)) */
export const tokenRgba = (tripletToken: string, alpha: number): string =>
  `rgba(${cssToken(tripletToken)},${alpha})`

/** Bumps when the resolved theme can change (a preference write or a
 *  device colour-scheme flip) so canvas draw effects re-run — CSS-based
 *  colours re-resolve on their own; canvases need the redraw. */
export function useThemeVersion(): number {
  const [v, setV] = useState(0)
  useEffect(() => {
    const bump = () => setV(x => x + 1)
    window.addEventListener('aurora:preferences', bump)
    const mq = typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-color-scheme: light)') : null
    mq?.addEventListener?.('change', bump)
    return () => {
      window.removeEventListener('aurora:preferences', bump)
      mq?.removeEventListener?.('change', bump)
    }
  }, [])
  return v
}

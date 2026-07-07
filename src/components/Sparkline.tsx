interface SparklineProps {
  data: readonly number[]
  color: string
  width?: number
  height?: number
  /** 'range' normalizes min→max (bed trend), 'zero' is zero-based (infusion rate). */
  baseline?: 'range' | 'zero'
  className?: string
}

/** Inline SVG trend line. */
export function Sparkline({ data, color, width = 64, height = 20, baseline = 'range', className = 'spark' }: SparklineProps) {
  let points: string
  if (baseline === 'zero') {
    const mx = Math.max(...data, 0.001)
    points = data.map((d, i) => `${(i / (data.length - 1)) * width},${height - 3 - (d / mx) * (height - 6)}`).join(' ')
  } else {
    const mn = Math.min(...data)
    const mx = Math.max(...data)
    const sp = mx - mn || 1
    points = data.map((d, i) => `${(i / (data.length - 1)) * width},${height - 2 - ((d - mn) / sp) * (height - 5)}`).join(' ')
  }
  return (
    <svg className={className} viewBox={`0 0 ${width} ${height}`} style={{ width, height }} aria-hidden="true">
      <polyline points={points} fill="none" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

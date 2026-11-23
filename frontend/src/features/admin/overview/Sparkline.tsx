interface SparklineProps {
  values: number[]
  /** Decorative by default — the tile's text already carries the number. */
  width?: number
  height?: number
}

/** Tiny trend line. Decorative (`aria-hidden`): the figure and delta beside
 * it are the accessible content. */
export function Sparkline({ values, width = 96, height = 32 }: SparklineProps) {
  if (values.length < 2) return null
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || 1
  const pad = 3
  const points = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * width
      const y = height - pad - ((v - min) / span) * (height - pad * 2)
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true" focusable="false">
      <polyline
        points={points}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

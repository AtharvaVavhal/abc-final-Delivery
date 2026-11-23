interface SparklineProps {
  values: number[]
  width?: number
  height?: number
  /** Stretch to the container's width (height stays fixed). */
  fluid?: boolean
}

/** Tiny trend line. Decorative (`aria-hidden`): the figure and delta beside
 * it are the accessible content. */
export function Sparkline({ values, width = 96, height = 32, fluid = false }: SparklineProps) {
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
    <svg
      width={fluid ? '100%' : width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio={fluid ? 'none' : undefined}
      aria-hidden="true"
      focusable="false"
    >
      <polyline
        vectorEffect="non-scaling-stroke"
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

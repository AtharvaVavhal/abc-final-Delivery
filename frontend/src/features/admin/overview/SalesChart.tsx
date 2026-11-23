import type { DashboardDayPoint } from '@/types/admin'
import { niceCeil } from './overviewMath'
import styles from './SalesOverview.module.css'

const W = 760
const H = 200
const TOP = 10
const BOTTOM = 190
const TICKS = 4

const compactINR = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  notation: 'compact',
  maximumFractionDigits: 1,
})
const dayLabel = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' })
const formatDay = (isoDate: string) => {
  const date = new Date(`${isoDate}T00:00:00Z`)
  // A malformed date must never take the whole dashboard down.
  return Number.isNaN(date.getTime()) ? '' : dayLabel.format(date)
}

interface SalesChartProps {
  current: DashboardDayPoint[]
  previous: DashboardDayPoint[]
  /** Read aloud in place of the drawing. */
  summary: string
}

/** Daily net sales for this period (solid ink line, amber wash) against the
 * previous one (dashed grey). Static by design — restrained, no hover UI;
 * the exact figures live in the KPI tiles. The line is ink, not amber:
 * amber on white is below the 3:1 contrast a chart line needs. */
export function SalesChart({ current, previous, summary }: SalesChartProps) {
  const cur = current.map((d) => Number(d.sales))
  const prev = previous.map((d) => Number(d.sales))
  const max = niceCeil(Math.max(0, ...cur, ...prev))
  const n = Math.max(cur.length, 2)
  const x = (i: number) => (i / (n - 1)) * W
  const y = (v: number) => BOTTOM - (v / max) * (BOTTOM - TOP)
  const line = (vals: number[]) => vals.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')
  const lastIndex = cur.length - 1

  const ticks = Array.from({ length: TICKS + 1 }, (_, i) => (max / TICKS) * i)
  const labelIdx = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(f * lastIndex))

  return (
    <div className={styles.chart}>
      <div className={styles.yAxis} aria-hidden="true">
        {[...ticks].reverse().map((t) => (
          <span key={t}>{t === 0 ? '0' : compactINR.format(t)}</span>
        ))}
      </div>
      <div className={styles.plot}>
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={summary} className={styles.svg}>
          {ticks.map((t) => (
            <line key={t} x1="0" x2={W} y1={y(t)} y2={y(t)} className={t === 0 ? styles.axis : styles.grid} />
          ))}
          <polyline points={line(prev)} className={styles.prevLine} />
          <polygon points={`0,${BOTTOM} ${line(cur)} ${x(lastIndex)},${BOTTOM}`} className={styles.area} />
          <polyline points={line(cur)} className={styles.curLine} />
          <circle cx={x(lastIndex)} cy={y(cur[lastIndex] ?? 0)} r="4" className={styles.endDot} />
        </svg>
        <div className={styles.xAxis} aria-hidden="true">
          {labelIdx.map((i) => (
            <span key={i}>{current[i] ? formatDay(current[i].date) : ''}</span>
          ))}
        </div>
      </div>
    </div>
  )
}

import { useState } from 'react'
import { useAdminDashboardOverview } from '@/hooks/useAdminDashboardOverview'
import { AdminCard } from '@/components/admin/AdminCard'
import { AdminSelect } from '@/components/admin/AdminSelect'
import { formatPrice } from '@/utils/formatPrice'
import type { OverviewDays } from '@/types/admin'
import { dailyAverage, percentDelta, pointsDelta, type Delta } from './overviewMath'
import { SalesChart } from './SalesChart'
import { Sparkline } from './Sparkline'
import styles from './SalesOverview.module.css'

const RANGES: { days: OverviewDays; label: string }[] = [
  { days: 7, label: 'Last 7 days' },
  { days: 30, label: 'Last 30 days' },
  { days: 90, label: 'Last 90 days' },
]

const ARROW: Record<Delta['direction'], string> = { up: '▲', down: '▼', flat: '', new: '', none: '' }
const SR: Record<Delta['direction'], string> = {
  up: 'up',
  down: 'down',
  flat: 'unchanged',
  new: 'new, no earlier period to compare',
  none: 'no data',
}

function DeltaText({ delta }: { delta: Delta }) {
  return (
    <span className={styles.delta} data-direction={delta.direction}>
      {ARROW[delta.direction] && <span aria-hidden="true">{ARROW[delta.direction]} </span>}
      {delta.label}
      <span className={styles.srOnly}> {SR[delta.direction]} versus the previous period</span>
    </span>
  )
}

interface KpiProps {
  label: string
  value: string
  delta: Delta
  spark?: number[]
}

function Kpi({ label, value, delta, spark }: KpiProps) {
  return (
    <div className={styles.kpi}>
      <span className={styles.kpiLabel}>{label}</span>
      <div className={styles.kpiRow}>
        <div className={styles.kpiFigures}>
          <strong className={styles.kpiValue}>{value}</strong>
          <DeltaText delta={delta} />
        </div>
        {spark && (
          <span className={styles.spark}>
            <Sparkline values={spark} />
          </span>
        )}
      </div>
    </div>
  )
}

/**
 * Sales over time for the admin Overview: four KPI tiles (each against the
 * previous period of the same length) and a daily sales chart, from
 * GET /admin/dashboard/overview. It never blocks the rest of the page — if
 * the endpoint is unavailable it shows a short note and the existing
 * totals and order lists still render.
 */
export function SalesOverview() {
  const [days, setDays] = useState<OverviewDays>(30)
  const { data, isPending, isError } = useAdminDashboardOverview(days)

  const picker = (
    <AdminSelect
      label="Period"
      hideLabel
      name="overview-period"
      value={days}
      onChange={(event) => setDays(Number(event.target.value) as OverviewDays)}
    >
      {RANGES.map((r) => (
        <option key={r.days} value={r.days}>
          {r.label}
        </option>
      ))}
    </AdminSelect>
  )

  return (
    <AdminCard as="section" title="Sales" actions={picker}>
      {isPending ? (
        <div className={styles.placeholder} role="status" aria-busy="true">
          Loading sales…
        </div>
      ) : isError || !data ? (
        <p className={styles.note}>Sales trends are unavailable right now.</p>
      ) : (
        <div className={styles.body}>
          <div className={styles.kpis}>
            <Kpi
              label="Net sales"
              value={formatPrice(data.current.netSales)}
              delta={percentDelta(Number(data.current.netSales), Number(data.previous.netSales))}
              spark={data.current.daily.map((d) => Number(d.sales))}
            />
            <Kpi
              label="Orders"
              value={String(data.current.orders)}
              delta={percentDelta(data.current.orders, data.previous.orders)}
              spark={data.current.daily.map((d) => d.orders)}
            />
            <Kpi
              label="Average order"
              value={formatPrice(data.current.averageOrderValue)}
              delta={percentDelta(
                Number(data.current.averageOrderValue),
                Number(data.previous.averageOrderValue),
              )}
              spark={data.current.daily.map(dailyAverage)}
            />
            <Kpi
              label="Repeat customers"
              value={
                data.current.repeatCustomerRate === null
                  ? '—'
                  : `${Math.round(data.current.repeatCustomerRate * 100)}%`
              }
              delta={pointsDelta(data.current.repeatCustomerRate, data.previous.repeatCustomerRate)}
            />
          </div>
          <SalesChart
            current={data.current.daily}
            previous={data.previous.daily}
            summary={`Net sales per day over the last ${data.days} days: ${formatPrice(
              data.current.netSales,
            )}, against ${formatPrice(data.previous.netSales)} in the previous ${data.days} days.`}
          />
          <p className={styles.legend}>
            <span className={styles.keyCurrent} aria-hidden="true" /> This period
            <span className={styles.keyPrevious} aria-hidden="true" /> Previous {data.days} days
            <span className={styles.basis}>Net sales = paid orders and later. Days are India time.</span>
          </p>
        </div>
      )}
    </AdminCard>
  )
}

/** GET /admin/dashboard/overview — time-bucketed sales for the admin
 * Overview chart, KPI tiles and sparklines. Money is a major-unit decimal
 * string (§21), like every other money field in the API. */

export interface DashboardDayPoint {
  /** Calendar day in India time (Asia/Kolkata), `YYYY-MM-DD`. */
  date: string;
  /** Paid-or-later order totals placed that day. */
  sales: string;
  orders: number;
}

export interface DashboardPeriodSummary {
  /** Sum of paid-or-later order totals in the period — the same "net
   * sales" definition as GET /admin/dashboard's `totalRevenue`. */
  netSales: string;
  orders: number;
  /** netSales / orders, rounded to the paisa; "0.00" when there are no
   * orders. */
  averageOrderValue: string;
  /** Distinct customers with a paid-or-later order in the period. */
  buyers: number;
  /** Of those, customers who also had a paid-or-later order before the
   * period started. */
  repeatBuyers: number;
  /** repeatBuyers / buyers (0–1, 4 decimals), or null with no buyers. */
  repeatCustomerRate: number | null;
  /** One entry per day of the period, zero-filled, oldest first. */
  daily: DashboardDayPoint[];
}

export interface AdminDashboardOverviewView {
  /** Length of each period, in days. */
  days: number;
  currency: 'INR';
  timezone: 'Asia/Kolkata';
  current: DashboardPeriodSummary;
  /** The period of the same length immediately before `current`. */
  previous: DashboardPeriodSummary;
}

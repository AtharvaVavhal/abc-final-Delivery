import { Prisma } from '@prisma/client';
import {
  decimalToPaise,
  paiseToDecimalString,
} from '../cart/pricing/money.util';
import {
  DashboardDayPoint,
  DashboardPeriodSummary,
} from './dto/dashboard-overview.interface';

/** Pure date-window + aggregation helpers for the Overview endpoint, kept
 * out of AdminService so they are testable without a database. Days are
 * India calendar days (UTC+5:30, no DST), because that is the store's
 * "today" — bucketing by UTC would split an evening order onto the wrong
 * day. */

const DAY_MS = 86_400_000;
const IST_OFFSET_MS = 330 * 60_000;

/** Midnight (India time) at the start of the day containing `date`. */
export function istDayStart(date: Date): Date {
  const shifted = new Date(date.getTime() + IST_OFFSET_MS);
  shifted.setUTCHours(0, 0, 0, 0);
  return new Date(shifted.getTime() - IST_OFFSET_MS);
}

/** `YYYY-MM-DD` of the India calendar day containing `date`. */
export function istDayKey(date: Date): string {
  return new Date(date.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

export interface OverviewWindows {
  previousStart: Date;
  currentStart: Date;
  /** Exclusive end of the current period (start of tomorrow, India time). */
  currentEnd: Date;
}

/** `days` India calendar days ending today (inclusive), plus the equal
 * period right before it. */
export function computeWindows(now: Date, days: number): OverviewWindows {
  const todayStart = istDayStart(now).getTime();
  const currentStart = todayStart - (days - 1) * DAY_MS;
  return {
    previousStart: new Date(currentStart - days * DAY_MS),
    currentStart: new Date(currentStart),
    currentEnd: new Date(todayStart + DAY_MS),
  };
}

export interface OverviewOrderRow {
  createdAt: Date;
  total: Prisma.Decimal;
  userId: string;
}

/** Summarises the orders that fall in `[start, start + days)`.
 * `returningBuyerIds` are customers known to have a paid-or-later order
 * before `start`. */
export function summarisePeriod(
  orders: OverviewOrderRow[],
  start: Date,
  days: number,
  returningBuyerIds: ReadonlySet<string>,
): DashboardPeriodSummary {
  const startMs = start.getTime();
  const endMs = startMs + days * DAY_MS;

  const salesByDay = new Map<string, bigint>();
  const ordersByDay = new Map<string, number>();
  const buyers = new Set<string>();
  let netSalesPaise = 0n;
  let orderCount = 0;

  for (const order of orders) {
    const at = order.createdAt.getTime();
    if (at < startMs || at >= endMs) continue;
    const paise = decimalToPaise(order.total);
    const key = istDayKey(order.createdAt);
    salesByDay.set(key, (salesByDay.get(key) ?? 0n) + paise);
    ordersByDay.set(key, (ordersByDay.get(key) ?? 0) + 1);
    buyers.add(order.userId);
    netSalesPaise += paise;
    orderCount += 1;
  }

  const daily: DashboardDayPoint[] = [];
  for (let i = 0; i < days; i += 1) {
    const key = istDayKey(new Date(startMs + i * DAY_MS));
    daily.push({
      date: key,
      sales: paiseToDecimalString(salesByDay.get(key) ?? 0n),
      orders: ordersByDay.get(key) ?? 0,
    });
  }

  let repeatBuyers = 0;
  for (const id of buyers) {
    if (returningBuyerIds.has(id)) repeatBuyers += 1;
  }

  // Round half up to the paisa.
  const averagePaise =
    orderCount === 0
      ? 0n
      : (netSalesPaise * 2n + BigInt(orderCount)) / (BigInt(orderCount) * 2n);

  return {
    netSales: paiseToDecimalString(netSalesPaise),
    orders: orderCount,
    averageOrderValue: paiseToDecimalString(averagePaise),
    buyers: buyers.size,
    repeatBuyers,
    repeatCustomerRate:
      buyers.size === 0
        ? null
        : Math.round((repeatBuyers / buyers.size) * 10_000) / 10_000,
    daily,
  };
}

import { Prisma } from '@prisma/client';
import {
  computeWindows,
  istDayKey,
  istDayStart,
  summarisePeriod,
} from './dashboard-overview.util';

const d = (iso: string) => new Date(iso);
const order = (iso: string, total: string, userId = 'u1') => ({
  createdAt: d(iso),
  total: new Prisma.Decimal(total),
  userId,
});

describe('India-day helpers', () => {
  it('starts the day at 00:00 IST (18:30 UTC the evening before)', () => {
    // 20:00Z on the 23rd is 01:30 IST on the 24th.
    expect(istDayStart(d('2026-11-23T20:00:00Z')).toISOString()).toBe(
      '2026-11-23T18:30:00.000Z',
    );
  });

  it('puts an evening-UTC order on the next India day', () => {
    expect(istDayKey(d('2026-11-23T18:29:59Z'))).toBe('2026-11-23');
    expect(istDayKey(d('2026-11-23T18:30:00Z'))).toBe('2026-11-24');
  });

  it('builds `days` India days ending today plus an equal previous period', () => {
    // 10:00Z on the 23rd = 15:30 IST on the 23rd.
    const w = computeWindows(d('2026-11-23T10:00:00Z'), 7);
    expect(istDayKey(w.currentStart)).toBe('2026-11-17');
    expect(istDayKey(new Date(w.currentEnd.getTime() - 1))).toBe('2026-11-23');
    expect(istDayKey(w.previousStart)).toBe('2026-11-10');
    expect(w.currentStart.getTime() - w.previousStart.getTime()).toBe(
      7 * 86_400_000,
    );
  });
});

describe('summarisePeriod', () => {
  const start = d('2026-11-16T18:30:00Z'); // 17 Nov 00:00 IST
  const none = new Set<string>();

  it('zero-fills every day and sums sales and orders per India day', () => {
    const s = summarisePeriod(
      [
        order('2026-11-17T04:00:00Z', '999.00'),
        order('2026-11-17T06:00:00Z', '500.50'),
        order('2026-11-19T10:00:00Z', '1299.00'),
      ],
      start,
      7,
      none,
    );
    expect(s.daily).toHaveLength(7);
    expect(s.daily[0]).toEqual({
      date: '2026-11-17',
      sales: '1499.50',
      orders: 2,
    });
    expect(s.daily[1]).toEqual({ date: '2026-11-18', sales: '0.00', orders: 0 });
    expect(s.daily[2]).toEqual({
      date: '2026-11-19',
      sales: '1299.00',
      orders: 1,
    });
    expect(s.netSales).toBe('2798.50');
    expect(s.orders).toBe(3);
  });

  it('ignores orders outside the period', () => {
    const s = summarisePeriod(
      [
        order('2026-11-16T18:29:00Z', '100.00'), // just before
        order('2026-11-24T18:30:00Z', '100.00'), // just after (7 days)
        order('2026-11-20T10:00:00Z', '250.00'),
      ],
      start,
      7,
      none,
    );
    expect(s.netSales).toBe('250.00');
    expect(s.orders).toBe(1);
  });

  it('averages to the paisa (half up) and is 0.00 with no orders', () => {
    expect(
      summarisePeriod(
        [order('2026-11-17T04:00:00Z', '100.00'), order('2026-11-18T04:00:00Z', '0.01')],
        start,
        7,
        none,
      ).averageOrderValue,
    ).toBe('50.01'); // 10001 paise / 2 = 5000.5 -> 5001
    const empty = summarisePeriod([], start, 7, none);
    expect(empty.averageOrderValue).toBe('0.00');
    expect(empty.netSales).toBe('0.00');
    expect(empty.repeatCustomerRate).toBeNull();
  });

  it('counts distinct buyers and the share who bought before', () => {
    const s = summarisePeriod(
      [
        order('2026-11-17T04:00:00Z', '100.00', 'a'),
        order('2026-11-18T04:00:00Z', '100.00', 'a'),
        order('2026-11-18T05:00:00Z', '100.00', 'b'),
        order('2026-11-19T05:00:00Z', '100.00', 'c'),
      ],
      start,
      7,
      new Set(['a']),
    );
    expect(s.buyers).toBe(3);
    expect(s.repeatBuyers).toBe(1);
    expect(s.repeatCustomerRate).toBe(0.3333);
  });
});

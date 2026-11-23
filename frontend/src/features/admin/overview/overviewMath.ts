export interface Delta {
  /** "up" / "down" / "flat" / "new" (no prior data) / "none" (no data at all). */
  direction: 'up' | 'down' | 'flat' | 'new' | 'none'
  /** Text shown next to the arrow, e.g. "20.3%" or "2.4 pts". */
  label: string
}

/** Percent change of `current` against `previous` (decimal strings or numbers). */
export function percentDelta(current: number, previous: number): Delta {
  if (previous === 0 && current === 0) return { direction: 'none', label: '—' }
  if (previous === 0) return { direction: 'new', label: 'New' }
  const pct = ((current - previous) / previous) * 100
  if (Math.abs(pct) < 0.05) return { direction: 'flat', label: '0%' }
  return { direction: pct > 0 ? 'up' : 'down', label: `${Math.abs(pct).toFixed(1)}%` }
}

/** Change in a 0–1 rate, as percentage points. */
export function pointsDelta(current: number | null, previous: number | null): Delta {
  if (current === null || previous === null) return { direction: 'none', label: '—' }
  const pts = (current - previous) * 100
  if (Math.abs(pts) < 0.05) return { direction: 'flat', label: '0 pts' }
  return { direction: pts > 0 ? 'up' : 'down', label: `${Math.abs(pts).toFixed(1)} pts` }
}

/** Per-day order value; a day with no orders is 0, not NaN. */
export function dailyAverage(day: { sales: string; orders: number }): number {
  return day.orders === 0 ? 0 : Number(day.sales) / day.orders
}

/** Smallest "nice" axis maximum (1, 2, 2.5, 5 × 10ⁿ) that is ≥ `value`. */
export function niceCeil(value: number): number {
  if (value <= 0) return 1000
  const exp = Math.floor(Math.log10(value))
  const base = 10 ** exp
  for (const step of [1, 2, 2.5, 5, 10]) {
    if (step * base >= value) return step * base
  }
  return 10 * base
}

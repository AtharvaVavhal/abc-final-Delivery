import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import MockAdapter from 'axios-mock-adapter'
import { apiClient } from '@/services/api/client'
import { renderWithProviders } from '@/test/test-utils'
import { dailyAverage, niceCeil, percentDelta, pointsDelta } from './overviewMath'
import { SalesOverview } from './SalesOverview'

function period(over: Partial<Record<string, unknown>> = {}, days = 7) {
  return {
    netSales: '1000.00',
    orders: 4,
    averageOrderValue: '250.00',
    buyers: 4,
    repeatBuyers: 1,
    repeatCustomerRate: 0.25,
    daily: Array.from({ length: days }, (_, i) => ({
      date: new Date(Date.UTC(2026, 9, 25 + i)).toISOString().slice(0, 10),
      sales: i === 0 ? '1000.00' : '0.00',
      orders: i === 0 ? 4 : 0,
    })),
    ...over,
  }
}

function overview(days = 7, current = {}, previous = {}) {
  return {
    success: true,
    data: {
      days,
      currency: 'INR',
      timezone: 'Asia/Kolkata',
      current: period(current, days),
      previous: period({ netSales: '800.00', orders: 5, averageOrderValue: '160.00', repeatCustomerRate: 0.2, ...previous }, days),
    },
  }
}

describe('SalesOverview', () => {
  let mock: MockAdapter
  beforeEach(() => {
    mock = new MockAdapter(apiClient)
  })
  afterEach(() => mock.restore())

  it('shows the four KPIs with their change against the previous period', async () => {
    mock.onGet('/admin/dashboard/overview').reply(200, overview(30))
    renderWithProviders(<SalesOverview />)

    await screen.findByText('₹1,000.00')
    const region = screen.getByRole('region', { name: 'Sales' })
    expect(within(region).getByText('₹1,000.00')).toBeInTheDocument() // net sales
    expect(within(region).getByText('₹250.00')).toBeInTheDocument() // average order
    expect(within(region).getByText('25%')).toBeInTheDocument() // repeat customers
    expect(within(region).getByText(/25\.0%/)).toBeInTheDocument() // sales +25% (1000 vs 800)
    expect(within(region).getByText(/5\.0 pts/)).toBeInTheDocument() // repeat 25% vs 20%
    // Orders went down 5 -> 4 (-20%); the direction is spoken, not just coloured.
    expect(within(region).getByText(/20\.0%/)).toBeInTheDocument()
    expect(within(region).getAllByText(/down versus the previous period/).length).toBeGreaterThan(0)
  })

  it('describes the chart in words and defaults to the last 30 days', async () => {
    mock.onGet('/admin/dashboard/overview').reply(200, overview(30))
    renderWithProviders(<SalesOverview />)

    const chart = await screen.findByRole('img', { name: /Net sales per day over the last 30 days/ })
    expect(chart).toHaveAccessibleName(/₹1,000\.00, against ₹800\.00 in the previous 30 days/)
    expect(mock.history.get[0].params).toEqual({ days: 30 })
  })

  it('refetches for the chosen period', async () => {
    const user = userEvent.setup()
    mock.onGet('/admin/dashboard/overview').reply((config) => [
      200,
      overview((config.params as { days: number }).days),
    ])
    renderWithProviders(<SalesOverview />)

    await screen.findByRole('img', { name: /last 30 days/ })
    await user.selectOptions(screen.getByLabelText('Period'), '7')

    expect(await screen.findByRole('img', { name: /last 7 days/ })).toBeInTheDocument()
    expect(mock.history.get.at(-1)?.params).toEqual({ days: 7 })
  })

  it('shows a short note, not an error page, when the endpoint fails', async () => {
    mock.onGet('/admin/dashboard/overview').reply(500)
    renderWithProviders(<SalesOverview />)
    expect(await screen.findByText('Sales trends are unavailable right now.')).toBeInTheDocument()
  })

  it('shows a plain empty state, not a flat zero chart, before the first paid order', async () => {
    mock.onGet('/admin/dashboard/overview').reply(
      200,
      overview(30, { orders: 0, netSales: '0.00', averageOrderValue: '0.00', buyers: 0, repeatBuyers: 0, repeatCustomerRate: null }, { orders: 0, netSales: '0.00', averageOrderValue: '0.00', repeatCustomerRate: null }),
    )
    renderWithProviders(<SalesOverview />)

    expect(await screen.findByText(/No paid orders in the last 60 days yet/)).toBeInTheDocument()
    expect(screen.queryByRole('img', { name: /Net sales per day/ })).not.toBeInTheDocument()
  })

  it('shows "—" for repeat customers when there were no buyers', async () => {
    mock.onGet('/admin/dashboard/overview').reply(
      200,
      overview(7, { orders: 0, netSales: '0.00', averageOrderValue: '0.00', buyers: 0, repeatBuyers: 0, repeatCustomerRate: null }),
    )
    renderWithProviders(<SalesOverview />)
    await screen.findByText('Net sales')
    const region = screen.getByRole('region', { name: 'Sales' })
    expect(within(region).getAllByText('—').length).toBeGreaterThan(0)
  })
})

describe('overviewMath', () => {
  it('percentDelta handles up, down, flat, new and empty', () => {
    expect(percentDelta(125, 100)).toEqual({ direction: 'up', label: '25.0%' })
    expect(percentDelta(80, 100)).toEqual({ direction: 'down', label: '20.0%' })
    expect(percentDelta(100, 100)).toEqual({ direction: 'flat', label: '0%' })
    expect(percentDelta(50, 0)).toEqual({ direction: 'new', label: 'New' })
    expect(percentDelta(0, 0)).toEqual({ direction: 'none', label: '—' })
  })

  it('pointsDelta compares rates in percentage points and tolerates null', () => {
    expect(pointsDelta(0.25, 0.2)).toEqual({ direction: 'up', label: '5.0 pts' })
    expect(pointsDelta(null, 0.2)).toEqual({ direction: 'none', label: '—' })
  })

  it('dailyAverage is 0 for a day with no orders', () => {
    expect(dailyAverage({ sales: '0.00', orders: 0 })).toBe(0)
    expect(dailyAverage({ sales: '500.00', orders: 2 })).toBe(250)
  })

  it('niceCeil rounds an axis maximum up to 1 / 2 / 2.5 / 5 × 10ⁿ', () => {
    expect(niceCeil(0)).toBe(1000)
    expect(niceCeil(8600)).toBe(10000)
    expect(niceCeil(2100)).toBe(2500)
    expect(niceCeil(5000)).toBe(5000)
    expect(niceCeil(120)).toBe(200)
  })
})

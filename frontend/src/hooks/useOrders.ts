import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { fetchOrder, fetchOrders } from '@/services/api/orders'
import type { ListOrdersParams, OrderDetailView } from '@/types/orders'

export const UNPAID_CHECKOUT_ORDER_QUERY_KEY = ['checkout', 'unpaid-order'] as const

/**
 * The unpaid order checkout must resume — including any coupon already
 * claimed on it — rather than showing a cart-only preview that disagrees
 * with the Razorpay amount.
 */
export function useUnpaidCheckoutOrder() {
  return useQuery({
    queryKey: UNPAID_CHECKOUT_ORDER_QUERY_KEY,
    queryFn: async (): Promise<OrderDetailView | null> => {
      const pending = await fetchOrders({ status: 'PENDING_PAYMENT', limit: 1 })
      if (pending.items[0]) {
        return fetchOrder(pending.items[0].id)
      }
      const failed = await fetchOrders({ status: 'PAYMENT_FAILED', limit: 1 })
      if (failed.items[0]) {
        return fetchOrder(failed.items[0].id)
      }
      return null
    },
    retry: false,
  })
}

export function useOrders(params: ListOrdersParams = {}) {
  return useQuery({
    queryKey: ['orders', 'list', params],
    queryFn: () => fetchOrders(params),
    // Keeps the current page visible (no loading flash) while a new
    // page's data loads in the background — same as useProducts.
    placeholderData: keepPreviousData,
  })
}

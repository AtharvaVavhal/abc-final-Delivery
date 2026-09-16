import { describe, expect, it } from 'vitest'
import { shouldResumeUnpaidOrder } from './unpaidCartMatch'
import type { CartView } from '@/types/cart'
import type { OrderItemView } from '@/types/orders'

const cartLine = {
  id: 'item-1',
  productId: 'prod-1',
  productName: 'Mug',
  variantId: null,
  variantLabel: null,
  quantity: 1,
  unitPrice: '10.00',
  lineTotal: '10.00',
  isAvailable: true,
  unavailableReason: null,
  customizations: [],
}

function cart(items: CartView['items']): CartView {
  return { id: 'cart-1', items, itemCount: items.length, subtotal: '10.00' }
}

function orderItem(overrides: Partial<OrderItemView> = {}): OrderItemView {
  return {
    id: 'oi-1',
    productId: 'prod-1',
    productName: 'Mug',
    variantLabel: null,
    unitPrice: '10.00',
    quantity: 1,
    lineTotal: '10.00',
    customizations: [],
    ...overrides,
  }
}

describe('shouldResumeUnpaidOrder', () => {
  it('resumes when the cart still matches the unpaid order', () => {
    expect(shouldResumeUnpaidOrder(cart([cartLine]), { items: [orderItem()] })).toBe(true)
  })

  it('does not resume after another product is added', () => {
    expect(
      shouldResumeUnpaidOrder(cart([cartLine, { ...cartLine, id: 'item-2', productId: 'prod-2' }]), {
        items: [orderItem()],
      }),
    ).toBe(false)
  })

  it('resumes when the cart is empty so the shopper can still pay or cancel', () => {
    expect(shouldResumeUnpaidOrder(cart([]), { items: [orderItem()] })).toBe(true)
  })
})

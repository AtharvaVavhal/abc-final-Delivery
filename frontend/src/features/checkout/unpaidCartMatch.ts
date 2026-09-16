import type { CartView } from '@/types/cart'
import type { OrderDetailView, OrderItemView } from '@/types/orders'

function lineKey(line: {
  productId: string | null
  variantLabel: string | null
  quantity: number
  customizations: Array<{ fieldLabel: string; textValue: string | null; uploadedFileId: string | null }>
}): string {
  const custom = [...line.customizations]
    .map((c) => `${c.fieldLabel}=${c.textValue ?? ''}:${c.uploadedFileId ?? ''}`)
    .sort()
    .join(';')
  return `${line.productId ?? ''}|${line.variantLabel ?? ''}|${line.quantity}|${custom}`
}

/** True when checkout should resume the unpaid order instead of placing a
 * new one from the current cart. An empty cart still resumes (pay or
 * cancel the pending order). A changed cart does not. */
export function shouldResumeUnpaidOrder(
  cart: CartView | undefined,
  order: Pick<OrderDetailView, 'items'> | null | undefined,
): boolean {
  if (!order) return false
  if (!cart || cart.items.length === 0) return true
  return cartMatchesUnpaidOrderItems(cart, order.items)
}

export function cartMatchesUnpaidOrderItems(
  cart: CartView,
  orderItems: OrderItemView[],
): boolean {
  if (cart.items.length === 0 || cart.items.length !== orderItems.length) {
    return false
  }
  const cartKeys = cart.items
    .map((item) =>
      lineKey({
        productId: item.productId,
        variantLabel: item.variantLabel,
        quantity: item.quantity,
        customizations: item.customizations.map((c) => ({
          fieldLabel: c.label,
          textValue: c.textValue,
          uploadedFileId: c.uploadedFileId,
        })),
      }),
    )
    .sort()
  const orderKeys = orderItems.map((item) => lineKey(item)).sort()
  return cartKeys.every((key, i) => key === orderKeys[i])
}

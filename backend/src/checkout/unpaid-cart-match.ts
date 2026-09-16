/**
 * True when the caller's current cart is the same merchandise as an unpaid
 * order. Used so a dismissed Razorpay attempt can be resumed, while adding
 * or removing products starts a fresh checkout instead of charging the
 * previous order.
 */
export function cartMatchesUnpaidOrder(
  cartLines: Array<{
    productId: string;
    variantLabel: string | null;
    quantity: number;
    customizations: Array<{
      fieldLabel: string;
      textValue: string | null;
      uploadedFileId: string | null;
    }>;
  }>,
  orderLines: Array<{
    productId: string | null;
    variantLabel: string | null;
    quantity: number;
    customizations: Array<{
      fieldLabel: string;
      textValue: string | null;
      uploadedFileId: string | null;
    }>;
  }>,
): boolean {
  if (cartLines.length === 0 || cartLines.length !== orderLines.length) {
    return false;
  }
  const cartKeys = cartLines.map(lineFingerprint).sort();
  const orderKeys = orderLines.map(lineFingerprint).sort();
  return cartKeys.every((key, i) => key === orderKeys[i]);
}

function lineFingerprint(line: {
  productId: string | null;
  variantLabel: string | null;
  quantity: number;
  customizations: Array<{
    fieldLabel: string;
    textValue: string | null;
    uploadedFileId: string | null;
  }>;
}): string {
  const custom = [...line.customizations]
    .map(
      (c) =>
        `${c.fieldLabel}=${c.textValue ?? ''}:${c.uploadedFileId ?? ''}`,
    )
    .sort()
    .join(';');
  return `${line.productId ?? ''}|${line.variantLabel ?? ''}|${line.quantity}|${custom}`;
}

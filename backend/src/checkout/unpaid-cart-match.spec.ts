import { cartMatchesUnpaidOrder } from './unpaid-cart-match';

describe('cartMatchesUnpaidOrder', () => {
  const mug = {
    productId: 'prod-mug',
    variantLabel: null as string | null,
    quantity: 1,
    customizations: [] as Array<{
      fieldLabel: string;
      textValue: string | null;
      uploadedFileId: string | null;
    }>,
  };

  it('matches the same lines regardless of order', () => {
    const poster = { ...mug, productId: 'prod-poster' };
    expect(
      cartMatchesUnpaidOrder([mug, poster], [poster, mug]),
    ).toBe(true);
  });

  it('does not match when a new product was added', () => {
    const poster = { ...mug, productId: 'prod-poster' };
    expect(cartMatchesUnpaidOrder([mug, poster], [mug])).toBe(false);
  });

  it('does not match when quantity changed', () => {
    expect(
      cartMatchesUnpaidOrder([{ ...mug, quantity: 2 }], [mug]),
    ).toBe(false);
  });

  it('does not match an empty cart', () => {
    expect(cartMatchesUnpaidOrder([], [mug])).toBe(false);
  });
});

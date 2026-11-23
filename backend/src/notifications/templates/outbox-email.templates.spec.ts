import { buildEmailContent } from './outbox-email.templates';

describe('photo-changes-requested email', () => {
  const payload = {
    kind: 'PHOTO_CHANGES_REQUESTED',
    orderNumber: 'PF-000042',
    note: 'Too dark <script>alert(1)</script> & blurry',
    orderLink: 'https://abcmanufactures.com/orders/abc',
  };

  it('is chosen by the kind marker on the order-update event', () => {
    const email = buildEmailContent('ORDER_STATUS_CHANGED', payload);
    expect(email?.subject).toBe('Order PF-000042: we need a new photo');
    expect(email?.html).toContain('Open your order and upload a new photo');
    expect(email?.html).toContain('https://abcmanufactures.com/orders/abc');
  });

  it('escapes the staff-typed note so it cannot inject HTML', () => {
    const html = buildEmailContent('ORDER_STATUS_CHANGED', payload)!.html;
    expect(html).not.toContain('<script>');
    expect(html).toContain(
      'Too dark &lt;script&gt;alert(1)&lt;/script&gt; &amp; blurry',
    );
  });

  it('falls back to "sign in" wording when there is no safe https link', () => {
    const html = buildEmailContent('ORDER_STATUS_CHANGED', {
      ...payload,
      orderLink: 'javascript:alert(1)',
    })!.html;
    expect(html).not.toContain('javascript:');
    expect(html).toContain('Sign in to your account');
  });

  it('leaves ordinary status-change emails alone', () => {
    const email = buildEmailContent('ORDER_STATUS_CHANGED', {
      orderNumber: 'PF-000042',
      toStatus: 'SHIPPED',
    });
    expect(email?.subject).toBe('Order PF-000042 update: Shipped');
  });
});

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateOrderDto } from './create-order.dto';

/** Mirrors main.ts's global ValidationPipe options exactly, so this test
 * exercises the same normalise-then-validate behavior production requests
 * go through. */
async function validateDto(payload: Record<string, unknown>) {
  const instance = plainToInstance(CreateOrderDto, payload);
  const errors = await validate(instance, {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  return { instance, errors };
}

const VALID = {
  shippingRecipientName: 'Jane Doe',
  shippingPhone: '9876543210',
  shippingAddressLine1: '123 MG Road',
  shippingCity: 'Pune',
  shippingState: 'Maharashtra',
  shippingPostalCode: '411046',
  shippingCountry: 'India',
};

describe('CreateOrderDto validation', () => {
  it('accepts a well-formed order body', async () => {
    const { errors } = await validateDto(VALID);
    expect(errors).toHaveLength(0);
  });

  describe('shippingPhone', () => {
    it('accepts a bare 10-digit number and normalises it to E.164', async () => {
      const { instance, errors } = await validateDto({
        ...VALID,
        shippingPhone: '9876543210',
      });
      expect(errors).toHaveLength(0);
      expect(instance.shippingPhone).toBe('+919876543210');
    });

    it('accepts +91 with a space and normalises it', async () => {
      const { instance, errors } = await validateDto({
        ...VALID,
        shippingPhone: '+91 98765 43210',
      });
      expect(errors).toHaveLength(0);
      expect(instance.shippingPhone).toBe('+919876543210');
    });

    it('accepts an already-canonical +91XXXXXXXXXX value unchanged', async () => {
      const { instance, errors } = await validateDto({
        ...VALID,
        shippingPhone: '+919812345678',
      });
      expect(errors).toHaveLength(0);
      expect(instance.shippingPhone).toBe('+919812345678');
    });

    it('rejects a number that is too short', async () => {
      const { errors } = await validateDto({
        ...VALID,
        shippingPhone: '98765',
      });
      expect(errors.some((e) => e.property === 'shippingPhone')).toBe(true);
    });

    it('rejects a 10-digit number that does not start 6-9', async () => {
      const { errors } = await validateDto({
        ...VALID,
        shippingPhone: '1234567890',
      });
      expect(errors.some((e) => e.property === 'shippingPhone')).toBe(true);
    });

    it('rejects a US-style +1 number', async () => {
      const { errors } = await validateDto({
        ...VALID,
        shippingPhone: '+12025550123',
      });
      expect(errors.some((e) => e.property === 'shippingPhone')).toBe(true);
    });

    it('rejects an empty phone', async () => {
      const { errors } = await validateDto({ ...VALID, shippingPhone: '' });
      expect(errors.some((e) => e.property === 'shippingPhone')).toBe(true);
    });
  });

  describe('shippingPostalCode', () => {
    it('accepts exactly six digits', async () => {
      const { errors } = await validateDto({
        ...VALID,
        shippingPostalCode: '560001',
      });
      expect(errors).toHaveLength(0);
    });

    it('trims surrounding whitespace', async () => {
      const { instance, errors } = await validateDto({
        ...VALID,
        shippingPostalCode: '  411046  ',
      });
      expect(errors).toHaveLength(0);
      expect(instance.shippingPostalCode).toBe('411046');
    });

    it('rejects a 5-digit PIN', async () => {
      const { errors } = await validateDto({
        ...VALID,
        shippingPostalCode: '41104',
      });
      expect(errors.some((e) => e.property === 'shippingPostalCode')).toBe(
        true,
      );
    });

    it('rejects a 7-digit PIN', async () => {
      const { errors } = await validateDto({
        ...VALID,
        shippingPostalCode: '4110461',
      });
      expect(errors.some((e) => e.property === 'shippingPostalCode')).toBe(
        true,
      );
    });

    it('rejects a non-numeric PIN', async () => {
      const { errors } = await validateDto({
        ...VALID,
        shippingPostalCode: '4110AB',
      });
      expect(errors.some((e) => e.property === 'shippingPostalCode')).toBe(
        true,
      );
    });
  });

  it('still rejects unknown fields (price tampering)', async () => {
    const { errors } = await validateDto({
      ...VALID,
      total: '0.01',
      discountAmount: '999.00',
    });
    expect(errors.some((e) => e.property === 'total')).toBe(true);
  });

  it('still requires the core address fields', async () => {
    const { errors } = await validateDto({ shippingPhone: '9876543210' });
    const missing = errors.map((e) => e.property);
    expect(missing).toEqual(
      expect.arrayContaining([
        'shippingRecipientName',
        'shippingAddressLine1',
        'shippingCity',
        'shippingState',
        'shippingPostalCode',
        'shippingCountry',
      ]),
    );
  });

  describe('delivery pin (optional)', () => {
    it('accepts a pin, and an order without one', async () => {
      expect(
        (
          await validateDto({
            ...VALID,
            shippingLatitude: 18.4575,
            shippingLongitude: 73.8508,
          })
        ).errors,
      ).toHaveLength(0);
      expect((await validateDto(VALID)).errors).toHaveLength(0);
    });

    it.each([
      ['latitude above 90', { shippingLatitude: 91, shippingLongitude: 73 }],
      ['latitude below -90', { shippingLatitude: -91, shippingLongitude: 73 }],
      ['longitude above 180', { shippingLatitude: 18, shippingLongitude: 181 }],
      ['a non-number', { shippingLatitude: 'north', shippingLongitude: 73 }],
    ])('rejects %s', async (_name, pin) => {
      const { errors } = await validateDto({ ...VALID, ...pin });
      expect(errors.length).toBeGreaterThan(0);
    });
  });
});

import { BadRequestException } from '@nestjs/common';
import { normalizeDeliveryPin } from './delivery-pin.util';

describe('normalizeDeliveryPin', () => {
  it('is null when the customer shared no pin', () => {
    expect(normalizeDeliveryPin(undefined, undefined)).toBeNull();
  });

  it('keeps both coordinates, rounded to ~1 m', () => {
    expect(normalizeDeliveryPin(18.457512345, 73.850812345)).toEqual({
      latitude: 18.45751,
      longitude: 73.85081,
    });
  });

  it('accepts 0 and negative values (they are real coordinates)', () => {
    expect(normalizeDeliveryPin(0, -0.00001)).toEqual({
      latitude: 0,
      longitude: -0.00001,
    });
  });

  it('refuses one coordinate without the other instead of silently dropping it', () => {
    expect(() => normalizeDeliveryPin(18.45, undefined)).toThrow(
      BadRequestException,
    );
    expect(() => normalizeDeliveryPin(undefined, 73.85)).toThrow(
      BadRequestException,
    );
  });
});

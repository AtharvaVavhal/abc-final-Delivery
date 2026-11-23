import { BadRequestException } from '@nestjs/common';

/** ~1 m of precision (5 decimal places): enough for a courier to find a door,
 * no more precise than the customer's own pin placement. */
const DECIMALS = 5;

const round = (n: number): number => {
  const f = 10 ** DECIMALS;
  return Math.round(n * f) / f;
};

export interface DeliveryPin {
  latitude: number;
  longitude: number;
}

/**
 * The customer's optional delivery pin from the checkout body: both
 * coordinates or neither (one alone is a bad request, never silently
 * dropped), rounded for storage. Returns null when no pin was shared.
 */
export function normalizeDeliveryPin(
  latitude: number | undefined,
  longitude: number | undefined,
): DeliveryPin | null {
  const hasLat = latitude !== undefined && latitude !== null;
  const hasLng = longitude !== undefined && longitude !== null;
  if (!hasLat && !hasLng) return null;
  if (!hasLat || !hasLng) {
    throw new BadRequestException(
      'shippingLatitude and shippingLongitude must be sent together',
    );
  }
  return { latitude: round(latitude), longitude: round(longitude) };
}

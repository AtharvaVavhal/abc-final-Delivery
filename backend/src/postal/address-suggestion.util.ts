/** Street and area suggested from a map point, for the customer to check and
 * edit — never saved anywhere by the server. Either may be null: OpenStreetMap
 * coverage of Indian house numbers and building names is patchy. */
export interface AddressSuggestion {
  addressLine1: string | null;
  addressLine2: string | null;
}

/** Matches the checkout form's field limit. */
const MAX_LINE = 200;

const text = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

/**
 * Builds "Address line 1" / "Address line 2" suggestions from a Nominatim
 * `address` object: building and house number plus the road for line 1, and
 * the neighbourhood/suburb for line 2. When there is no road, the
 * neighbourhood becomes line 1 so the customer still gets a starting point.
 * City, state and PIN are not included; those come from the PIN lookup.
 */
export function suggestAddressLines(
  address: Record<string, unknown> | undefined,
): AddressSuggestion {
  if (!address) return { addressLine1: null, addressLine2: null };

  const building = text(address.building);
  const houseNumber = text(address.house_number);
  const road = text(address.road);
  const area =
    text(address.neighbourhood) ||
    text(address.suburb) ||
    text(address.quarter) ||
    text(address.hamlet) ||
    text(address.village);

  const houseAndRoad = [houseNumber, road].filter(Boolean).join(' ');
  const line1 = [building, houseAndRoad].filter(Boolean).join(', ');

  const clip = (s: string): string | null => (s ? s.slice(0, MAX_LINE) : null);

  if (line1) {
    return { addressLine1: clip(line1), addressLine2: clip(area) };
  }
  return { addressLine1: clip(area), addressLine2: null };
}

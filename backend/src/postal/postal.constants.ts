/**
 * Postal-lookup provider adapter constants (Phase: Checkout Contact & PIN
 * Validation).
 *
 * The provider (pincodeapi.in) is India Post data — its records carry no
 * `country` field because every PIN is Indian. `LOOKUP_COUNTRY` is that
 * fact about *this provider's dataset*, applied at the adapter boundary —
 * it is not a domain-model constraint. The checkout form keeps Country as
 * a freely editable field; this is only the value the lookup suggests.
 */

/** Hard ceiling on how long the checkout will wait for the provider before
 * falling back to "enter your address manually". Kept short — a slow PIN
 * lookup must never be able to stall the whole checkout. */
export const POSTAL_PROVIDER_TIMEOUT_MS = 4000;

/** The country every record from the Indian postal provider belongs to. */
export const LOOKUP_COUNTRY = 'India';

// ── Client-facing messages (never expose provider internals) ────────────

export const PIN_CODE_INVALID_MESSAGE = 'Enter a valid 6-digit PIN code.';

export const PIN_CODE_NOT_FOUND_MESSAGE =
  "We couldn't find this PIN code. Please check it and try again.";

export const PIN_LOOKUP_UNAVAILABLE_MESSAGE =
  "We couldn't verify this PIN right now. Please check your PIN or enter your address manually.";

// ── "Use my location" (reverse geocoding) ───────────────────────────────

/** Coordinates are rounded to 4 decimals (~11 m) before leaving the server
 * — enough to find a PIN, less precise than the browser's raw fix. */
export const COORDINATE_DECIMALS = 4;

/** Identifies this app to the geocoder (OSM's usage policy requires it).
 * Deliberately generic: no personal or customer details. */
export const REVERSE_GEOCODE_USER_AGENT =
  'AB-Creations-Storefront/1.0 (+https://abcmanufactures.com)';

export const LOCATION_INVALID_MESSAGE = 'Enter a valid latitude and longitude.';

export const LOCATION_PIN_NOT_FOUND_MESSAGE =
  "We couldn't find a PIN code for your location. Please enter it manually.";

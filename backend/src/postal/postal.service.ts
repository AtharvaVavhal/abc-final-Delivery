import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppConfig } from '../common/config/configuration';
import { PIN_CODE_REGEX } from '../common/validation/indian-address.util';
import { PostalLookupView } from './dto/postal-lookup-view.interface';
import {
  COORDINATE_DECIMALS,
  LOCATION_INVALID_MESSAGE,
  LOCATION_PIN_NOT_FOUND_MESSAGE,
  LOOKUP_COUNTRY,
  PIN_CODE_INVALID_MESSAGE,
  PIN_CODE_NOT_FOUND_MESSAGE,
  PIN_LOOKUP_UNAVAILABLE_MESSAGE,
  POSTAL_PROVIDER_TIMEOUT_MS,
  REVERSE_GEOCODE_USER_AGENT,
} from './postal.constants';

/**
 * Server-side proxy for a third-party PIN-code → location lookup.
 *
 * The frontend never talks to the provider directly (§17-style boundary):
 * this service owns the outbound call, the timeout, the error taxonomy,
 * and the normalisation into {@link PostalLookupView}. The provider's raw
 * shape, URLs, status codes and any future API key stay server-side.
 *
 * Failure policy — checkout must never hard-depend on this being up:
 *   - malformed PIN          -> 400 (also caught by ParsePinCodePipe)
 *   - provider 404 / no rows -> 404 "we couldn't find this PIN code"
 *   - provider 429 / 5xx     -> 503 "couldn't verify right now, enter manually"
 *   - network / timeout      -> 503 (same message)
 * A 503 here is advisory only — the checkout form stays usable with a
 * manually-typed City/State/Country.
 *
 * No caching layer: the app has no shared cache abstraction and adding one
 * would be a new dependency / architectural change. The frontend query
 * dedupes repeat lookups of the same PIN within a session; the provider
 * itself sends `Cache-Control: public, max-age=3600` for any CDN in front.
 */
@Injectable()
export class PostalLookupService {
  private readonly logger = new Logger(PostalLookupService.name);

  constructor(private readonly config: ConfigService<AppConfig, true>) {}

  async lookup(rawPostalCode: string): Promise<PostalLookupView> {
    const postalCode = String(rawPostalCode ?? '').trim();
    if (!PIN_CODE_REGEX.test(postalCode)) {
      throw new BadRequestException(PIN_CODE_INVALID_MESSAGE);
    }

    const baseUrl = this.config
      .get('postal', { infer: true })
      .providerBaseUrl.replace(/\/+$/, '');
    const url = `${baseUrl}/pincode/${postalCode}`;

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(POSTAL_PROVIDER_TIMEOUT_MS),
      });
    } catch (err) {
      // DNS / TLS / connection refused / AbortError (timeout). Log the
      // error *name* only — never the URL or the raw error, which could
      // carry provider host details into our logs unnecessarily.
      this.logger.warn(
        `Postal provider unreachable for ${postalCode}: ${this.errName(err)}`,
      );
      throw new ServiceUnavailableException(PIN_LOOKUP_UNAVAILABLE_MESSAGE);
    }

    if (response.status === 404) {
      throw new NotFoundException(PIN_CODE_NOT_FOUND_MESSAGE);
    }
    if (response.status === 429 || response.status >= 500 || !response.ok) {
      this.logger.warn(
        `Postal provider returned HTTP ${response.status} for ${postalCode}`,
      );
      throw new ServiceUnavailableException(PIN_LOOKUP_UNAVAILABLE_MESSAGE);
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      this.logger.warn(
        `Postal provider sent an unparseable body for ${postalCode}`,
      );
      throw new ServiceUnavailableException(PIN_LOOKUP_UNAVAILABLE_MESSAGE);
    }

    return this.normalize(postalCode, body);
  }

  /**
   * "Use my location": coordinates -> the PIN code at that spot. The
   * caller then runs the normal {@link lookup} for city/state, so both
   * paths share one source of truth for the address fields.
   *
   * Privacy: coordinates are rounded before the outbound call, never
   * stored, and never logged (warnings carry the error name only).
   */
  async reverseLookup(
    lat: number,
    lng: number,
  ): Promise<{ postalCode: string }> {
    if (
      !Number.isFinite(lat) ||
      !Number.isFinite(lng) ||
      Math.abs(lat) > 90 ||
      Math.abs(lng) > 180
    ) {
      throw new BadRequestException(LOCATION_INVALID_MESSAGE);
    }

    const baseUrl = this.config
      .get('postal', { infer: true })
      .reverseGeocodeBaseUrl.replace(/\/+$/, '');
    const params = new URLSearchParams({
      format: 'jsonv2',
      addressdetails: '1',
      zoom: '18',
      lat: lat.toFixed(COORDINATE_DECIMALS),
      lon: lng.toFixed(COORDINATE_DECIMALS),
    });

    let response: Response;
    try {
      response = await fetch(`${baseUrl}/reverse?${params.toString()}`, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          'Accept-Language': 'en',
          'User-Agent': REVERSE_GEOCODE_USER_AGENT,
        },
        signal: AbortSignal.timeout(POSTAL_PROVIDER_TIMEOUT_MS),
      });
    } catch (err) {
      this.logger.warn(
        `Reverse geocoder unreachable: ${this.errName(err)}`,
      );
      throw new ServiceUnavailableException(LOCATION_PIN_NOT_FOUND_MESSAGE);
    }

    if (!response.ok) {
      this.logger.warn(`Reverse geocoder returned HTTP ${response.status}`);
      throw new ServiceUnavailableException(LOCATION_PIN_NOT_FOUND_MESSAGE);
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new ServiceUnavailableException(LOCATION_PIN_NOT_FOUND_MESSAGE);
    }

    const address = (body as { address?: Record<string, unknown> } | null)
      ?.address;
    const countryCode = this.str(address?.country_code).toLowerCase();
    const postalCode = this.str(address?.postcode).replace(/\s+/g, '');
    if (countryCode !== 'in' || !PIN_CODE_REGEX.test(postalCode)) {
      throw new NotFoundException(LOCATION_PIN_NOT_FOUND_MESSAGE);
    }
    return { postalCode };
  }

  /**
   * Collapses the provider's `data.post_offices[]` (one row per post
   * office under the PIN) into a single location. `district` and `state`
   * are taken as the most common value across every row rather than
   * trusting `post_offices[0]` — a PIN occasionally spans post offices in
   * different localities, and the first row is not authoritative.
   * `office_name`, slugs, lat/long, DIGIPIN etc. are dropped entirely.
   */
  private normalize(postalCode: string, body: unknown): PostalLookupView {
    const offices = this.extractOffices(body);
    if (offices.length === 0) {
      // Some providers answer 200 with an empty list instead of 404.
      throw new NotFoundException(PIN_CODE_NOT_FOUND_MESSAGE);
    }

    const district = this.mostCommon(
      offices.map((o) => this.str(o.district)).filter((v) => v !== ''),
    );
    const state = this.mostCommon(
      offices.map((o) => this.str(o.state)).filter((v) => v !== ''),
    );

    if (district === '' || state === '') {
      this.logger.warn(
        `Postal provider payload for ${postalCode} had no usable district/state`,
      );
      throw new ServiceUnavailableException(PIN_LOOKUP_UNAVAILABLE_MESSAGE);
    }

    return {
      postalCode,
      city: district,
      district,
      state,
      country: LOOKUP_COUNTRY,
    };
  }

  private extractOffices(body: unknown): Record<string, unknown>[] {
    if (typeof body !== 'object' || body === null) {
      return [];
    }
    const data = (body as { data?: unknown }).data;
    const list =
      typeof data === 'object' && data !== null
        ? (data as { post_offices?: unknown }).post_offices
        : undefined;
    if (!Array.isArray(list)) {
      return [];
    }
    return list.filter(
      (row): row is Record<string, unknown> =>
        typeof row === 'object' && row !== null,
    );
  }

  private mostCommon(values: string[]): string {
    if (values.length === 0) {
      return '';
    }
    const counts = new Map<string, number>();
    for (const value of values) {
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }
    let best = values[0];
    let bestCount = 0;
    for (const [value, count] of counts) {
      if (count > bestCount) {
        best = value;
        bestCount = count;
      }
    }
    return best;
  }

  private str(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
  }

  private errName(err: unknown): string {
    // `fetch` abort/timeout throws a DOMException, which is not an `Error`
    // instance in Node — match on the shape, not the constructor.
    if (
      typeof err === 'object' &&
      err !== null &&
      typeof (err as { name?: unknown }).name === 'string'
    ) {
      return (err as { name: string }).name || 'Error';
    }
    return 'unknown error';
  }
}

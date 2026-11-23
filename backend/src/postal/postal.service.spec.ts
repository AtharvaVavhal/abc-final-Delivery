import {
  BadRequestException,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PostalLookupService } from './postal.service';

/**
 * Direct-instantiation mocking, same pattern as the other *.service.spec.ts
 * files. `global.fetch` is stubbed per test — no real outbound call — and
 * the provider's real response shape (captured live from
 * api.pincodeapi.in) is used for the happy paths.
 */
describe('PostalLookupService', () => {
  const config = {
    get: () => ({
      providerBaseUrl: 'https://provider.test/api/v1',
      reverseGeocodeBaseUrl: 'https://geo.test',
    }),
  };

  function buildService() {
    return new PostalLookupService(config as never);
  }

  function mockFetch(impl: () => Promise<Response>) {
    return jest.spyOn(global, 'fetch').mockImplementation(impl);
  }

  function providerResponse(body: unknown, status = 200): Promise<Response> {
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
    );
  }

  const SINGLE_OFFICE = {
    success: true,
    data: {
      pincode: '411046',
      post_offices: [
        {
          id: 85403,
          office_name: 'Katraj S.O',
          office_slug: 'katraj-s-o',
          office_type: 'PO',
          district: 'Pune',
          district_slug: 'pune',
          state: 'Maharashtra',
          state_slug: 'maharashtra',
          circle: 'Maharashtra Circle',
          latitude: 18.446,
          longitude: 73.86,
          digipin: '4FP4526LCL',
        },
      ],
    },
    meta: { api_version: 'v1', count: 1 },
  };

  const MULTI_OFFICE = {
    success: true,
    data: {
      pincode: '400001',
      post_offices: [
        { office_name: 'Mpt S.O', district: 'Mumbai', state: 'Maharashtra' },
        {
          office_name: 'Tajmahal S.O',
          district: 'Mumbai',
          state: 'Maharashtra',
        },
        { office_name: 'Mumbai GPO', district: 'Mumbai', state: 'Maharashtra' },
      ],
    },
  };

  async function catchError(promise: Promise<unknown>): Promise<Error> {
    try {
      await promise;
    } catch (err) {
      return err as Error;
    }
    throw new Error('expected the promise to reject, but it resolved');
  }

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('normalises a single-post-office PIN to city/district/state/country', async () => {
    const spy = mockFetch(() => providerResponse(SINGLE_OFFICE));
    const result = await buildService().lookup('411046');

    expect(result).toEqual({
      postalCode: '411046',
      city: 'Pune',
      district: 'Pune',
      state: 'Maharashtra',
      country: 'India',
    });
    expect(spy).toHaveBeenCalledWith(
      'https://provider.test/api/v1/pincode/411046',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('resolves a multi-post-office PIN without trusting the first row blindly', async () => {
    mockFetch(() => providerResponse(MULTI_OFFICE));
    const result = await buildService().lookup('400001');

    expect(result.district).toBe('Mumbai');
    expect(result.state).toBe('Maharashtra');
    expect(result.city).toBe('Mumbai');
  });

  it('picks the most common district when post offices disagree', async () => {
    mockFetch(() =>
      providerResponse({
        data: {
          post_offices: [
            { district: 'Pune', state: 'Maharashtra' },
            { district: 'Pune', state: 'Maharashtra' },
            { district: 'Pimpri', state: 'Maharashtra' },
          ],
        },
      }),
    );
    const result = await buildService().lookup('411001');
    expect(result.district).toBe('Pune');
  });

  it('never leaks provider internals (slugs, office names, coordinates, digipin)', async () => {
    mockFetch(() => providerResponse(SINGLE_OFFICE));
    const result = await buildService().lookup('411046');

    const serialised = JSON.stringify(result);
    expect(serialised).not.toMatch(
      /slug|office_name|Katraj|digipin|latitude|circle/i,
    );
    expect(Object.keys(result).sort()).toEqual([
      'city',
      'country',
      'district',
      'postalCode',
      'state',
    ]);
  });

  it('rejects a malformed PIN before making any outbound call', async () => {
    const spy = mockFetch(() => providerResponse(SINGLE_OFFICE));
    await expect(buildService().lookup('12345')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(spy).not.toHaveBeenCalled();
  });

  it('maps a provider 404 to a NotFoundException with a friendly message', async () => {
    mockFetch(() =>
      providerResponse(
        { code: 'PINCODE_NOT_FOUND', detail: 'No post office was found.' },
        404,
      ),
    );
    const err = await catchError(buildService().lookup('999999'));
    expect(err).toBeInstanceOf(NotFoundException);
    expect(err.message).toBe(
      "We couldn't find this PIN code. Please check it and try again.",
    );
  });

  it('maps a 200-with-empty-list to NotFound', async () => {
    mockFetch(() => providerResponse({ data: { post_offices: [] } }));
    await expect(buildService().lookup('123456')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('maps a provider 429 to a normalised 503 (never surfaces the rate limit)', async () => {
    mockFetch(() => providerResponse({ detail: 'slow down' }, 429));
    const err = await catchError(buildService().lookup('411046'));
    expect(err).toBeInstanceOf(ServiceUnavailableException);
    expect(err.message).toBe(
      "We couldn't verify this PIN right now. Please check your PIN or enter your address manually.",
    );
  });

  it('maps a provider 500 to a normalised 503', async () => {
    mockFetch(() => providerResponse({ detail: 'boom' }, 500));
    await expect(buildService().lookup('411046')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('maps a network failure / timeout to a normalised 503', async () => {
    const timeout = new DOMException('The operation timed out', 'TimeoutError');
    mockFetch(() => Promise.reject(timeout));
    await expect(buildService().lookup('411046')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('maps an unparseable provider body to a normalised 503', async () => {
    mockFetch(() =>
      Promise.resolve(
        new Response('<!doctype html><html>not json</html>', {
          status: 200,
          headers: { 'content-type': 'text/html' },
        }),
      ),
    );
    await expect(buildService().lookup('411046')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('passes an AbortSignal so a slow provider call is bounded', async () => {
    const spy = mockFetch(() => providerResponse(SINGLE_OFFICE));
    await buildService().lookup('411046');
    const options = spy.mock.calls[0][1] as RequestInit;
    expect(options.signal).toBeInstanceOf(AbortSignal);
  });

  describe('reverseLookup ("Use my location")', () => {
    const PUNE = {
      address: { postcode: '411 046', country_code: 'in', state: 'Maharashtra' },
    };

    it('returns the PIN (spaces stripped) for a spot in India', async () => {
      mockFetch(() => providerResponse(PUNE));
      await expect(
        buildService().reverseLookup(18.4575, 73.8508),
      ).resolves.toEqual({ postalCode: '411046' });
    });

    it('rounds coordinates to 4 decimals and identifies the app, with no other data', async () => {
      const spy = mockFetch(() => providerResponse(PUNE));
      await buildService().reverseLookup(18.457512345, 73.850812345);
      const [url, options] = spy.mock.calls[0] as [string, RequestInit];
      expect(url).toContain('https://geo.test/reverse?');
      expect(url).toContain('lat=18.4575');
      expect(url).toContain('lon=73.8508');
      expect(url).not.toContain('18.45751');
      expect(
        (options.headers as Record<string, string>)['User-Agent'],
      ).toContain('AB-Creations');
    });

    it('rejects out-of-range or non-finite coordinates without calling the provider', async () => {
      const spy = mockFetch(() => providerResponse(PUNE));
      await expect(buildService().reverseLookup(91, 10)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      await expect(
        buildService().reverseLookup(10, NaN),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(spy).not.toHaveBeenCalled();
    });

    it('404s outside India or when the spot has no usable PIN', async () => {
      mockFetch(() =>
        providerResponse({ address: { postcode: '90210', country_code: 'us' } }),
      );
      await expect(
        buildService().reverseLookup(34.09, -118.4),
      ).rejects.toBeInstanceOf(NotFoundException);
      mockFetch(() => providerResponse({ address: { country_code: 'in' } }));
      await expect(
        buildService().reverseLookup(18.45, 73.85),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('503s when the geocoder is down, without leaking coordinates to logs', async () => {
      mockFetch(() => Promise.reject(new Error('boom 18.4575,73.8508')));
      const warn = jest
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => undefined);
      await expect(
        buildService().reverseLookup(18.4575, 73.8508),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
      expect(JSON.stringify(warn.mock.calls)).not.toContain('18.4575');
    });
  });
});

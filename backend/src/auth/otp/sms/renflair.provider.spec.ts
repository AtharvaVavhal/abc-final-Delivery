import { ConfigService } from '@nestjs/config';
import { RenflairProvider } from './renflair.provider';

function provider(apiKey = 'SECRETKEY') {
  const config = {
    get: () => ({ renflair: { apiKey, baseUrl: 'https://renflair.test/' } }),
  } as unknown as ConfigService<any, true>;
  return new RenflairProvider(config);
}

function mockFetch(status: number, body: string) {
  const fn = jest.fn().mockResolvedValue({
    status,
    text: () => Promise.resolve(body),
  });
  global.fetch = fn as unknown as typeof fetch;
  return fn;
}

describe('RenflairProvider', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  it('GETs V1.php with API, 10-digit PHONE, OTP and COUNTRY=91', async () => {
    const fetchMock = mockFetch(200, '{"status":"success"}');
    await provider().sendOtp('+919876543210', '123456');

    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(url.origin + url.pathname).toBe('https://renflair.test/V1.php');
    expect(url.searchParams.get('API')).toBe('SECRETKEY');
    expect(url.searchParams.get('PHONE')).toBe('9876543210');
    expect(url.searchParams.get('OTP')).toBe('123456');
    expect(url.searchParams.get('COUNTRY')).toBe('91');
    expect(init.method).toBe('GET');
    expect(init.redirect).toBe('error');
  });

  it.each([
    ['non-2xx', 500, '{"status":"success"}'],
    ['non-JSON body', 200, '<html>login</html>'],
    ['status=error', 200, '{"status":"error"}'],
    ['status=failed', 200, '{"status":"Failed"}'],
    ['success=false', 200, '{"success":false}'],
    ['error message', 200, '{"error":"Insufficient balance"}'],
    ['empty body', 200, ''],
  ])('treats %s as a failure', async (_n, status, body) => {
    mockFetch(status, body);
    await expect(provider().sendOtp('+919876543210', '123456')).rejects.toThrow(
      'WhatsApp delivery failed',
    );
  });

  it('accepts a JSON success body in common shapes', async () => {
    for (const body of [
      '{"status":"success"}',
      '{"success":true}',
      '{"message":"sent"}',
    ]) {
      mockFetch(200, body);
      await expect(
        provider().sendOtp('+919876543210', '123456'),
      ).resolves.toBeUndefined();
    }
  });

  it('rejects non-Indian numbers without calling out', async () => {
    const fetchMock = mockFetch(200, '{}');
    await expect(provider().sendOtp('+14155550100', '123456')).rejects.toThrow(
      /Indian/,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fails clearly when not configured, without calling out', async () => {
    const fetchMock = mockFetch(200, '{}');
    await expect(
      provider('').sendOtp('+919876543210', '123456'),
    ).rejects.toThrow(/not configured/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('never puts the API key, number or code in the error it throws', async () => {
    global.fetch = jest
      .fn()
      .mockRejectedValue(
        new Error('connect failed https://x/V1.php?API=SECRETKEY&OTP=123456'),
      ) as unknown as typeof fetch;
    const err = await provider()
      .sendOtp('+919876543210', '123456')
      .catch((e: Error) => e);
    const msg = (err as Error).message;
    expect(msg).toBe('WhatsApp delivery failed');
    expect(msg).not.toMatch(/SECRETKEY|123456|9876543210/);
  });
});

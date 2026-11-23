import { ConfigService } from '@nestjs/config';
import { Msg91SmsProvider } from './msg91-sms.provider';

function provider(authKey = 'KEY', templateId = 'TPL') {
  const config = {
    get: () => ({
      msg91: { authKey, templateId, baseUrl: 'https://msg91.test/' },
    }),
  } as unknown as ConfigService<any, true>;
  return new Msg91SmsProvider(config);
}

describe('Msg91SmsProvider', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  it('posts template, number (no "+") and our code, with the auth key header', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ type: 'success' }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;
    await provider().sendOtp('+919876543210', '123456');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe('https://msg91.test/api/v5/otp');
    expect(u.searchParams.get('template_id')).toBe('TPL');
    expect(u.searchParams.get('mobile')).toBe('919876543210');
    expect(u.searchParams.get('otp')).toBe('123456');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).authkey).toBe('KEY');
  });

  it('treats HTTP 200 with type=error as a failure', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ type: 'error' }),
    }) as unknown as typeof fetch;
    await expect(provider().sendOtp('+919876543210', '123456')).rejects.toThrow(
      'SMS delivery failed',
    );
  });

  it('treats a non-2xx response as a failure', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: () => Promise.resolve({}),
    }) as unknown as typeof fetch;
    await expect(provider().sendOtp('+919876543210', '123456')).rejects.toThrow(
      'SMS delivery failed',
    );
  });

  it('fails clearly when not configured, without calling out', async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    await expect(
      provider('', '').sendOtp('+919876543210', '123456'),
    ).rejects.toThrow(/not configured/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

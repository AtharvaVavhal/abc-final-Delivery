import { ConfigService } from '@nestjs/config';
import { Msg91WhatsAppProvider } from './msg91-whatsapp.provider';

function provider(over: Record<string, unknown> = {}) {
  const config = {
    get: () => ({
      msg91: {
        authKey: 'KEY',
        baseUrl: 'https://msg91.test/',
        whatsapp: {
          integratedNumber: '919999999999',
          templateName: 'login_otp',
          templateNamespace: 'ns-123',
          languageCode: 'en',
          includeButton: true,
          ...over,
        },
      },
    }),
  } as unknown as ConfigService<any, true>;
  return new Msg91WhatsAppProvider(config);
}

function mockFetch(res: { ok: boolean; status: number; body?: unknown }) {
  const fn = jest.fn().mockResolvedValue({
    ok: res.ok,
    status: res.status,
    json: () => Promise.resolve(res.body ?? {}),
  });
  global.fetch = fn as unknown as typeof fetch;
  return fn;
}

describe('Msg91WhatsAppProvider', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  it('posts the documented template payload with the authkey header', async () => {
    const fetchMock = mockFetch({
      ok: true,
      status: 200,
      body: { status: 'success' },
    });
    await provider().sendOtp('+919876543210', '123456');

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      'https://msg91.test/api/v5/whatsapp/whatsapp-outbound-message/bulk/',
    );
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).authkey).toBe('KEY');
    expect(JSON.parse(init.body as string)).toEqual({
      integrated_number: '919999999999',
      content_type: 'template',
      payload: {
        messaging_product: 'whatsapp',
        type: 'template',
        template: {
          name: 'login_otp',
          language: { code: 'en', policy: 'deterministic' },
          namespace: 'ns-123',
          to_and_components: [
            {
              to: ['919876543210'],
              components: {
                body_1: { type: 'text', value: '123456' },
                button_1: { subtype: 'url', type: 'text', value: '123456' },
              },
            },
          ],
        },
      },
    });
  });

  it('omits the copy-code button when the template has none', async () => {
    const fetchMock = mockFetch({ ok: true, status: 200 });
    await provider({ includeButton: false }).sendOtp('+919876543210', '123456');
    const body = JSON.parse(
      (fetchMock.mock.calls[0][1] as RequestInit).body as string,
    );
    const comps = body.payload.template.to_and_components[0].components;
    expect(comps.body_1.value).toBe('123456');
    expect(comps.button_1).toBeUndefined();
  });

  it.each([
    ['non-2xx', { ok: false, status: 401, body: {} }],
    ['type=error', { ok: true, status: 200, body: { type: 'error' } }],
    ['status=fail', { ok: true, status: 200, body: { status: 'fail' } }],
  ])('treats %s as a failure', async (_n, res) => {
    mockFetch(res);
    await expect(provider().sendOtp('+919876543210', '123456')).rejects.toThrow(
      'WhatsApp delivery failed',
    );
  });

  it('fails clearly when not configured, without calling out', async () => {
    const fetchMock = mockFetch({ ok: true, status: 200 });
    await expect(
      provider({ integratedNumber: '' }).sendOtp('+919876543210', '123456'),
    ).rejects.toThrow(/not configured/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

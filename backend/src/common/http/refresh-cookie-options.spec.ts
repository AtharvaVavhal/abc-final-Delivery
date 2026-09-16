import {
  cookieSiteKey,
  originsAreSameSite,
  refreshCookieBaseOptions,
} from './refresh-cookie-options';

describe('cookieSiteKey', () => {
  it('treats localhost as one site regardless of subdomain form', () => {
    expect(cookieSiteKey('localhost')).toBe('localhost');
    expect(cookieSiteKey('foo.localhost')).toBe('localhost');
  });

  it('keeps vercel.app project hosts distinct (public suffix)', () => {
    expect(cookieSiteKey('abc-woad-six.vercel.app')).toBe(
      'abc-woad-six.vercel.app',
    );
    expect(cookieSiteKey('other.vercel.app')).toBe('other.vercel.app');
  });

  it('groups api.example.com with www.example.com', () => {
    expect(cookieSiteKey('api.example.com')).toBe('example.com');
    expect(cookieSiteKey('www.example.com')).toBe('example.com');
  });
});

describe('originsAreSameSite', () => {
  it('is true for localhost Vite talking to localhost API', () => {
    expect(
      originsAreSameSite('http://localhost:5173', 'http://localhost:4000'),
    ).toBe(true);
  });

  it('is false for a Vercel storefront calling a Render API', () => {
    expect(
      originsAreSameSite(
        'https://abc-woad-six.vercel.app',
        'https://abcweb.onrender.com',
      ),
    ).toBe(false);
  });
});

describe('refreshCookieBaseOptions', () => {
  it('keeps SameSite=Strict and allows non-Secure cookies on local HTTP', () => {
    expect(
      refreshCookieBaseOptions(
        'http://localhost:5173',
        'http://localhost:4000',
      ),
    ).toEqual({
      httpOnly: true,
      path: '/api/v1/auth/refresh',
      sameSite: 'strict',
      secure: false,
    });
  });

  it('uses SameSite=None; Secure when the SPA and API are different sites', () => {
    expect(
      refreshCookieBaseOptions(
        'https://abc-woad-six.vercel.app',
        'https://abcweb.onrender.com',
      ),
    ).toEqual({
      httpOnly: true,
      path: '/api/v1/auth/refresh',
      sameSite: 'none',
      secure: true,
    });
  });

  it('keeps SameSite=Strict; Secure on a shared custom domain', () => {
    expect(
      refreshCookieBaseOptions(
        'https://www.printforge.in',
        'https://api.printforge.in',
      ),
    ).toEqual({
      httpOnly: true,
      path: '/api/v1/auth/refresh',
      sameSite: 'strict',
      secure: true,
    });
  });
});

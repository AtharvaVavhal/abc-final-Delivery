import {
  corsAllowedOrigins,
  normalizePublicOrigin,
} from './cors-origins';

describe('corsAllowedOrigins', () => {
  it('includes FRONTEND_URL and local Vite origins, without a trailing slash', () => {
    const origins = corsAllowedOrigins('https://abc-woad-six.vercel.app/');
    expect(origins).toContain('https://abc-woad-six.vercel.app');
    expect(origins).not.toContain('https://abc-woad-six.vercel.app/');
    expect(origins).toContain('http://localhost:5173');
    expect(origins).toContain('http://127.0.0.1:5173');
  });

  it('does not duplicate when FRONTEND_URL is already local Vite', () => {
    const origins = corsAllowedOrigins('http://localhost:5173');
    expect(origins.filter((o) => o === 'http://localhost:5173')).toHaveLength(1);
  });
});

describe('normalizePublicOrigin', () => {
  it('strips trailing slashes', () => {
    expect(normalizePublicOrigin(' https://example.com/ ')).toBe(
      'https://example.com',
    );
  });
});

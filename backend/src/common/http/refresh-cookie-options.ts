import { REFRESH_TOKEN_COOKIE_PATH } from '../constants/app.constants';
import { normalizePublicOrigin } from './cors-origins';

/**
 * Hosting platforms that put each project on a *public suffix* (so
 * a.vercel.app and b.vercel.app are different sites). Treat the full
 * hostname as the cookie site, not the last two labels.
 */
const MULTI_TENANT_PUBLIC_SUFFIXES = [
  'vercel.app',
  'onrender.com',
  'netlify.app',
  'github.io',
  'pages.dev',
] as const;

export type RefreshCookieBaseOptions = {
  httpOnly: true;
  secure: boolean;
  sameSite: 'strict' | 'none';
  path: string;
  /** CHIPS — required for Chrome to send a cross-site refresh cookie. */
  partitioned?: true;
};

export function cookieSiteKey(hostname: string): string {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  if (host === 'localhost' || host.endsWith('.localhost')) {
    return 'localhost';
  }
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
    return host;
  }
  for (const suffix of MULTI_TENANT_PUBLIC_SUFFIXES) {
    if (host === suffix || host.endsWith(`.${suffix}`)) {
      return host;
    }
  }
  const parts = host.split('.');
  if (parts.length <= 2) {
    return host;
  }
  return parts.slice(-2).join('.');
}

export function originsAreSameSite(a: string, b: string): boolean {
  try {
    const left = new URL(normalizePublicOrigin(a));
    const right = new URL(normalizePublicOrigin(b));
    return cookieSiteKey(left.hostname) === cookieSiteKey(right.hostname);
  } catch {
    return false;
  }
}

/**
 * SPA + API on different registrable sites (e.g. *.vercel.app calling
 * *.onrender.com, or local Vite calling a hosted API) is a cross-site
 * fetch. SameSite=Strict cookies are stored but never sent on that
 * POST /auth/refresh, so a reload looks like logout. SameSite=None;
 * Secure; Partitioned is required for Chrome to attach the refresh
 * cookie as a third-party CHIPS cookie. Same-site deployments keep
 * Strict.
 */
export function refreshCookieBaseOptions(
  frontendUrl: string,
  backendUrl: string,
): RefreshCookieBaseOptions {
  const sameSite = originsAreSameSite(frontendUrl, backendUrl);
  const https =
    frontendUrl.startsWith('https:') || backendUrl.startsWith('https:');
  const crossSite = !sameSite;
  return {
    httpOnly: true,
    path: REFRESH_TOKEN_COOKIE_PATH,
    sameSite: crossSite ? 'none' : 'strict',
    secure: crossSite || https,
    ...(crossSite ? { partitioned: true as const } : {}),
  };
}

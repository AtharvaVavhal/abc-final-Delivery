/**
 * Credentialed CORS allowlist. Never a wildcard — the browser Origin must
 * match one of these strings exactly.
 */
export function normalizePublicOrigin(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

/** Local Vite dev (5173) and preview (4173) — allowed in addition to FRONTEND_URL. */
export const LOCAL_VITE_CORS_ORIGINS = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:4173',
  'http://127.0.0.1:4173',
] as const;

/**
 * Production storefront hosts. The API (`https://api.abcmanufactures.com`)
 * is the CORS *server*, not a browser Origin — do not list it here.
 * Apex is included because some clients send that Origin before the 308
 * to www completes (bookmarks, first hit).
 */
export const PRODUCTION_STOREFRONT_ORIGINS = [
  'https://www.abcmanufactures.com',
  'https://abcmanufactures.com',
] as const;

export function corsAllowedOrigins(frontendUrl: string): string[] {
  const primary = normalizePublicOrigin(frontendUrl);
  return [
    ...new Set(
      [
        primary,
        ...PRODUCTION_STOREFRONT_ORIGINS,
        ...LOCAL_VITE_CORS_ORIGINS,
      ].filter(Boolean),
    ),
  ];
}

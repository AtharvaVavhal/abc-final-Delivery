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

export function corsAllowedOrigins(frontendUrl: string): string[] {
  const primary = normalizePublicOrigin(frontendUrl);
  return [...new Set([primary, ...LOCAL_VITE_CORS_ORIGINS].filter(Boolean))];
}

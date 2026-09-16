import type { CategoryTreeNode } from '@/types/catalog'
import type { StorefrontPublicSettings } from '@/services/api/settings'
import snapshot from './storefront-shell.json' with { type: 'json' }

/**
 * Build-time public storefront snapshot.
 *
 * Source of truth: Store Admin → backend → PostgreSQL.
 * This module is a generated copy used so the first homepage paint does
 * not wait on Postgres. Runtime queries still hit GET /settings and
 * GET /categories/tree and overwrite this data when it is stale.
 *
 * Regeneration: `npm run snapshot:storefront` then redeploy the frontend.
 * Tests (`import.meta.env.VITEST`) return null so unit tests keep driving
 * the live API mocks instead of production content.
 *
 * `deploymentKey` identifies this frontend deployment (AB Creations). It is
 * not a tenant UUID and must never be sent as a tenant selector.
 */
export interface StorefrontLcpImage {
  sourceUrl: string
  href: string
  type: string
  sizes: string
  srcsetAvif: string
  srcsetWebp: string
  srcsetJpg: string
  fallback: string
}

export interface StorefrontShellSnapshot {
  generatedAt: string
  source: {
    origin: string
    settingsPath: string
    categoriesPath: string
  }
  deploymentKey: string
  lcp?: StorefrontLcpImage | null
  settings: StorefrontPublicSettings
  categories: CategoryTreeNode[]
}

/** Snapshot timestamp in ms — computed once at module load, not during render. */
export const STOREFRONT_SHELL_GENERATED_AT_MS = Date.parse(snapshot.generatedAt)

export function getStorefrontShell(): StorefrontShellSnapshot | null {
  if (import.meta.env.VITEST) {
    return null
  }
  return snapshot
}

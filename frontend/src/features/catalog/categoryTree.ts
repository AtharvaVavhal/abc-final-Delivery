import type { CategoryTreeNode } from '@/types/catalog'

/**
 * The chain of categories from a root down to `categoryId`, inclusive.
 * Empty when `categoryId` is absent or not found in the tree. Shared by
 * the filter sidebar and the listing-page breadcrumb / active-filter chips
 * so they always agree on the category hierarchy.
 */
export function findCategoryPath(
  nodes: CategoryTreeNode[],
  categoryId?: string,
  path: CategoryTreeNode[] = [],
): CategoryTreeNode[] {
  if (!categoryId) return []

  for (const node of nodes) {
    const nextPath = [...path, node]
    if (node.id === categoryId) return nextPath

    const childPath = findCategoryPath(node.children, categoryId, nextPath)
    if (childPath.length > 0) return childPath
  }

  return []
}

/**
 * Finds the category node whose slug matches `slug` (e.g. the "t-shirts"
 * in `?category=t-shirts` links from CategoryStoryBar/Header/marketing
 * cards). Returns undefined for a marketing sub-filter keyword ("3d",
 * "navy", ...) that isn't a real category slug — callers fall back to a
 * text-search approximation in that case.
 */
export function findCategoryBySlug(
  nodes: CategoryTreeNode[],
  slug?: string,
): CategoryTreeNode | undefined {
  if (!slug) return undefined

  for (const node of nodes) {
    if (node.slug === slug) return node

    const match = findCategoryBySlug(node.children, slug)
    if (match) return match
  }

  return undefined
}

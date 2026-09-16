import { useQuery } from '@tanstack/react-query'
import { fetchCategoryTree } from '@/services/api/catalog'
import { STOREFRONT_PUBLIC_QUERY } from '@/constants/query'
import type { CategoryTreeNode } from '@/types/catalog'
import { getStorefrontShell } from '@/generated/storefront-shell'

export function useCategoryTree(options?: { enabled?: boolean }) {
  const snapshot = getStorefrontShell()
  return useQuery<CategoryTreeNode[]>({
    queryKey: ['categories', 'tree'],
    queryFn: fetchCategoryTree,
    ...STOREFRONT_PUBLIC_QUERY,
    initialData: snapshot?.categories,
    initialDataUpdatedAt: snapshot ? Date.now() : undefined,
    enabled: options?.enabled,
  })
}

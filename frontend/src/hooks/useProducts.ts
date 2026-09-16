import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { fetchProducts } from '@/services/api/catalog'
import type { ListProductsParams } from '@/types/catalog'
import { STOREFRONT_PUBLIC_QUERY } from '@/constants/query'

export function useProducts(
  params: ListProductsParams = {},
  options?: { enabled?: boolean },
) {
  return useQuery({
    queryKey: ['products', 'list', params],
    queryFn: () => fetchProducts(params),
    ...STOREFRONT_PUBLIC_QUERY,
    enabled: options?.enabled,
    // Keeps the current grid visible (no loading flash) while a new
    // page/filter's data loads in the background.
    placeholderData: keepPreviousData,
  })
}

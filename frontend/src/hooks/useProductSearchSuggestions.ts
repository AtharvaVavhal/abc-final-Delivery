import { useEffect, useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { fetchProducts } from '@/services/api/catalog'

export const SEARCH_SUGGESTION_LIMIT = 6
export const SEARCH_SUGGESTION_DEBOUNCE_MS = 250

function useDebouncedValue<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(timer)
  }, [value, delay])
  return debounced
}

/** Typeahead for the header search box. Hits public GET /products?search= */
export function useProductSearchSuggestions(query: string) {
  const trimmed = query.trim().slice(0, 100)
  const debouncedQuery = useDebouncedValue(trimmed, SEARCH_SUGGESTION_DEBOUNCE_MS)
  const enabled = debouncedQuery.length >= 1

  const result = useQuery({
    queryKey: ['products', 'search-suggest', debouncedQuery],
    queryFn: () =>
      fetchProducts({
        search: debouncedQuery,
        limit: SEARCH_SUGGESTION_LIMIT,
        sort: 'newest',
      }),
    enabled,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    placeholderData: keepPreviousData,
  })

  return { ...result, debouncedQuery, liveQuery: trimmed }
}

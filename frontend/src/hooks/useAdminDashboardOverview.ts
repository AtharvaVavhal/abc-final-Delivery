import { useQuery } from '@tanstack/react-query'
import { fetchAdminDashboardOverview } from '@/services/api/admin'

export const ADMIN_DASHBOARD_OVERVIEW_QUERY_KEY = ['admin', 'dashboard', 'overview'] as const

export function useAdminDashboardOverview(days: number) {
  return useQuery({
    queryKey: [...ADMIN_DASHBOARD_OVERVIEW_QUERY_KEY, days],
    queryFn: () => fetchAdminDashboardOverview(days),
    // Trends move slowly; avoid refetching on every focus.
    staleTime: 60_000,
    retry: false,
  })
}

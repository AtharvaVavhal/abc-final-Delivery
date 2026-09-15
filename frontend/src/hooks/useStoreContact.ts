import { useQuery } from '@tanstack/react-query'
import { fetchStoreContact, type StoreContact } from '@/services/api/settings'
import { CATALOG_STALE_TIME_MS } from '@/constants/query'

const EMPTY: StoreContact = { email: '', phone: '', address: '' }

export function useStoreContact(): StoreContact {
  const { data } = useQuery({
    queryKey: ['settings', 'storeContact'],
    queryFn: fetchStoreContact,
    staleTime: CATALOG_STALE_TIME_MS,
  })
  return data ?? EMPTY
}

import { useQuery } from '@tanstack/react-query'
import { fetchWhatsappNumber } from '@/services/api/settings'
import { CATALOG_STALE_TIME_MS } from '@/constants/query'

/** Public WhatsApp click-to-chat number. Empty/unavailable → hide the button. */
export function useWhatsappNumber(): string {
  const { data } = useQuery({
    queryKey: ['settings', 'whatsappNumber'],
    queryFn: fetchWhatsappNumber,
    staleTime: CATALOG_STALE_TIME_MS,
  })
  return data?.replace(/[^0-9]/g, '') ?? ''
}

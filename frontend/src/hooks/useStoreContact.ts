import type { StoreContact } from '@/services/api/settings'
import { useStorefrontPublicSettings } from './useStorefrontPublicSettings'

const EMPTY: StoreContact = { email: '', phone: '', address: '' }

export function useStoreContact(): StoreContact {
  const { data } = useStorefrontPublicSettings()
  return data?.contact ?? EMPTY
}

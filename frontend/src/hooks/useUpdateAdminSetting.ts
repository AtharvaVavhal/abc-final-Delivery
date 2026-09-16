import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  updateAdminSetting,
  type AdminSettingView,
  type StorefrontPublicSettings,
} from '@/services/api/settings'
import { getStorefrontShell } from '@/generated/storefront-shell'
import { STOREFRONT_PUBLIC_SETTINGS_QUERY_KEY } from './useStorefrontPublicSettings'
import { applyAdminSettingToStorefront } from './applyAdminSettingToStorefront'

export function useUpdateAdminSetting() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ key, value }: { key: string; value: string }) =>
      updateAdminSetting(key, value),
    onSuccess: (updated: AdminSettingView) => {
      queryClient.setQueryData(
        ['admin', 'settings'],
        (list: AdminSettingView[] | undefined) =>
          list?.map((setting) =>
            setting.key === updated.key ? { ...setting, value: updated.value } : setting,
          ),
      )
      queryClient.setQueryData(
        STOREFRONT_PUBLIC_SETTINGS_QUERY_KEY,
        (current: StorefrontPublicSettings | undefined) =>
          applyAdminSettingToStorefront(current ?? getStorefrontShell()?.settings, updated),
      )
      void queryClient.invalidateQueries({ queryKey: ['admin', 'settings'] })
      void queryClient.invalidateQueries({ queryKey: STOREFRONT_PUBLIC_SETTINGS_QUERY_KEY })
      void queryClient.invalidateQueries({ queryKey: ['homepage'] })
    },
  })
}

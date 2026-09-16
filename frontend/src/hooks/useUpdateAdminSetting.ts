import { useMutation, useQueryClient } from '@tanstack/react-query'
import { updateAdminSetting } from '@/services/api/settings'

export function useUpdateAdminSetting() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ key, value }: { key: string; value: string }) =>
      updateAdminSetting(key, value),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'settings'] })
      // announcement_text is also read by the public storefront bar.
      void queryClient.invalidateQueries({ queryKey: ['homepage'] })
      // storeName / storeLogo are read by the storefront chrome.
      void queryClient.invalidateQueries({ queryKey: ['settings'] })
    },
  })
}

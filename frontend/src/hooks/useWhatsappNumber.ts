import { useStorefrontPublicSettings } from './useStorefrontPublicSettings'

/** Public WhatsApp click-to-chat number. Empty/unavailable → hide the button. */
export function useWhatsappNumber(): string {
  const { data } = useStorefrontPublicSettings()
  return data?.whatsappNumber?.replace(/[^0-9]/g, '') ?? ''
}

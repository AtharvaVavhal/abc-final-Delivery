import { useStorefrontPublicSettings } from '@/hooks/useStorefrontPublicSettings'
import {
  SELLER_GSTIN_DEFAULT,
  SELLER_LEGAL_NAME_DEFAULT,
  SELLER_LOCALITY_DEFAULT,
  SELLER_PAYMENT_PROTECTED_DEFAULT,
} from '@/constants/sellerIdentity'
import { SellerIdentityStrip } from './SellerIdentityStrip'

export function HeaderTrustBar() {
  const { data } = useStorefrontPublicSettings()
  const seller = data?.seller

  return (
    <SellerIdentityStrip
      legalName={seller?.legalName ?? SELLER_LEGAL_NAME_DEFAULT}
      locality={seller?.locality ?? SELLER_LOCALITY_DEFAULT}
      gstin={seller?.gstin ?? SELLER_GSTIN_DEFAULT}
      paymentProtected={seller?.paymentProtected ?? SELLER_PAYMENT_PROTECTED_DEFAULT}
    />
  )
}

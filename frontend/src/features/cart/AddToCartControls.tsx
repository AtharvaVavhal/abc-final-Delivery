import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import axios from 'axios'
import { useAuth } from '@/hooks/useAuth'
import { useAddCartItem } from '@/hooks/useAddCartItem'
import { useToast } from '@/components/ui/toast/useToast'
import { getApiErrorMessage } from '@/utils/apiError'
import { ROUTES } from '@/constants/routes'
import {
  consumePendingCartAdd,
  savePendingCartAdd,
} from '@/utils/pendingCartAdd'
import { Button } from '@/components/ui/Button'
import { Alert } from '@/components/ui/Alert'
import { QuantityInput } from '@/components/ui/QuantityInput'
import type { Product } from '@/types/catalog'
import type { CustomizationFormState } from '@/features/customization/CustomizationForm'
import styles from './AddToCartControls.module.css'

interface AddToCartControlsProps {
  product: Product
  selectedVariantId: string | null
  customization: CustomizationFormState
}

/**
 * §10: login is required starting at "Add to Cart," not before — this page
 * is public, so status is checked here, at the moment of the click, not
 * via a route guard. An unauthenticated click never calls the API.
 *
 * UX-03: an unauthenticated click also stashes the configured selection
 * (variant + customization + quantity) in sessionStorage keyed by slug and
 * redirects to /login with `state: {from: location}`. After login the
 * customer lands back here; the effect below consumes the pending add and
 * completes it, confirming via a toast with a "View cart" action (UX-01/02)
 * — no need to re-configure anything.
 *
 * A 401 surfacing from the mutation itself (session expired between render
 * and click, and the interceptor's refresh also failed) gets the same
 * login redirect as a fallback.
 *
 * Price shown elsewhere on this page is a preview only — the actual
 * unitPrice/lineTotal this add produces is whatever GET /cart (or this
 * mutation's own response) returns, never computed here.
 */
export function AddToCartControls({
  product,
  selectedVariantId,
  customization,
}: AddToCartControlsProps) {
  const { status } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const { showToast } = useToast()
  const [quantity, setQuantity] = useState(product.minQuantity)
  const { mutate, isPending, error, reset } = useAddCartItem()
  const resumeAttempted = useRef(false)

  const variantRequired = product.variants.length > 0
  const variantMissing = variantRequired && !selectedVariantId
  // Picking an option is explained when someone tries to add without one, not
  // from the moment the page loads (which read as an error nobody had caused).
  // So a missing option no longer greys the button out; it answers the click.
  const [triedWithoutOption, setTriedWithoutOption] = useState(false)
  const disabled = !customization.isValid || isPending

  const goToLogin = useCallback(() => {
    void navigate(ROUTES.LOGIN, { state: { from: location } })
  }, [navigate, location])

  const notifyAdded = useCallback(() => {
    showToast({
      message: 'Added to cart',
      variant: 'success',
      action: { label: 'View cart', to: ROUTES.CART },
    })
  }, [showToast])

  // UX-03 resume: complete a pending add stashed before a login redirect.
  useEffect(() => {
    if (resumeAttempted.current) return
    if (status !== 'authenticated') return
    const pending = consumePendingCartAdd(product.slug)
    if (!pending) return
    resumeAttempted.current = true
    mutate(
      {
        productId: pending.productId,
        variantId: pending.variantId,
        quantity: pending.quantity,
        customizations: pending.customizations,
      },
      {
        onSuccess: notifyAdded,
        onError: (err) => {
          if (axios.isAxiosError(err) && err.response?.status === 401) {
            goToLogin()
            return
          }
          showToast({ message: getApiErrorMessage(err), variant: 'error' })
        },
      },
    )
  }, [status, product.slug, mutate, notifyAdded, showToast, goToLogin])

  function handleAddToCart() {
    reset()

    if (variantMissing) {
      setTriedWithoutOption(true)
      return
    }

    if (status !== 'authenticated') {
      if (!disabled) {
        savePendingCartAdd({
          productId: product.id,
          slug: product.slug,
          variantId: selectedVariantId ?? undefined,
          quantity,
          customizations: customization.values,
        })
      }
      goToLogin()
      return
    }
    if (disabled) {
      return
    }

    mutate(
      {
        productId: product.id,
        variantId: selectedVariantId ?? undefined,
        quantity,
        customizations: customization.values,
      },
      {
        onSuccess: notifyAdded,
        onError: (err) => {
          if (axios.isAxiosError(err) && err.response?.status === 401) {
            goToLogin()
          }
        },
      },
    )
  }

  return (
    <div className={styles.controls}>
      <QuantityInput
        value={quantity}
        onChange={setQuantity}
        min={product.minQuantity}
        max={product.maxQuantity ?? undefined}
      />

      <Button onClick={handleAddToCart} isLoading={isPending} disabled={disabled}>
        Add to cart
      </Button>

      {variantMissing && triedWithoutOption && (
        <Alert variant="error">Please select an option above.</Alert>
      )}
      {error && <Alert variant="error">{getApiErrorMessage(error)}</Alert>}
    </div>
  )
}

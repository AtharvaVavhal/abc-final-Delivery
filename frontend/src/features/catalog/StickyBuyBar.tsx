import { useEffect, useState, type RefObject } from 'react'
import { formatPrice } from '@/utils/formatPrice'
import { Button } from '@/components/ui/Button'
import styles from './StickyBuyBar.module.css'

/** Mobile-only bar pinned to the bottom of the product page. It appears only
 * once the real add-to-cart controls have scrolled out of view, and its
 * button scrolls back to them — it deliberately does not add to the cart
 * itself, so variant/customization validation and the login redirect stay in
 * AddToCartControls. CSS hides it on wider screens (breakpoints live in CSS
 * only — see tokens.css). */
export function StickyBuyBar({
  targetRef,
  price,
  disabled = false,
}: {
  targetRef: RefObject<HTMLElement | null>
  price: number
  disabled?: boolean
}) {
  const [controlsVisible, setControlsVisible] = useState(true)

  useEffect(() => {
    const el = targetRef.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(([entry]) => {
      setControlsVisible(entry.isIntersecting)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [targetRef])

  if (controlsVisible) return null

  return (
    <div className={styles.bar}>
      <span className={styles.price}>{formatPrice(price)}</span>
      <Button
        disabled={disabled}
        onClick={() =>
          targetRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
        }
      >
        Add to cart
      </Button>
    </div>
  )
}

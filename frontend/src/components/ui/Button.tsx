import type { ButtonHTMLAttributes } from 'react'
import { Loader2 } from 'lucide-react'
import { cn } from '@/utils/cn'
import styles from './Button.module.css'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost'
  shape?: 'default' | 'pill'
  size?: 'md' | 'lg'
  isLoading?: boolean
}

/**
 * `isLoading` keeps the button's own label visible and adds a spinner
 * beside it (UX-38) — the label stays meaningful ("Add to cart" still
 * reads as "Add to cart"), the width doesn't jump, and `aria-busy` +
 * `disabled` still block a second submission.
 */
export function Button({
  variant = 'primary',
  shape = 'default',
  size = 'md',
  isLoading = false,
  disabled,
  className,
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      type="button"
      className={cn(
        styles.button,
        styles[variant],
        shape === 'pill' && styles.pill,
        size === 'lg' && styles.lg,
        isLoading && styles.loading,
        className,
      )}
      disabled={disabled || isLoading}
      aria-busy={isLoading || undefined}
      {...rest}
    >
      {isLoading && <Loader2 size={16} aria-hidden="true" className={styles.spinner} />}
      <span className={styles.label}>{children}</span>
    </button>
  )
}

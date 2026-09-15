import { useEffect, useId, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Search } from 'lucide-react'
import { ROUTES } from '@/constants/routes'
import {
  EMPTY_HEADER_SEARCH_VALUES,
  headerSearchSchema,
  type HeaderSearchFormValues,
} from '@/schemas/search.schema'
import styles from './Header.module.css'

/**
 * The product search box. Rendered twice — once in the header search panel
 * (opened from the search icon) and once inside the mobile navigation
 * drawer — so search is reachable at every breakpoint. Each instance owns
 * its own form state; a submit navigates to the listing page with `?search=`
 * and calls `onSubmitted`.
 */
export function HeaderSearch({
  variant,
  onSubmitted,
  active = false,
}: {
  variant: 'bar' | 'drawer'
  onSubmitted?: () => void
  active?: boolean
}) {
  const navigate = useNavigate()
  const inputId = useId()
  const inputRef = useRef<HTMLInputElement | null>(null)
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<HeaderSearchFormValues>({
    resolver: zodResolver(headerSearchSchema),
    defaultValues: EMPTY_HEADER_SEARCH_VALUES,
  })
  const { ref: registerRef, ...queryField } = register('query')

  useEffect(() => {
    if (variant === 'bar' && active) inputRef.current?.focus()
  }, [active, variant])

  function onValid(values: HeaderSearchFormValues) {
    reset(EMPTY_HEADER_SEARCH_VALUES)
    onSubmitted?.()
    void navigate(`${ROUTES.PRODUCTS}?search=${encodeURIComponent(values.query)}`)
  }

  return (
    <form
      className={variant === 'bar' ? styles.searchForm : styles.searchFormDrawer}
      role="search"
      onSubmit={(e) => void handleSubmit(onValid)(e)}
      noValidate
    >
      <label htmlFor={inputId} className="srOnly">
        Search products
      </label>
      <Search size={18} className={styles.searchIcon} aria-hidden="true" />
      <input
        id={inputId}
        type="search"
        placeholder="Search products…"
        className={styles.searchInput}
        aria-invalid={Boolean(errors.query)}
        {...queryField}
        ref={(element) => {
          registerRef(element)
          inputRef.current = element
        }}
      />
      <button type="submit" className={styles.searchSubmit} aria-label="Search">
        <Search size={18} aria-hidden="true" />
      </button>
      {errors.query && (
        <p className={styles.searchError} role="alert">
          {errors.query.message}
        </p>
      )}
    </form>
  )
}

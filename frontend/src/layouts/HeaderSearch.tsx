import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Search } from 'lucide-react'
import { productDetailPath, ROUTES } from '@/constants/routes'
import { useProductSearchSuggestions } from '@/hooks/useProductSearchSuggestions'
import {
  EMPTY_HEADER_SEARCH_VALUES,
  headerSearchSchema,
  type HeaderSearchFormValues,
} from '@/schemas/search.schema'
import { stillImageUrl, optimizedCloudinaryUrl } from '@/features/media/mediaAsset'
import { formatPrice } from '@/utils/formatPrice'
import { cn } from '@/utils/cn'
import type { Product } from '@/types/catalog'
import styles from './Header.module.css'

function SuggestionThumb({ product }: { product: Product }) {
  const [failed, setFailed] = useState(false)
  const url = stillImageUrl(product)
  if (!url || failed) {
    return <span className={styles.searchSuggestThumbFallback} aria-hidden="true" />
  }
  return (
    <img
      src={optimizedCloudinaryUrl(url, 80)}
      alt=""
      width={40}
      height={40}
      className={styles.searchSuggestThumb}
      onError={() => setFailed(true)}
    />
  )
}

/**
 * The product search box. Rendered twice — once in the header search panel
 * (opened from the search icon) and once inside the mobile navigation
 * drawer — so search is reachable at every breakpoint. Each instance owns
 * its own form state; typing shows matching products from GET /products.
 * Submit navigates to the listing page with `?search=` and calls
 * `onSubmitted`.
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
  const listId = useId()
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [dismissed, setDismissed] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  const {
    register,
    handleSubmit,
    reset,
    control,
    formState: { errors },
  } = useForm<HeaderSearchFormValues>({
    resolver: zodResolver(headerSearchSchema),
    defaultValues: EMPTY_HEADER_SEARCH_VALUES,
  })
  const { ref: registerRef, ...queryField } = register('query')
  const typedQuery = useWatch({ control, name: 'query' }) ?? ''
  const liveQuery = typedQuery.trim()
  const { data, isFetching, isFetched, isError, debouncedQuery } =
    useProductSearchSuggestions(liveQuery)

  const resultsReady = liveQuery.length >= 1 && debouncedQuery === liveQuery
  const products = resultsReady ? (data?.items ?? []) : []
  const showList = !dismissed && resultsReady
  const showSearching = showList && isFetching && products.length === 0 && !isError
  const showEmpty = showList && isFetched && !isFetching && products.length === 0 && !isError
  const optionCount = products.length > 0 ? products.length + 1 : 0
  const listOpen = showList && (showSearching || showEmpty || isError || products.length > 0)

  useEffect(() => {
    if (variant === 'bar' && active) inputRef.current?.focus()
  }, [active, variant])

  useEffect(() => {
    setDismissed(false)
    setActiveIndex(-1)
  }, [liveQuery])

  function closeAndReset() {
    reset(EMPTY_HEADER_SEARCH_VALUES)
    setDismissed(true)
    onSubmitted?.()
  }

  function onValid(values: HeaderSearchFormValues) {
    closeAndReset()
    void navigate(`${ROUTES.PRODUCTS}?search=${encodeURIComponent(values.query)}`)
  }

  function goToProduct(product: Product) {
    closeAndReset()
    void navigate(productDetailPath(product.slug))
  }

  function onQueryKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape' && listOpen) {
      event.preventDefault()
      event.stopPropagation()
      setDismissed(true)
      setActiveIndex(-1)
      return
    }
    if (!listOpen || optionCount === 0) return
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActiveIndex((current) => (current + 1) % optionCount)
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveIndex((current) => (current <= 0 ? optionCount - 1 : current - 1))
      return
    }
    if (event.key === 'Enter' && activeIndex >= 0 && activeIndex < products.length) {
      event.preventDefault()
      goToProduct(products[activeIndex])
    }
  }

  const activeOptionId =
    activeIndex >= 0 && activeIndex < products.length
      ? `${listId}-opt-${products[activeIndex].id}`
      : activeIndex === products.length && products.length > 0
        ? `${listId}-opt-all`
        : undefined

  return (
    <form
      className={variant === 'bar' ? styles.searchForm : styles.searchFormDrawer}
      role="search"
      onSubmit={(e) => void handleSubmit(onValid)(e)}
      noValidate
    >
      <div className={styles.searchField}>
        <label htmlFor={inputId} className="srOnly">
          Search products
        </label>
        <Search size={18} className={styles.searchIcon} aria-hidden="true" />
        <input
          id={inputId}
          type="search"
          placeholder="Search products…"
          className={styles.searchInput}
          autoComplete="off"
          aria-invalid={Boolean(errors.query)}
          aria-autocomplete="list"
          aria-expanded={listOpen}
          aria-controls={listOpen ? listId : undefined}
          aria-activedescendant={activeOptionId}
          {...queryField}
          onKeyDown={onQueryKeyDown}
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
      </div>

      {listOpen && (
        <div className={styles.searchSuggest}>
          {showSearching && (
            <p className={styles.searchSuggestStatus} role="status">
              Searching…
            </p>
          )}
          {isError && (
            <p className={styles.searchSuggestStatus} role="status">
              Couldn’t load suggestions. Press enter to search.
            </p>
          )}
          {showEmpty && (
            <p className={styles.searchSuggestStatus} role="status">
              No products match “{liveQuery}”
            </p>
          )}
          {products.length > 0 && (
            <ul className={styles.searchSuggestList} id={listId} role="listbox" aria-label="Suggested products">
              {products.map((product, index) => (
                <li key={product.id} role="presentation">
                  <Link
                    id={`${listId}-opt-${product.id}`}
                    role="option"
                    aria-selected={activeIndex === index}
                    className={cn(
                      styles.searchSuggestItem,
                      activeIndex === index && styles.searchSuggestItemActive,
                    )}
                    to={productDetailPath(product.slug)}
                    onClick={() => closeAndReset()}
                  >
                    <SuggestionThumb product={product} />
                    <span className={styles.searchSuggestName}>{product.name}</span>
                    <span className={styles.searchSuggestPrice}>{formatPrice(product.basePrice)}</span>
                  </Link>
                </li>
              ))}
              <li role="presentation">
                <Link
                  id={`${listId}-opt-all`}
                  role="option"
                  aria-selected={activeIndex === products.length}
                  className={cn(
                    styles.searchSuggestItem,
                    styles.searchSuggestAll,
                    activeIndex === products.length && styles.searchSuggestItemActive,
                  )}
                  to={`${ROUTES.PRODUCTS}?search=${encodeURIComponent(liveQuery)}`}
                  onClick={() => closeAndReset()}
                >
                  See all results for “{liveQuery}”
                </Link>
              </li>
            </ul>
          )}
        </div>
      )}
    </form>
  )
}

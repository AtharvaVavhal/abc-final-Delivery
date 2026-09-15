import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { TextField } from '@/components/ui/TextField'
import { Stars } from '@/components/ui/Stars'
import { useCategoryTree } from '@/hooks/useCategoryTree'
import { useDebouncedCallback } from '@/hooks/useDebouncedCallback'
import type { FilterState } from '@/types/catalog'
import { RATING_OPTIONS, SORT_OPTIONS } from '@/types/catalog'
import { findCategoryPath } from '@/features/catalog/categoryTree'
import { cn } from '@/utils/cn'
import styles from './FilterSidebar.module.css'

const PRICE_DEBOUNCE_MS = 400

interface FilterSidebarProps {
  activeCategoryId?: string
  hasActiveFilters: boolean
  onClearAll: () => void
  onFiltersChange?: () => void
  headingId?: string
  variant?: 'sidebar' | 'panel'
  onClose?: () => void
}

function toOptionalNumber(value: string | null): number | undefined {
  if (!value) return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

export function FilterSidebar({
  activeCategoryId,
  hasActiveFilters,
  onClearAll,
  onFiltersChange,
  headingId = 'filter-heading',
  variant = 'sidebar',
  onClose,
}: FilterSidebarProps) {
  const [searchParams, setSearchParams] = useSearchParams()
  const { data: categoryTree = [], isLoading: isCategoryTreeLoading } = useCategoryTree()

  const categoryPath = useMemo(
    () => findCategoryPath(categoryTree, activeCategoryId),
    [activeCategoryId, categoryTree],
  )
  const activeRootCategory = categoryPath[0]
  const subCategories = activeRootCategory?.children ?? []

  const currentFilters: FilterState = {
    minPrice: toOptionalNumber(searchParams.get('minPrice')),
    maxPrice: toOptionalNumber(searchParams.get('maxPrice')),
    minRating: toOptionalNumber(searchParams.get('minRating')),
    sort: (searchParams.get('sort') as FilterState['sort']) ?? 'newest',
  }

  function patchSearchParams(updates: Record<string, string | number | null | undefined>) {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)

      Object.entries(updates).forEach(([key, value]) => {
        if (value === undefined || value === null || value === '' || value === 'newest') {
          next.delete(key)
        } else {
          next.set(key, String(value))
        }
      })

      next.delete('page')
      return next
    })
    onFiltersChange?.()
  }

  function selectCategory(categoryId?: string) {
    patchSearchParams({ categoryId })
  }

  // Price inputs are typed into a local draft for instant feedback; the URL
  // (and therefore the product refetch + history entry) is only updated
  // once typing pauses, or immediately on blur (UX-10). The draft re-syncs
  // to the URL when it changes from elsewhere (Clear all, a removed chip) —
  // done as a render-time reconcile, the React-recommended alternative to a
  // sync effect.
  const urlMinPrice = searchParams.get('minPrice') ?? ''
  const urlMaxPrice = searchParams.get('maxPrice') ?? ''
  const [priceDraft, setPriceDraft] = useState({ min: urlMinPrice, max: urlMaxPrice })
  const [syncedUrl, setSyncedUrl] = useState({ min: urlMinPrice, max: urlMaxPrice })
  if (syncedUrl.min !== urlMinPrice || syncedUrl.max !== urlMaxPrice) {
    setSyncedUrl({ min: urlMinPrice, max: urlMaxPrice })
    setPriceDraft({ min: urlMinPrice, max: urlMaxPrice })
  }

  const [applyPrice, priceControls] = useDebouncedCallback(
    (min: string, max: string) => {
      const nextMin = min ? Number(min) : undefined
      const nextMax = max ? Number(max) : undefined
      const updates: Record<string, string | number | null | undefined> = {
        minPrice: nextMin,
        maxPrice: nextMax,
      }
      // Keep min <= max (unchanged behaviour, just applied once on commit).
      if (nextMin !== undefined && nextMax !== undefined && nextMin > nextMax) {
        updates.maxPrice = nextMin
      }
      patchSearchParams(updates)
    },
    PRICE_DEBOUNCE_MS,
  )

  function handlePriceDraftChange(field: 'min' | 'max', value: string) {
    const next = { ...priceDraft, [field]: value }
    setPriceDraft(next)
    applyPrice(next.min, next.max)
  }

  function handleRatingChange(rating: number) {
    patchSearchParams({
      minRating: currentFilters.minRating === rating ? undefined : rating,
    })
  }

  function clearAllFilters() {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      next.delete('categoryId')
      next.delete('minPrice')
      next.delete('maxPrice')
      next.delete('minRating')
      next.delete('sort')
      next.delete('page')
      return next
    })
    onClearAll()
    onFiltersChange?.()
  }

  return (
    <aside
      className={cn(styles.sidebar, variant === 'panel' && styles.panel)}
      aria-labelledby={headingId}
    >
      <div className={styles.header}>
        <h2 id={headingId} className={styles.title}>
          {variant === 'panel' ? 'Filter & Refine Options' : 'Filters'}
        </h2>
        <div className={styles.headerActions}>
          {hasActiveFilters && (
            <Button variant="ghost" onClick={clearAllFilters} className={styles.clearAll}>
              <X size={14} aria-hidden="true" />
              Clear all
            </Button>
          )}
          {variant === 'panel' && onClose && (
            <Button variant="secondary" onClick={onClose} className={styles.doneBtn}>
              Done
            </Button>
          )}
        </div>
      </div>

      <div className={styles.form}>
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>Category</legend>
          <div className={styles.categoryStack} role="group" aria-label="Filter by category">
            <button
              type="button"
              className={cn(styles.categoryButton, !activeCategoryId && styles.categoryButtonActive)}
              onClick={() => selectCategory()}
              aria-pressed={!activeCategoryId}
            >
              All products
            </button>
            {isCategoryTreeLoading && (
              <p className={styles.helperText} aria-live="polite">
                Loading categories...
              </p>
            )}
            {categoryTree.map((category) => (
              <button
                key={category.id}
                type="button"
                className={cn(
                  styles.categoryButton,
                  activeRootCategory?.id === category.id && styles.categoryButtonActive,
                )}
                onClick={() => selectCategory(category.id)}
                aria-pressed={activeRootCategory?.id === category.id}
              >
                {category.name}
              </button>
            ))}
          </div>
        </fieldset>

        {subCategories.length > 0 && (
          <fieldset className={styles.fieldset}>
            <legend className={styles.legend}>Sub-category</legend>
            <div className={styles.subCategoryPills} role="group" aria-label="Filter by sub-category">
              <button
                type="button"
                className={cn(
                  styles.subPill,
                  activeCategoryId === activeRootCategory?.id && styles.subPillActive,
                )}
                onClick={() => selectCategory(activeRootCategory?.id)}
                aria-pressed={activeCategoryId === activeRootCategory?.id}
              >
                All {activeRootCategory?.name}
              </button>
              {subCategories.map((category) => (
                <button
                  key={category.id}
                  type="button"
                  className={cn(
                    styles.subPill,
                    activeCategoryId === category.id && styles.subPillActive,
                  )}
                  onClick={() => selectCategory(category.id)}
                  aria-pressed={activeCategoryId === category.id}
                >
                  {category.name}
                </button>
              ))}
            </div>
          </fieldset>
        )}

        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>Price range</legend>
          <div className={styles.priceInputs}>
            <TextField
              label="Min price"
              type="number"
              name="minPrice"
              value={priceDraft.min}
              onChange={(event) => handlePriceDraftChange('min', event.target.value)}
              onBlur={() => priceControls.flush()}
              placeholder="0"
              min="0"
              step="1"
              inputMode="numeric"
            />
            <TextField
              label="Max price"
              type="number"
              name="maxPrice"
              value={priceDraft.max}
              onChange={(event) => handlePriceDraftChange('max', event.target.value)}
              onBlur={() => priceControls.flush()}
              placeholder="Any"
              min="0"
              step="1"
              inputMode="numeric"
            />
          </div>
        </fieldset>

        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>Minimum rating</legend>
          <div className={styles.ratingOptions} role="radiogroup" aria-label="Minimum rating filter">
            {RATING_OPTIONS.map((rating) => (
              <label
                key={rating}
                className={cn(
                  styles.ratingLabel,
                  currentFilters.minRating === rating && styles.ratingActive,
                )}
              >
                <input
                  type="radio"
                  name="minRating"
                  value={String(rating)}
                  checked={currentFilters.minRating === rating}
                  onChange={() => handleRatingChange(rating)}
                  className={styles.ratingInput}
                />
                <Stars value={rating} className={styles.ratingStars} />
                <span className={styles.ratingText}>{rating}+ stars</span>
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>Sort by</legend>
          <select
            value={currentFilters.sort}
            onChange={(event) => patchSearchParams({ sort: event.target.value })}
            className={styles.select}
            aria-label="Sort products"
          >
            {SORT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </fieldset>
      </div>
    </aside>
  )
}

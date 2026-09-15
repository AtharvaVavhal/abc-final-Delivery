import { useCallback, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ShieldCheck, Truck } from 'lucide-react'
import { useProduct } from '@/hooks/useProduct'
import { useCategoryTree } from '@/hooks/useCategoryTree'
import { getApiErrorMessage } from '@/utils/apiError'
import { formatPrice } from '@/utils/formatPrice'
import { ROUTES, productDetailPath } from '@/constants/routes'
import { ErrorState } from '@/components/ui/ErrorState'
import { Page } from '@/components/ui/Page'
import { Skeleton } from '@/components/ui/Skeleton'
import { Breadcrumbs, type Crumb } from '@/components/ui/Breadcrumbs'
import { ProductGallery } from '@/features/catalog/ProductGallery'
import { findCategoryPath } from '@/features/catalog/categoryTree'
import { Seo } from '@/seo/Seo'
import { productJsonLd, breadcrumbJsonLd, describeProduct } from '@/seo/jsonLd'
import { VariantSelector } from '@/features/cart/VariantSelector'
import { AddToCartControls } from '@/features/cart/AddToCartControls'
import {
  CustomizationForm,
  type CustomizationFormState,
} from '@/features/customization/CustomizationForm'
import { StarRating } from '@/features/reviews/StarRating'
import { ReviewList } from '@/features/reviews/ReviewList'
import styles from './ProductDetailPage.module.css'

const EMPTY_CUSTOMIZATION_STATE: CustomizationFormState = {
  values: [],
  surcharge: 0,
  isValid: true,
}

/** Renders the product's own data — variants, images, specifications —
 * plus the Phase 3 customization form and, since Phase 4, real variant
 * selection and the actual Add to Cart request (features/cart). The price
 * shown here (base + selected variant's priceDelta + customization
 * surcharge) is a client-side preview only — the authoritative
 * unitPrice/lineTotal for whatever ends up in the cart is always whatever
 * GET /cart (or the add-to-cart response) returns, never this number. */
export function ProductDetailPage() {
  const { slug } = useParams<{ slug: string }>()
  const { data: product, isPending, isError, error } = useProduct(slug)
  const { data: categoryTree = [] } = useCategoryTree()
  const [selectedVariantId, setSelectedVariantId] = useState<string | null>(null)
  const [customization, setCustomization] = useState<CustomizationFormState>(
    EMPTY_CUSTOMIZATION_STATE,
  )

  const handleCustomizationChange = useCallback((state: CustomizationFormState) => {
    setCustomization(state)
  }, [])

  const categoryPath = useMemo(
    () => findCategoryPath(categoryTree, product?.categoryId),
    [categoryTree, product?.categoryId],
  )

  if (isPending) {
    return (
      <section className={styles.wrap}>
        <Seo title="Loading product" noindex />
        <Skeleton className={styles.imageSkeleton} label="Loading product" />
        <div className={styles.infoSkeleton}>
          <Skeleton className={styles.titleSkeleton} />
          <Skeleton className={styles.priceSkeleton} />
        </div>
      </section>
    )
  }

  if (isError) {
    return (
      <Page>
        <Seo title="Product not found" noindex />
        <ErrorState
          title="Product unavailable"
          message={getApiErrorMessage(error)}
          action={
            <p className={styles.backLink}>
              <Link to={ROUTES.PRODUCTS}>← Back to shop</Link>
            </p>
          }
        />
      </Page>
    )
  }

  const selectedVariant = product.variants.find((v) => v.id === selectedVariantId)
  const total =
    Number(product.basePrice) + Number(selectedVariant?.priceDelta ?? 0) + customization.surcharge

  const breadcrumbs: Crumb[] = [
    { label: 'Home', to: ROUTES.HOME },
    { label: 'All products', to: ROUTES.PRODUCTS },
    ...categoryPath.map((node) => ({
      label: node.name,
      to: `${ROUTES.PRODUCTS}?categoryId=${node.id}`,
    })),
    { label: product.name },
  ]

  const canonicalPath = productDetailPath(product.slug)
  const primaryImage =
    product.images.find((img) => img.isPrimary)?.url ?? product.images[0]?.url

  return (
    <section className={styles.wrap}>
      <Seo
        title={product.name}
        description={
          describeProduct(product) ??
          `Order ${product.name} from PrintForge — custom-printed, made to order.`
        }
        canonicalPath={canonicalPath}
        ogType="product"
        ogImage={primaryImage}
        jsonLd={[
          productJsonLd(product, canonicalPath),
          ...(breadcrumbJsonLd(breadcrumbs) ? [breadcrumbJsonLd(breadcrumbs)!] : []),
        ]}
      />
      <div className={styles.breadcrumbs}>
        <Breadcrumbs items={breadcrumbs} />
      </div>

      <div className={styles.gallery}>
        <ProductGallery key={product.id} images={product.images} label={product.name} />
      </div>

      <div className={styles.info}>
        <h1>{product.name}</h1>
        <StarRating avgRating={product.avgRating} reviewCount={product.reviewCount} />
        <p className={styles.price}>{formatPrice(total)}</p>
        <p className={styles.quantityRange}>
          {product.maxQuantity
            ? `Order ${product.minQuantity}–${product.maxQuantity} at a time`
            : `Minimum order quantity: ${product.minQuantity}`}
        </p>

        {product.specifications && Object.keys(product.specifications).length > 0 && (
          <dl className={styles.specs}>
            {Object.entries(product.specifications).map(([key, value]) => (
              <div key={key} className={styles.specRow}>
                <dt>{key}</dt>
                <dd>{String(value)}</dd>
              </div>
            ))}
          </dl>
        )}

        {product.variants.length > 0 && (
          <VariantSelector
            variants={product.variants}
            selectedVariantId={selectedVariantId}
            onChange={setSelectedVariantId}
          />
        )}

        <CustomizationForm
          fields={product.customizationFields}
          onChange={handleCustomizationChange}
        />

        <AddToCartControls
          product={product}
          selectedVariantId={selectedVariantId}
          customization={customization}
        />

        <div className={styles.studioTrust} aria-label="Studio craft guarantees">
          <div className={styles.studioTrustItem}>
            <ShieldCheck size={16} className={styles.studioTrustIcon} aria-hidden="true" />
            <span>Artwork inspected by our studio printmakers before printing</span>
          </div>
          <div className={styles.studioTrustItem}>
            <Truck size={16} className={styles.studioTrustIcon} aria-hidden="true" />
            <span>Handcrafted & made to order (48–72h dispatch)</span>
          </div>
        </div>
      </div>

      <div className={styles.reviews}>
        <ReviewList productId={product.id} />
      </div>
    </section>
  )
}

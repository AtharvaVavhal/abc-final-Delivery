/**
 * Mirrors backend/src/products/products.service.ts's `ProductWithRelations`
 * (Product & {variants, images, customizationFields}) and the raw Prisma
 * `Category` model — read directly from prisma/schema.prisma and confirmed
 * live against the real running backend (GET /categories, GET /products,
 * GET /products/:slug all curled during this phase; see the completion
 * report for the exact payloads). Decimal fields (basePrice, priceDelta,
 * surchargeAmount) arrive as strings — Prisma.Decimal's toJSON() — never
 * numbers; Date fields arrive as ISO strings over the wire, same as
 * types/auth.ts's existing convention.
 *
 * NOTE: there is no `description` field on Product — only `name` and a
 * freeform `specifications: Json | null`. The list/detail pages render
 * `specifications` generically; do not invent a description field.
 */

export interface Category {
  id: string
  name: string
  slug: string
  parentCategoryId: string | null
  /** Public GET /categories and GET /categories/tree only ever return
   * active categories; GET /categories/admin returns both, so admin views
   * read this flag. */
  isActive: boolean
  createdAt: string
  updatedAt: string
}

export interface CategoryTreeNode {
  id: string
  name: string
  slug: string
  parentCategoryId: string | null
  children: CategoryTreeNode[]
  /** Active products on this node plus descendants. Omitted on stale snapshots. */
  productCount?: number
}

export type CustomizationFieldType =
  | 'TEXT'
  | 'LOGO_UPLOAD'
  | 'IMAGE_UPLOAD'
  | 'DESIGN_FILE_UPLOAD'
  | 'COLOR_SELECT'
  | 'INSTRUCTIONS'

export type SurchargeType = 'NONE' | 'FLAT' | 'PER_CHARACTER'

/**
 * Ships in GET /products and GET /products/:slug (not a separate endpoint)
 * — read now for Phase 3's dynamic customization form, not rendered as a
 * form here.
 */
export interface CustomizationField {
  id: string
  productId: string
  label: string
  type: CustomizationFieldType
  isRequired: boolean
  sortOrder: number
  helpText: string | null
  constraints: Record<string, unknown> | null
  surchargeType: SurchargeType
  surchargeAmount: string
  createdAt: string
  updatedAt: string
}

export interface ProductVariant {
  id: string
  productId: string
  label: string
  priceDelta: string
  isAvailable: boolean
  createdAt: string
  updatedAt: string
}

/**
 * Backend fix (fix/atharva/product-image-delivery): product images now
 * upload with Cloudinary's public 'upload' delivery type, and every read
 * path (GET /products, GET /products/:slug) computes and attaches a
 * working `url` — no more bare cloudinaryPublicId with nothing renderable.
 * `url` can still 404/expire in principle (bad data, deleted Cloudinary
 * asset) — always handle via <img onError>, see features/catalog/ProductImage.tsx.
 */
export interface ProductImage {
  id: string
  productId: string
  cloudinaryPublicId: string
  resourceType: string
  deliveryType: string
  url: string
  sortOrder: number
  isPrimary: boolean
  createdAt: string
}

export interface Product {
  id: string
  categoryId: string
  name: string
  slug: string
  basePrice: string
  minQuantity: number
  maxQuantity: number | null
  specifications: Record<string, unknown> | null
  isActive: boolean
  /** Denormalized rating aggregate (PHASE-10-PROPOSAL.md §1.1/R7),
   * recomputed server-side on every review write — never client-derived.
   * null (not "0.00") when reviewCount is 0, i.e. no PUBLISHED reviews
   * yet. Decimal-as-string, same convention as basePrice. */
  avgRating: string | null
  reviewCount: number
  createdAt: string
  updatedAt: string
  variants: ProductVariant[]
  images: ProductImage[]
  customizationFields: CustomizationField[]
}

/**
 * Mirrors ListProductsQueryDto exactly — page/limit/categoryId/search/minPrice/maxPrice/minRating/sort.
 * `search` is a case-insensitive substring match on Product.name.
 * `sort` can be 'newest' | 'price_asc' | 'price_desc' | 'rating_desc'.
 */
export interface ListProductsParams {
  page?: number
  limit?: number
  categoryId?: string
  search?: string
  minPrice?: number
  maxPrice?: number
  minRating?: number
  sort?: 'newest' | 'price_asc' | 'price_desc' | 'rating_desc'
}

/** Mirrors ListAdminProductsQueryDto — the admin catalog-management list
 * (GET /products/admin), which unlike GET /products can also return
 * inactive products. */
export interface ListAdminProductsParams {
  page?: number
  limit?: number
  categoryId?: string
  search?: string
  status?: 'active' | 'inactive'
}

export interface FilterState {
  minPrice?: number
  maxPrice?: number
  minRating?: number
  sort?: 'newest' | 'price_asc' | 'price_desc' | 'rating_desc'
}

export const SORT_OPTIONS: Array<{ value: FilterState['sort']; label: string }> = [
  { value: 'newest', label: 'Newest' },
  { value: 'price_asc', label: 'Price: Low to High' },
  { value: 'price_desc', label: 'Price: High to Low' },
  { value: 'rating_desc', label: 'Top Rated' },
]

export const RATING_OPTIONS = [1, 2, 3, 4, 5] as const

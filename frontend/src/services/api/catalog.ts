import type { ApiSuccessResponse, PaginationMeta } from '@/types/api'
import type {
  Category,
  CategoryTreeNode,
  CustomizationField,
  ListAdminProductsParams,
  ListProductsParams,
  Product,
  ProductImage,
  ProductVariant,
} from '@/types/catalog'
import type {
  CreateCategoryPayload,
  CreateCustomizationFieldPayload,
  CreateProductImagePayload,
  CreateProductPayload,
  CreateVariantPayload,
  UpdateCategoryPayload,
  UpdateCustomizationFieldPayload,
  UpdateProductPayload,
  UpdateVariantPayload,
} from '@/types/admin'
import { apiClient } from './client'

/**
 * Thin wrappers over the public+admin catalog routes
 * (backend/src/products/products.controller.ts,
 * backend/src/products/categories/categories.controller.ts) — one
 * controller owns both the public reads and the admin CRUD (role-gated
 * per-route server-side, §17/§19), so this file mirrors that split rather
 * than duplicating admin-only variants under services/api/admin.ts. Same
 * pattern as services/api/auth.ts — unwrap the {success, data[, meta]}
 * envelope (§21), return just the payload.
 *
 * IMPORTANT, confirmed against the actual current products.service.ts:
 * `GET /products` and `GET /products/:slug` unconditionally filter
 * `isActive: true` server-side — there is no admin bypass, and no
 * `GET /products/:id` at all. `fetchProducts` below is therefore the only
 * list source available to the admin products page too, and it will never
 * surface a deactivated product. See AdminProductsPage's own doc comment.
 */

export async function fetchCategories(): Promise<Category[]> {
  const res = await apiClient.get<ApiSuccessResponse<Category[]>>('/categories')
  if (res.data?.data === undefined) {
    throw new Error('Failed to load categories: response data is missing')
  }
  return res.data.data
}

export async function fetchCategoryTree(): Promise<CategoryTreeNode[]> {
  const res = await apiClient.get<ApiSuccessResponse<CategoryTreeNode[]>>('/categories/tree')
  if (res.data?.data === undefined) {
    throw new Error('Failed to load category tree: response data is missing')
  }
  return res.data.data
}

export interface ProductListResult {
  items: Product[]
  meta: PaginationMeta
}

/** GET /products accepts page/limit/categoryId/search (ListProductsQueryDto)
 * — no sort param exists server-side yet. `params` is forwarded as-is, so
 * `search` flows through once present on ListProductsParams. */
export async function fetchProducts(
  params: ListProductsParams = {},
): Promise<ProductListResult> {
  const res = await apiClient.get<ApiSuccessResponse<Product[]>>('/products', { params })
  return { items: res.data.data, meta: res.data.meta as PaginationMeta }
}

export async function fetchProductBySlug(slug: string): Promise<Product> {
  const res = await apiClient.get<ApiSuccessResponse<Product>>(
    `/products/${encodeURIComponent(slug)}`,
  )
  return res.data.data
}

// ─── Admin: catalog-management reads (active + inactive) ─────────────────

/** GET /products/admin — admin-role required server-side. Unlike
 * fetchProducts this surfaces inactive products; `status` narrows to one
 * side. */
export async function fetchAdminProducts(
  params: ListAdminProductsParams = {},
): Promise<ProductListResult> {
  const res = await apiClient.get<ApiSuccessResponse<Product[]>>('/products/admin', {
    params,
  })
  return { items: res.data.data, meta: res.data.meta as PaginationMeta }
}

/** GET /products/admin/:id — admin-role required; NOT isActive-filtered,
 * so a deactivated product stays reachable (and reactivatable). */
export async function fetchAdminProduct(id: string): Promise<Product> {
  const res = await apiClient.get<ApiSuccessResponse<Product>>(
    `/products/admin/${encodeURIComponent(id)}`,
  )
  return res.data.data
}

/** GET /categories/admin — admin-role required; returns active AND
 * inactive categories. The public GET /categories stays active-only. */
export async function fetchAdminCategories(): Promise<Category[]> {
  const res = await apiClient.get<ApiSuccessResponse<Category[]>>('/categories/admin')
  return res.data.data
}

// ─── Admin: products ───────────────────────────────────────────────────

export async function createProduct(payload: CreateProductPayload): Promise<Product> {
  const res = await apiClient.post<ApiSuccessResponse<Product>>('/products', payload)
  return res.data.data
}

export async function updateProduct(id: string, payload: UpdateProductPayload): Promise<Product> {
  const res = await apiClient.patch<ApiSuccessResponse<Product>>(`/products/${id}`, payload)
  return res.data.data
}

/** DELETE /products/:id — soft-delete (isActive=false), not a real
 * removal. */
export async function deactivateProduct(id: string): Promise<void> {
  await apiClient.delete(`/products/${id}`)
}

/** POST /products/:id/reactivate — the reverse of deactivateProduct, a
 * dedicated endpoint rather than an isActive field on the general PATCH
 * (same reasoning the backend applies to deactivation: exactly one path
 * flips this flag in either direction). */
export async function reactivateProduct(id: string): Promise<void> {
  await apiClient.post(`/products/${id}/reactivate`)
}

// ─── Admin: variants ─────────────────────────────────────────────────────

export async function createVariant(
  productId: string,
  payload: CreateVariantPayload,
): Promise<ProductVariant> {
  const res = await apiClient.post<ApiSuccessResponse<ProductVariant>>(
    `/products/${productId}/variants`,
    payload,
  )
  return res.data.data
}

export async function updateVariant(
  productId: string,
  variantId: string,
  payload: UpdateVariantPayload,
): Promise<ProductVariant> {
  const res = await apiClient.patch<ApiSuccessResponse<ProductVariant>>(
    `/products/${productId}/variants/${variantId}`,
    payload,
  )
  return res.data.data
}

// ─── Admin: customization fields ─────────────────────────────────────────

export async function createCustomizationField(
  productId: string,
  payload: CreateCustomizationFieldPayload,
): Promise<CustomizationField> {
  const res = await apiClient.post<ApiSuccessResponse<CustomizationField>>(
    `/products/${productId}/customization-fields`,
    payload,
  )
  return res.data.data
}

export async function updateCustomizationField(
  productId: string,
  fieldId: string,
  payload: UpdateCustomizationFieldPayload,
): Promise<CustomizationField> {
  const res = await apiClient.patch<ApiSuccessResponse<CustomizationField>>(
    `/products/${productId}/customization-fields/${fieldId}`,
    payload,
  )
  return res.data.data
}

// ─── Admin: images ───────────────────────────────────────────────────────

export async function addProductImage(
  productId: string,
  payload: CreateProductImagePayload,
): Promise<ProductImage> {
  const res = await apiClient.post<ApiSuccessResponse<ProductImage>>(
    `/products/${productId}/images`,
    payload,
  )
  return res.data.data
}

export async function removeProductImage(productId: string, imageId: string): Promise<void> {
  await apiClient.delete(`/products/${productId}/images/${imageId}`)
}

// ─── Admin: categories ───────────────────────────────────────────────────

export async function createCategory(payload: CreateCategoryPayload): Promise<Category> {
  const res = await apiClient.post<ApiSuccessResponse<Category>>('/categories', payload)
  return res.data.data
}

export async function updateCategory(id: string, payload: UpdateCategoryPayload): Promise<Category> {
  const res = await apiClient.patch<ApiSuccessResponse<Category>>(`/categories/${id}`, payload)
  return res.data.data
}

/** DELETE /categories/:id — soft-delete (isActive=false), mirroring
 * deactivateProduct. */
export async function deactivateCategory(id: string): Promise<void> {
  await apiClient.delete(`/categories/${id}`)
}

/** POST /categories/:id/reactivate — the reverse of deactivateCategory. */
export async function reactivateCategory(id: string): Promise<void> {
  await apiClient.post(`/categories/${id}/reactivate`)
}

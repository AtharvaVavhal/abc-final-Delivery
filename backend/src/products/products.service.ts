import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Category,
  CustomizationField,
  Prisma,
  Product,
  ProductImage,
  ProductVariant,
} from '@prisma/client';
import {
  PrismaService,
  PRISMA_TX_MAX_WAIT_MS,
  PRISMA_TX_TIMEOUT_MS,
} from '../common/database/prisma.service';
import { PaginatedResult } from '../common/types/api-response.interface';
import { assertObjectInTenant } from '../common/tenant/object-auth';
import { AuditService } from '../common/audit/audit.service';
import { resolveTenantAuditActor } from '../common/audit/tenant-actor-attribution';
import { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { TenantContext } from '../common/tenant/tenant-context';
import { LimitEnforcementService } from '../limits/limit-enforcement.service';
import { UploadsService } from '../uploads/uploads.service';
import { CategoryTreeNode } from './dto/category-tree.dto';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { CreateVariantDto } from './dto/create-variant.dto';
import { UpdateVariantDto } from './dto/update-variant.dto';
import { CreateProductImageDto } from './dto/create-product-image.dto';
import { CreateCustomizationFieldDto } from './dto/create-customization-field.dto';
import { UpdateCustomizationFieldDto } from './dto/update-customization-field.dto';

const PRODUCT_DETAIL_INCLUDE = {
  variants: true,
  images: { orderBy: { sortOrder: 'asc' as const } },
  customizationFields: { orderBy: { sortOrder: 'asc' as const } },
} satisfies Prisma.ProductInclude;

/** `url` is computed on every read (withImageUrl/withImageUrls below), never
 * persisted — Cloudinary URL construction needs the API secret, which must
 * never reach the browser, so the raw ProductImage row is never returned
 * as-is from any endpoint. */
type ProductImageWithUrl = ProductImage & { url: string };

type ProductWithRelations = Product & {
  variants: ProductVariant[];
  images: ProductImageWithUrl[];
  customizationFields: CustomizationField[];
};

@Injectable()
export class ProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly uploadsService: UploadsService,
    private readonly auditService: AuditService,
    private readonly limitEnforcementService: LimitEnforcementService,
  ) {}

  // ─── Categories ──────────────────────────────────────────────────────

  async listCategories(tenantId: string): Promise<Category[]> {
    return this.prisma.category.findMany({
      where: { isActive: true, tenantId },
      orderBy: { name: 'asc' },
    });
  }

  async createCategory(
    tenantContext: TenantContext,
    actor: AuthenticatedUser,
    dto: CreateCategoryDto,
  ): Promise<Category> {
    return this.prisma.$transaction(async (tx) => {
      if (dto.parentCategoryId) {
        const parent = await tx.category.findUnique({
          where: { id: dto.parentCategoryId },
        });
        if (!parent) {
          throw new NotFoundException('Category not found');
        }
        // Never let a category be parented to another tenant's category —
        // Phase 4 W7 / P4-D2 object-level check (`object-auth.ts`).
        assertObjectInTenant(parent, tenantContext.tenantId);
      }
      let created: Category;
      try {
        created = await tx.category.create({
          data: { ...dto, tenantId: tenantContext.tenantId },
        });
      } catch (err) {
        this.mapUniqueConstraintError(
          err,
          'A category with this slug already exists',
        );
      }
      const attribution = await resolveTenantAuditActor(
        tx,
        tenantContext,
        actor,
      );
      await this.auditService.logTenantAction(tx, {
        tenantId: tenantContext.tenantId,
        ...attribution,
        action: 'category.create',
        targetType: 'Category',
        targetId: created.id,
        metadata: { name: dto.name, slug: dto.slug },
      });
      return created;
    });
  }

  async updateCategory(
    tenantContext: TenantContext,
    actor: AuthenticatedUser,
    id: string,
    dto: UpdateCategoryDto,
  ): Promise<Category> {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.category.findUnique({ where: { id } });
      if (!existing) {
        throw new NotFoundException('Category not found');
      }
      // W10 hardening (P0) — this lookup was, until now, global: any tenant
      // with `products:write` could rename/re-slug/re-parent ANY other
      // tenant's category by id. `createCategory` already validates a
      // parent this way; `update` never did.
      assertObjectInTenant(existing, tenantContext.tenantId);
      if (dto.parentCategoryId) {
        const parent = await tx.category.findUnique({
          where: { id: dto.parentCategoryId },
        });
        if (!parent) {
          throw new NotFoundException('Category not found');
        }
        // Same check createCategory already applies to a new category's
        // parent — a category can never be re-parented under another
        // tenant's category either.
        assertObjectInTenant(parent, tenantContext.tenantId);
      }
      let updated: Category;
      try {
        updated = await tx.category.update({ where: { id }, data: dto });
      } catch (err) {
        this.mapUniqueConstraintError(
          err,
          'A category with this slug already exists',
        );
      }
      const attribution = await resolveTenantAuditActor(
        tx,
        tenantContext,
        actor,
      );
      await this.auditService.logTenantAction(tx, {
        tenantId: tenantContext.tenantId,
        ...attribution,
        action: 'category.update',
        targetType: 'Category',
        targetId: id,
        metadata: { fields: Object.keys(dto) },
      });
      return updated;
    });
  }

  /**
   * Admin-only: every category, active and inactive. The storefront reads
   * (listCategories / getCategoryTree above) stay isActive-filtered, so
   * public behaviour is unchanged — this is the only path that surfaces a
   * deactivated category for management.
   *
   * W10 hardening (P0) — was unconditionally global (no `where` at all):
   * every tenant's admin panel showed every OTHER tenant's categories too.
   */
  async adminListCategories(tenantContext: TenantContext): Promise<Category[]> {
    return this.prisma.category.findMany({
      where: { tenantId: tenantContext.tenantId },
      orderBy: { name: 'asc' },
    });
  }

  /**
   * Soft-delete — isActive=false. Mirrors deactivateProduct exactly:
   * categories are never hard-deleted, and this is idempotent /
   * double-click-safe (no current-state check, no error if already
   * inactive). Category hierarchy is untouched — children keep their
   * parentCategoryId; getCategoryTree's existing orphan handling already
   * copes with a hidden parent.
   */
  async deactivateCategory(
    tenantContext: TenantContext,
    actor: AuthenticatedUser,
    id: string,
  ): Promise<Category> {
    return this.setCategoryActiveWithAudit(
      tenantContext,
      actor,
      id,
      false,
      'category.deactivate',
    );
  }

  /** The reverse of deactivateCategory — same shape, same reasoning. */
  async reactivateCategory(
    tenantContext: TenantContext,
    actor: AuthenticatedUser,
    id: string,
  ): Promise<Category> {
    return this.setCategoryActiveWithAudit(
      tenantContext,
      actor,
      id,
      true,
      'category.reactivate',
    );
  }

  private async setCategoryActiveWithAudit(
    tenantContext: TenantContext,
    actor: AuthenticatedUser,
    id: string,
    isActive: boolean,
    action: 'category.deactivate' | 'category.reactivate',
  ): Promise<Category> {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.category.findUnique({ where: { id } });
      if (!existing) {
        throw new NotFoundException('Category not found');
      }
      // W10 hardening (P0) — see updateCategory's identical comment.
      assertObjectInTenant(existing, tenantContext.tenantId);
      const updated = await tx.category.update({
        where: { id },
        data: { isActive },
      });
      const attribution = await resolveTenantAuditActor(
        tx,
        tenantContext,
        actor,
      );
      await this.auditService.logTenantAction(tx, {
        tenantId: tenantContext.tenantId,
        ...attribution,
        action,
        targetType: 'Category',
        targetId: id,
        metadata: {},
      });
      return updated;
    });
  }

  // ─── Category Tree ──────────────────────────────────────────────────────

  async getCategoryTree(tenantId: string): Promise<CategoryTreeNode[]> {
    const categories = await this.prisma.category.findMany({
      where: { isActive: true, tenantId },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, slug: true, parentCategoryId: true },
    });

    const map = new Map<string, CategoryTreeNode>();
    const roots: CategoryTreeNode[] = [];

    // First pass: create nodes
    for (const cat of categories) {
      map.set(cat.id, {
        id: cat.id,
        name: cat.name,
        slug: cat.slug,
        children: [],
      });
    }

    // Second pass: link children to parents
    for (const cat of categories) {
      const node = map.get(cat.id)!;
      if (cat.parentCategoryId) {
        const parent = map.get(cat.parentCategoryId);
        if (parent) {
          parent.children.push(node);
        } else {
          // Orphaned child (parent doesn't exist) - treat as root
          roots.push(node);
        }
      } else {
        roots.push(node);
      }
    }

    // Sort children recursively
    const sortRecursive = (nodes: CategoryTreeNode[]) => {
      nodes.sort((a, b) => a.name.localeCompare(b.name));
      for (const node of nodes) {
        if (node.children.length) sortRecursive(node.children);
      }
    };
    sortRecursive(roots);

    return roots;
  }

  // ─── Products (public reads) ─────────────────────────────────────────

  async listProducts(
    tenantId: string,
    page: number,
    limit: number,
    categoryId: string | undefined,
    search: string | undefined,
    minPrice?: number,
    maxPrice?: number,
    minRating?: number,
    sort?: 'newest' | 'price_asc' | 'price_desc' | 'rating_desc',
  ): Promise<PaginatedResult<ProductWithRelations>> {
    const categoryFilter = categoryId
      ? await this.publicCategoryIds(tenantId, categoryId)
      : undefined

    const where: Prisma.ProductWhereInput = {
      tenantId,
      isActive: true,
      ...(categoryFilter ? { categoryId: { in: categoryFilter } } : {}),
      ...(search
        ? { name: { contains: search, mode: 'insensitive' as const } }
        : {}),
      ...(minPrice !== undefined || maxPrice !== undefined
        ? {
            basePrice: {
              ...(minPrice !== undefined ? { gte: minPrice } : {}),
              ...(maxPrice !== undefined ? { lte: maxPrice } : {}),
            },
          }
        : {}),
      ...(minRating !== undefined ? { avgRating: { gte: minRating } } : {}),
    };

    let orderBy: Prisma.ProductOrderByWithRelationInput = { createdAt: 'desc' };
    switch (sort) {
      case 'price_asc':
        orderBy = { basePrice: 'asc' };
        break;
      case 'price_desc':
        orderBy = { basePrice: 'desc' };
        break;
      case 'rating_desc':
        orderBy = { avgRating: 'desc' };
        break;
      case 'newest':
      default:
        orderBy = { createdAt: 'desc' };
    }

    const [items, total] = await Promise.all([
      this.prisma.product.findMany({
        where,
        include: PRODUCT_DETAIL_INCLUDE,
        orderBy,
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.product.count({ where }),
    ]);

    return {
      items: items.map((item) => this.withImageUrls(item)),
      meta: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    };
  }

  /**
   * Public listing: a parent category includes products filed on it or on
   * any active direct child (one nesting level, matching Category).
   */
  private async publicCategoryIds(tenantId: string, categoryId: string): Promise<string[]> {
    const children = await this.prisma.category.findMany({
      where: { parentCategoryId: categoryId, isActive: true, tenantId },
      select: { id: true },
    })
    return [categoryId, ...children.map((child) => child.id)]
  }

  async getProductBySlug(tenantId: string, slug: string): Promise<ProductWithRelations> {
    const product = await this.prisma.product.findFirst({
      where: { slug, isActive: true, tenantId },
      include: PRODUCT_DETAIL_INCLUDE,
    });
    if (!product) {
      // Deliberately identical to "doesn't exist" — an inactive product is
      // never distinguishable from a nonexistent one via this endpoint.
      throw new NotFoundException('Product not found');
    }
    return this.withImageUrls(product);
  }

  // ─── Products (admin writes) ─────────────────────────────────────────

  async createProduct(
    tenantContext: TenantContext,
    actor: AuthenticatedUser,
    dto: CreateProductDto,
  ): Promise<ProductWithRelations> {
    return this.prisma.$transaction(
      async (tx) => {
        const category = await tx.category.findUnique({
          where: { id: dto.categoryId },
        });
        if (!category) {
          throw new NotFoundException('Category not found');
        }
        assertObjectInTenant(category, tenantContext.tenantId);

        // Phase 6 W5 — same transaction as the actual create below (the
        // core W5 invariant: reservation + resource creation atomic
        // together). `products` counts ALL Product rows regardless of
        // `isActive` and is never decremented (deletion isn't supported —
        // deactivation only), so this is the only usage touchpoint this
        // resource ever needs.
        await this.limitEnforcementService.assertLimit(
          tx,
          tenantContext.tenantId,
          'products',
          1,
        );

        let created: Product;
        try {
          created = await tx.product.create({
            data: {
              categoryId: dto.categoryId,
              name: dto.name,
              slug: dto.slug,
              basePrice: dto.basePrice,
              minQuantity: dto.minQuantity,
              maxQuantity: dto.maxQuantity,
              specifications: dto.specifications as
                Prisma.InputJsonValue | undefined,
              tenantId: tenantContext.tenantId,
            },
          });
        } catch (err) {
          this.mapUniqueConstraintError(
            err,
            'A product with this slug already exists',
          );
        }
        const attribution = await resolveTenantAuditActor(
          tx,
          tenantContext,
          actor,
        );
        await this.auditService.logTenantAction(tx, {
          tenantId: tenantContext.tenantId,
          ...attribution,
          action: 'product.create',
          targetType: 'Product',
          targetId: created.id,
          metadata: { name: dto.name, slug: dto.slug },
        });
        return {
          ...created,
          variants: [],
          images: [] as ProductImageWithUrl[],
          customizationFields: [],
        };
      },
      { maxWait: PRISMA_TX_MAX_WAIT_MS, timeout: PRISMA_TX_TIMEOUT_MS },
    );
  }

  async updateProduct(
    tenantContext: TenantContext,
    actor: AuthenticatedUser,
    id: string,
    dto: UpdateProductDto,
  ): Promise<ProductWithRelations> {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.product.findUnique({ where: { id } });
      if (!existing) {
        throw new NotFoundException('Product not found');
      }
      // W10 hardening (P0) — this lookup was, until now, global: any
      // tenant with `products:write` could rewrite ANY other tenant's
      // product by id. `createProduct` already validates its category
      // this way; `update` never validated the PRODUCT itself.
      assertObjectInTenant(existing, tenantContext.tenantId);
      if (dto.categoryId) {
        const category = await tx.category.findUnique({
          where: { id: dto.categoryId },
        });
        if (!category) {
          throw new NotFoundException('Category not found');
        }
        // Never let a product be re-categorized into another tenant's
        // category — same rule createProduct already enforces on create.
        assertObjectInTenant(category, tenantContext.tenantId);
      }
      let updated: ProductWithRelations;
      try {
        const row = await tx.product.update({
          where: { id },
          data: {
            categoryId: dto.categoryId,
            name: dto.name,
            slug: dto.slug,
            basePrice: dto.basePrice,
            minQuantity: dto.minQuantity,
            maxQuantity: dto.maxQuantity,
            specifications: dto.specifications as
              Prisma.InputJsonValue | undefined,
          },
          include: PRODUCT_DETAIL_INCLUDE,
        });
        updated = this.withImageUrls(row);
      } catch (err) {
        this.mapUniqueConstraintError(
          err,
          'A product with this slug already exists',
        );
      }
      const attribution = await resolveTenantAuditActor(
        tx,
        tenantContext,
        actor,
      );
      await this.auditService.logTenantAction(tx, {
        tenantId: tenantContext.tenantId,
        ...attribution,
        action: 'product.update',
        targetType: 'Product',
        targetId: id,
        metadata: { fields: Object.keys(dto) },
      });
      return updated;
    });
  }

  /** Soft-delete only — isActive=false. Products are never hard-deleted (§24). */
  async deactivateProduct(
    tenantContext: TenantContext,
    actor: AuthenticatedUser,
    id: string,
  ): Promise<void> {
    await this.setProductActiveWithAudit(
      tenantContext,
      actor,
      id,
      false,
      'product.deactivate',
    );
  }

  /**
   * The reverse of deactivateProduct — same shape, same reasoning: kept as
   * its own dedicated method/endpoint (POST /products/:id/reactivate)
   * rather than an isActive field on the general PATCH (same reasoning the
   * backend applies to deactivation: exactly one path flips this flag in
   * either direction). Unconditional, same as deactivateProduct: no
   * current-state check, no error if the product is already active
   * (idempotent, admin-double-click-safe).
   */
  async reactivateProduct(
    tenantContext: TenantContext,
    actor: AuthenticatedUser,
    id: string,
  ): Promise<void> {
    await this.setProductActiveWithAudit(
      tenantContext,
      actor,
      id,
      true,
      'product.reactivate',
    );
  }

  private async setProductActiveWithAudit(
    tenantContext: TenantContext,
    actor: AuthenticatedUser,
    id: string,
    isActive: boolean,
    action: 'product.deactivate' | 'product.reactivate',
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const existing = await tx.product.findUnique({ where: { id } });
      if (!existing) {
        throw new NotFoundException('Product not found');
      }
      // W10 hardening (P0) — see updateProduct's identical comment.
      assertObjectInTenant(existing, tenantContext.tenantId);
      await tx.product.update({ where: { id }, data: { isActive } });
      const attribution = await resolveTenantAuditActor(
        tx,
        tenantContext,
        actor,
      );
      await this.auditService.logTenantAction(tx, {
        tenantId: tenantContext.tenantId,
        ...attribution,
        action,
        targetType: 'Product',
        targetId: id,
        metadata: {},
      });
    });
  }

  /**
   * Admin-only product list — active AND inactive. Separate from the
   * public listProducts (which is unconditionally isActive-filtered, and
   * stays that way): an optional `status` filter narrows to one or the
   * other. No price/rating/sort params — this is a management list, not
   * the storefront catalog.
   */
  /**
   * W10 hardening (P0) — this list, and adminGetProduct below, were
   * unconditionally global (no `where.tenantId` at all): any tenant with
   * `products:read` could browse every OTHER tenant's full catalog,
   * including inactive/unlisted products never shown on any storefront.
   */
  async adminListProducts(
    tenantContext: TenantContext,
    page: number,
    limit: number,
    categoryId: string | undefined,
    search: string | undefined,
    status: 'active' | 'inactive' | undefined,
  ): Promise<PaginatedResult<ProductWithRelations>> {
    const where: Prisma.ProductWhereInput = {
      tenantId: tenantContext.tenantId,
      ...(status === 'active' ? { isActive: true } : {}),
      ...(status === 'inactive' ? { isActive: false } : {}),
      ...(categoryId ? { categoryId } : {}),
      ...(search
        ? { name: { contains: search, mode: 'insensitive' as const } }
        : {}),
    };

    const [items, total] = await Promise.all([
      this.prisma.product.findMany({
        where,
        include: PRODUCT_DETAIL_INCLUDE,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.product.count({ where }),
    ]);

    return {
      items: items.map((item) => this.withImageUrls(item)),
      meta: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    };
  }

  /**
   * Admin-only single-product read by id. Unlike getProductBySlug this is
   * NOT isActive-filtered, so a deactivated product stays reachable for
   * management (and reactivation) after navigating away from it.
   */
  async adminGetProduct(
    tenantContext: TenantContext,
    id: string,
  ): Promise<ProductWithRelations> {
    const product = await this.prisma.product.findUnique({
      where: { id },
      include: PRODUCT_DETAIL_INCLUDE,
    });
    if (!product) {
      throw new NotFoundException('Product not found');
    }
    assertObjectInTenant(product, tenantContext.tenantId);
    return this.withImageUrls(product);
  }

  // ─── Variants (admin writes) ─────────────────────────────────────────

  async createVariant(
    tenantContext: TenantContext,
    actor: AuthenticatedUser,
    productId: string,
    dto: CreateVariantDto,
  ): Promise<ProductVariant> {
    return this.prisma.$transaction(async (tx) => {
      const product = await tx.product.findUnique({
        where: { id: productId },
      });
      if (!product) {
        throw new NotFoundException('Product not found');
      }
      assertObjectInTenant(product, tenantContext.tenantId);
      let created: ProductVariant;
      try {
        created = await tx.productVariant.create({
          data: { productId, ...dto, tenantId: tenantContext.tenantId },
        });
      } catch (err) {
        this.mapUniqueConstraintError(
          err,
          'A variant with this label already exists for this product',
        );
      }
      const attribution = await resolveTenantAuditActor(
        tx,
        tenantContext,
        actor,
      );
      await this.auditService.logTenantAction(tx, {
        tenantId: tenantContext.tenantId,
        ...attribution,
        action: 'product.variant_create',
        targetType: 'ProductVariant',
        targetId: created.id,
        metadata: { productId, label: dto.label },
      });
      return created;
    });
  }

  async updateVariant(
    tenantContext: TenantContext,
    actor: AuthenticatedUser,
    productId: string,
    variantId: string,
    dto: UpdateVariantDto,
  ): Promise<ProductVariant> {
    return this.prisma.$transaction(async (tx) => {
      const product = await tx.product.findUnique({
        where: { id: productId },
      });
      if (!product) {
        throw new NotFoundException('Product not found');
      }
      // W10 hardening (P0) — createVariant/createCustomizationField/
      // addImage already validate the parent product this way; the three
      // corresponding update/remove paths (this one, updateCustomization
      // Field, removeImage) never did, so a tenant with `products:write`
      // could mutate a sub-resource of ANY OTHER tenant's product by
      // supplying that tenant's own productId.
      assertObjectInTenant(product, tenantContext.tenantId);
      const variant = await tx.productVariant.findUnique({
        where: { id: variantId },
      });
      if (!variant || variant.productId !== productId) {
        throw new NotFoundException('Variant not found for this product');
      }
      let updated: ProductVariant;
      try {
        updated = await tx.productVariant.update({
          where: { id: variant.id },
          data: dto,
        });
      } catch (err) {
        this.mapUniqueConstraintError(
          err,
          'A variant with this label already exists for this product',
        );
      }
      const attribution = await resolveTenantAuditActor(
        tx,
        tenantContext,
        actor,
      );
      await this.auditService.logTenantAction(tx, {
        tenantId: tenantContext.tenantId,
        ...attribution,
        action: 'product.variant_update',
        targetType: 'ProductVariant',
        targetId: variantId,
        metadata: { productId, fields: Object.keys(dto) },
      });
      return updated;
    });
  }

  // ─── Customization fields (admin writes) ─────────────────────────────
  // Public read is folded into GET /products/:slug (PRODUCT_DETAIL_INCLUDE
  // above), not a separate endpoint — §20 groups "customization-fields"
  // into the same admin-CRUD notes as variants/products, and §29 has
  // Atharva shipping the GET /products/:slug contract as the thing Harshad's
  // customization form UI consumes. Per-value validation and surcharge
  // pricing live in customizations/customization-validation.(util|service).ts,
  // for Cart (Phase 4) to call — not exposed here.

  async createCustomizationField(
    tenantContext: TenantContext,
    actor: AuthenticatedUser,
    productId: string,
    dto: CreateCustomizationFieldDto,
  ): Promise<CustomizationField> {
    return this.prisma.$transaction(async (tx) => {
      const product = await tx.product.findUnique({
        where: { id: productId },
      });
      if (!product) {
        throw new NotFoundException('Product not found');
      }
      assertObjectInTenant(product, tenantContext.tenantId);
      const created = await tx.customizationField.create({
        data: {
          productId,
          label: dto.label,
          type: dto.type,
          isRequired: dto.isRequired,
          sortOrder: dto.sortOrder,
          helpText: dto.helpText,
          constraints: dto.constraints as Prisma.InputJsonValue | undefined,
          surchargeType: dto.surchargeType,
          surchargeAmount: dto.surchargeAmount,
          tenantId: tenantContext.tenantId,
        },
      });
      const attribution = await resolveTenantAuditActor(
        tx,
        tenantContext,
        actor,
      );
      await this.auditService.logTenantAction(tx, {
        tenantId: tenantContext.tenantId,
        ...attribution,
        action: 'product.customization_create',
        targetType: 'CustomizationField',
        targetId: created.id,
        metadata: { productId, label: dto.label, type: dto.type },
      });
      return created;
    });
  }

  async updateCustomizationField(
    tenantContext: TenantContext,
    actor: AuthenticatedUser,
    productId: string,
    fieldId: string,
    dto: UpdateCustomizationFieldDto,
  ): Promise<CustomizationField> {
    return this.prisma.$transaction(async (tx) => {
      const product = await tx.product.findUnique({
        where: { id: productId },
      });
      if (!product) {
        throw new NotFoundException('Product not found');
      }
      // W10 hardening (P0) — see updateVariant's identical comment.
      assertObjectInTenant(product, tenantContext.tenantId);
      const field = await tx.customizationField.findUnique({
        where: { id: fieldId },
      });
      if (!field || field.productId !== productId) {
        throw new NotFoundException(
          'Customization field not found for this product',
        );
      }
      const updated = await tx.customizationField.update({
        where: { id: field.id },
        data: {
          label: dto.label,
          type: dto.type,
          isRequired: dto.isRequired,
          sortOrder: dto.sortOrder,
          helpText: dto.helpText,
          constraints: dto.constraints as Prisma.InputJsonValue | undefined,
          surchargeType: dto.surchargeType,
          surchargeAmount: dto.surchargeAmount,
        },
      });
      const attribution = await resolveTenantAuditActor(
        tx,
        tenantContext,
        actor,
      );
      await this.auditService.logTenantAction(tx, {
        tenantId: tenantContext.tenantId,
        ...attribution,
        action: 'product.customization_update',
        targetType: 'CustomizationField',
        targetId: fieldId,
        metadata: { productId, fields: Object.keys(dto) },
      });
      return updated;
    });
  }

  // ─── Images (admin writes) ───────────────────────────────────────────

  async addImage(
    tenantContext: TenantContext,
    actor: AuthenticatedUser,
    productId: string,
    dto: CreateProductImageDto,
  ): Promise<ProductImageWithUrl> {
    // A read against a different module's own data (uploaded_files) — not
    // part of this mutation's own atomicity requirement, same reasoning
    // this call already had before W8; only the productImage create + the
    // audit write need to be atomic with each other.
    const uploadedFile = await this.uploadsService.findById(dto.uploadedFileId);
    if (!uploadedFile) {
      throw new NotFoundException('Uploaded file not found');
    }

    return this.prisma.$transaction(async (tx) => {
      const product = await tx.product.findUnique({
        where: { id: productId },
      });
      if (!product) {
        throw new NotFoundException('Product not found');
      }
      assertObjectInTenant(product, tenantContext.tenantId);

      // resourceType/deliveryType are denormalized from the actual upload,
      // not assumed — see the ProductImage model's own doc comment
      // (schema.prisma) for why.
      const created = await tx.productImage.create({
        data: {
          productId,
          cloudinaryPublicId: uploadedFile.cloudinaryPublicId,
          resourceType: uploadedFile.resourceType,
          deliveryType: uploadedFile.deliveryType,
          sortOrder: dto.sortOrder ?? 0,
          isPrimary: dto.isPrimary ?? false,
          tenantId: tenantContext.tenantId,
        },
      });
      const attribution = await resolveTenantAuditActor(
        tx,
        tenantContext,
        actor,
      );
      await this.auditService.logTenantAction(tx, {
        tenantId: tenantContext.tenantId,
        ...attribution,
        action: 'product.image_add',
        targetType: 'ProductImage',
        targetId: created.id,
        metadata: { productId },
      });
      return this.withImageUrl(created);
    });
  }

  async removeImage(
    tenantContext: TenantContext,
    actor: AuthenticatedUser,
    productId: string,
    imageId: string,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const product = await tx.product.findUnique({
        where: { id: productId },
      });
      if (!product) {
        throw new NotFoundException('Product not found');
      }
      // W10 hardening (P0) — see updateVariant's identical comment.
      assertObjectInTenant(product, tenantContext.tenantId);
      const image = await tx.productImage.findUnique({
        where: { id: imageId },
      });
      if (!image || image.productId !== productId) {
        throw new NotFoundException('Image not found for this product');
      }
      await tx.productImage.delete({ where: { id: imageId } });
      const attribution = await resolveTenantAuditActor(
        tx,
        tenantContext,
        actor,
      );
      await this.auditService.logTenantAction(tx, {
        tenantId: tenantContext.tenantId,
        ...attribution,
        action: 'product.image_remove',
        targetType: 'ProductImage',
        targetId: imageId,
        metadata: { productId },
      });
    });
  }

  // ─── Helpers ─────────────────────────────────────────────────────────

  /** Computes a working delivery URL for every image on a product — see
   * ProductImageWithUrl's doc comment for why this is always computed on
   * read, never persisted. */
  private withImageUrls<T extends { images: ProductImage[] }>(
    product: T,
  ): Omit<T, 'images'> & { images: ProductImageWithUrl[] } {
    return {
      ...product,
      images: product.images.map((image) => this.withImageUrl(image)),
    };
  }

  private withImageUrl(image: ProductImage): ProductImageWithUrl {
    return {
      ...image,
      url: this.uploadsService.resolveUrl(
        image.cloudinaryPublicId,
        image.resourceType,
        image.deliveryType,
      ),
    };
  }

  private mapUniqueConstraintError(err: unknown, message: string): never {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === 'P2002'
    ) {
      throw new ConflictException(message);
    }
    throw err as Error;
  }
}

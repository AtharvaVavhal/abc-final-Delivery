import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { Public } from '../common/decorators/public.decorator';
import { RequirePermission } from '../auth/permissions/require-permission.decorator';
import { CurrentTenant } from '../common/decorators/current-tenant.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import type { TenantContext } from '../common/tenant/tenant-context';
import type { RequestWithTenantContext } from '../common/tenant/tenant-context';
import { StorefrontTenantResolver } from '../common/tenant/storefront-tenant.resolver';
import { ProductsService } from './products.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { CreateVariantDto } from './dto/create-variant.dto';
import { UpdateVariantDto } from './dto/update-variant.dto';
import { CreateProductImageDto } from './dto/create-product-image.dto';
import { ListProductsQueryDto } from './dto/list-products-query.dto';
import { ListAdminProductsQueryDto } from './dto/list-admin-products-query.dto';
import { CreateCustomizationFieldDto } from './dto/create-customization-field.dto';
import { UpdateCustomizationFieldDto } from './dto/update-customization-field.dto';

type RequestWithHostname = RequestWithTenantContext & { hostname: string };

/**
 * Owns (§20): GET /products, GET /products/:slug (Public); admin CRUD for
 * products, variants, images (Admin). Categories live in
 * categories/categories.controller.ts (a distinct top-level path).
 *
 * Public single-product lookup is by :slug, not :id, per the frozen §20
 * contract (`GET /products/:slug`) — the task brief said ":id" for this
 * route, but changing the API contract needs an ACR (§38); admin
 * create/update/delete/variants/images all address the product by :id,
 * which is what a create response and an admin UI already have on hand.
 */
@Controller('products')
export class ProductsController {
  constructor(
    private readonly productsService: ProductsService,
    private readonly tenantResolver: StorefrontTenantResolver,
  ) {}

  private resolveTenantId(request: RequestWithHostname): Promise<string> {
    return this.tenantResolver.resolveActiveTenantId(
      request.tenantContext,
      request.hostname,
    );
  }

  @Public()
  @Get()
  async list(
    @Query() query: ListProductsQueryDto,
    @Req() request: RequestWithHostname,
  ) {
    const tenantId = await this.resolveTenantId(request);
    return this.productsService.listProducts(
      tenantId,
      query.page,
      query.limit,
      query.categoryId,
      query.search,
      query.minPrice,
      query.maxPrice,
      query.minRating,
      query.sort,
    );
  }

  // Admin catalog-management reads. Declared BEFORE `@Get(':slug')` so the
  // literal `admin` segment is matched by these, not swallowed as a slug.
  // Not isActive-filtered — a deactivated product stays visible here for
  // management and reactivation.

  @RequirePermission('products:read')
  @Get('admin')
  async adminList(
    @CurrentTenant() tenant: TenantContext,
    @Query() query: ListAdminProductsQueryDto,
  ) {
    return this.productsService.adminListProducts(
      tenant,
      query.page,
      query.limit,
      query.categoryId,
      query.search,
      query.status,
    );
  }

  @RequirePermission('products:read')
  @Get('admin/:id')
  async adminGet(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.productsService.adminGetProduct(tenant, id);
  }

  @Public()
  @Get(':slug')
  async getBySlug(
    @Param('slug') slug: string,
    @Req() request: RequestWithHostname,
  ) {
    const tenantId = await this.resolveTenantId(request);
    return this.productsService.getProductBySlug(tenantId, slug);
  }

  @RequirePermission('products:write')
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() actor: AuthenticatedUser,
    @Body() dto: CreateProductDto,
  ) {
    return this.productsService.createProduct(tenant, actor, dto);
  }

  @RequirePermission('products:write')
  @Patch(':id')
  async update(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateProductDto,
  ) {
    return this.productsService.updateProduct(tenant, actor, id, dto);
  }

  @RequirePermission('products:write')
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  async remove(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ message: string }> {
    await this.productsService.deactivateProduct(tenant, actor, id);
    return { message: 'Product deactivated' };
  }

  /** Mirrors `remove` above exactly — same file, same pattern, right next
   * to it. A dedicated route rather than an `isActive` field on
   * UpdateProductDto, same reasoning as deactivation: exactly one path
   * flips this flag in either direction, both explicit. */
  @RequirePermission('products:write')
  @Post(':id/reactivate')
  @HttpCode(HttpStatus.OK)
  async reactivate(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ message: string }> {
    await this.productsService.reactivateProduct(tenant, actor, id);
    return { message: 'Product reactivated' };
  }

  @RequirePermission('products:write')
  @Post(':id/variants')
  @HttpCode(HttpStatus.CREATED)
  async addVariant(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateVariantDto,
  ) {
    return this.productsService.createVariant(tenant, actor, id, dto);
  }

  @RequirePermission('products:write')
  @Patch(':id/variants/:variantId')
  async updateVariant(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('variantId', ParseUUIDPipe) variantId: string,
    @Body() dto: UpdateVariantDto,
  ) {
    return this.productsService.updateVariant(
      tenant,
      actor,
      id,
      variantId,
      dto,
    );
  }

  /**
   * Public read of a product's customization fields is not a separate
   * endpoint — it's folded into GET /products/:slug above (§20 groups
   * "customization-fields" with the admin-CRUD notes for products/variants;
   * §29 has this module shipping the GET /products/:slug contract as the
   * dynamic-form data source). Only admin create/update live here.
   */
  @RequirePermission('products:write')
  @Post(':id/customization-fields')
  @HttpCode(HttpStatus.CREATED)
  async addCustomizationField(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateCustomizationFieldDto,
  ) {
    return this.productsService.createCustomizationField(
      tenant,
      actor,
      id,
      dto,
    );
  }

  @RequirePermission('products:write')
  @Patch(':id/customization-fields/:fieldId')
  async updateCustomizationField(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('fieldId', ParseUUIDPipe) fieldId: string,
    @Body() dto: UpdateCustomizationFieldDto,
  ) {
    return this.productsService.updateCustomizationField(
      tenant,
      actor,
      id,
      fieldId,
      dto,
    );
  }

  @RequirePermission('products:write')
  @Post(':id/images')
  @HttpCode(HttpStatus.CREATED)
  async addImage(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateProductImageDto,
  ) {
    return this.productsService.addImage(tenant, actor, id, dto);
  }

  @RequirePermission('products:write')
  @Delete(':id/images/:imageId')
  @HttpCode(HttpStatus.OK)
  async removeImage(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('imageId', ParseUUIDPipe) imageId: string,
  ): Promise<{ message: string }> {
    await this.productsService.removeImage(tenant, actor, id, imageId);
    return { message: 'Image removed' };
  }
}

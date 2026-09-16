import { Controller, Get, Param, ParseUUIDPipe, Query, Req } from '@nestjs/common';
import { Public } from '../common/decorators/public.decorator';
import { ThrottlePublicRead } from '../common/throttling/throttle.decorators';
import type { RequestWithTenantContext } from '../common/tenant/tenant-context';
import { StorefrontTenantResolver } from '../common/tenant/storefront-tenant.resolver';
import { ReviewsService } from './reviews.service';
import { ListProductReviewsQueryDto } from './dto/list-product-reviews-query.dto';
import { ReviewView } from './dto/review-view.interface';
import { PaginatedResult } from '../common/types/api-response.interface';

type RequestWithHostname = RequestWithTenantContext & { hostname: string };

/**
 * Split from ReviewsController because its path prefix (`/products/:id/
 * reviews`) genuinely differs from `/reviews` — same reasoning
 * ProductsModule already applies to splitting ProductsController from
 * CategoriesController rather than forcing one controller to own two
 * unrelated base paths.
 */
@Controller('products/:id/reviews')
export class ProductReviewsController {
  constructor(
    private readonly reviewsService: ReviewsService,
    private readonly tenantResolver: StorefrontTenantResolver,
  ) {}

  @Public()
  @ThrottlePublicRead()
  @Get()
  async list(
    @Param('id', ParseUUIDPipe) productId: string,
    @Query() query: ListProductReviewsQueryDto,
    @Req() request: RequestWithHostname,
  ): Promise<PaginatedResult<ReviewView>> {
    const tenantId = await this.tenantResolver.resolveActiveTenantId(
      request.tenantContext,
      request.hostname,
    );
    return this.reviewsService.listForProduct(tenantId, productId, query);
  }
}

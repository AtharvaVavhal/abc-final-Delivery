import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { OrdersService } from './orders.service';
import { InvoicesService } from '../invoices/invoices.service';
import { ListOrdersQueryDto } from './dto/list-orders-query.dto';
import { CancelOrderDto } from './dto/cancel-order.dto';
import { ReplacePhotoDto } from './dto/replace-photo.dto';

/**
 * Owns (§20): GET /orders, GET /orders/:id — Auth (owner only).
 * Also POST /orders/:id/cancel — not in §20's frozen contract (see
 * OrdersService.cancelOrder's doc comment), added per this phase's
 * explicit instruction.
 * Admin order routes live in the admin module (§19), not here.
 */
@Controller('orders')
export class OrdersController {
  constructor(
    private readonly ordersService: OrdersService,
    private readonly invoicesService: InvoicesService,
  ) {}

  @Get()
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListOrdersQueryDto,
  ) {
    return this.ordersService.listOrdersForUser(user.id, query);
  }

  @Get(':id')
  async detail(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.ordersService.getOrderDetailForUser(user.id, id);
  }

  /** Owner-only. Lazily creates the invoice on first request for a paid
   * order, then returns the same one (idempotent). Phase 13.4. */
  @Get(':id/invoice')
  async invoice(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.invoicesService.getInvoiceForOrder(id, {
      userId: user.id,
      isAdmin: false,
    });
  }

  /** Owner-only. Answers an admin's "we need a new photo": swaps in a newly
   * uploaded file and returns the photo to the review queue. */
  @Post(':id/customizations/:customizationId/replace-photo')
  async replacePhoto(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('customizationId', ParseUUIDPipe) customizationId: string,
    @Body() dto: ReplacePhotoDto,
  ) {
    return this.ordersService.replaceCustomizationPhoto(
      user.id,
      id,
      customizationId,
      dto.uploadedFileId,
    );
  }

  @Post(':id/cancel')
  async cancel(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelOrderDto,
  ) {
    return this.ordersService.cancelOrder(user.id, id, dto);
  }
}

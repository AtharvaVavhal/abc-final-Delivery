import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ThrottleCheckout } from '../common/throttling/throttle.decorators';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { IDEMPOTENCY_KEY_HEADER } from '../common/constants/app.constants';
import { PaymentsService } from '../payments/payments.service';
import { CheckoutService } from './checkout.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { ValidateCheckoutDto } from './dto/validate-checkout.dto';

/**
 * Owns (§20): `POST /checkout/orders` (Auth, **required**
 * Idempotency-Key header) — converts the current user's cart into an
 * Order; `POST /checkout/orders/:id/retry-payment` (Auth, owner) — added
 * in Phase 6, §20 places it here rather than under /payments (reuses an
 * existing `razorpayOrderId` if set — same endpoint serves both the first
 * payment attempt on a fresh order and a genuine retry, see
 * PaymentsService.initiatePayment). `POST /checkout/validate` — reserved
 * by §20 since the original blueprint, never built until Phase 10's
 * Coupons half: a read-only pricing preview against the caller's current
 * cart with an optional couponCode, no Idempotency-Key (nothing is
 * created), never authoritative (PHASE-10-PROPOSAL.md §2.2).
 */
@ThrottleCheckout()
@Controller('checkout')
export class CheckoutController {
  constructor(
    private readonly checkoutService: CheckoutService,
    private readonly paymentsService: PaymentsService,
  ) {}

  @Post('validate')
  async validate(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ValidateCheckoutDto,
  ) {
    return this.checkoutService.previewCheckout(user.id, dto.couponCode);
  }

  @Post('orders')
  async createOrder(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateOrderDto,
    @Headers(IDEMPOTENCY_KEY_HEADER) idempotencyKey: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (!idempotencyKey || idempotencyKey.trim().length === 0) {
      throw new BadRequestException(
        `${IDEMPOTENCY_KEY_HEADER} header is required`,
      );
    }
    const { view, created } = await this.checkoutService.checkout(
      user.id,
      dto,
      idempotencyKey,
    );
    // 201 on genuine creation, 200 on an idempotent replay of an existing
    // key — same body either way (§20 "return the same result").
    res.status(created ? HttpStatus.CREATED : HttpStatus.OK);
    return view;
  }

  @Post('orders/:id/retry-payment')
  async retryPayment(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.paymentsService.initiatePayment(user.id, id);
  }
}

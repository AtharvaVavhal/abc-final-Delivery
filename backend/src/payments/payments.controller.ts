import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import {
  SkipHttpThrottle,
  ThrottleCheckout,
} from '../common/throttling/throttle.decorators';
import { PaymentsService } from './payments.service';
import { VerifyPaymentDto } from './dto/verify-payment.dto';

/**
 * Owns (§20): POST /payments/verify (Auth, owner, CAS-idempotent),
 * POST /payments/webhook (Signed — Razorpay signature, not JWT).
 * payment_attempts is never a standalone resource — nested only inside
 * order responses (§20, not implemented in this phase — Order reads are
 * Phase 7's GET /orders/:id).
 */
@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @ThrottleCheckout()
  @Post('verify')
  async verify(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: VerifyPaymentDto,
  ) {
    return this.paymentsService.verifyPayment(user.id, dto);
  }

  /**
   * Webhook secret is dashboard-configured at
   * `{BACKEND_URL}/api/v1/payments/webhook` — point the Razorpay dashboard
   * webhook here once RAZORPAY_WEBHOOK_SECRET is set.
   */
  @Public()
  @SkipHttpThrottle()
  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  async webhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-razorpay-signature') signature: string | undefined,
    @Headers('x-razorpay-event-id') eventId: string | undefined,
  ): Promise<{ received: true }> {
    if (!req.rawBody || !signature) {
      throw new BadRequestException('Missing webhook body or signature');
    }
    await this.paymentsService.receiveWebhook(
      req.rawBody.toString('utf8'),
      signature,
      eventId,
    );
    return { received: true };
  }

  /**
   * Phase 8 (P8-10) — merchant commerce webhook, one path per
   * `PaymentAccount` (P8-3 §9: "webhook routing is per-account, by path").
   * A separate route from `POST /payments/webhook` above (untouched, task
   * strict rule) — that one stays for any order that predates per-account
   * routing. Dashboard-configured per merchant at
   * `{BACKEND_URL}/api/v1/payments/webhook/{accountId}`, once that
   * account's own webhook secret is set via `POST /admin/payment-accounts/
   * :id/connect` (P8-5).
   */
  @Public()
  @SkipHttpThrottle()
  @Post('webhook/:accountId')
  @HttpCode(HttpStatus.OK)
  async merchantWebhook(
    @Param('accountId') accountId: string,
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-razorpay-signature') signature: string | undefined,
    @Headers('x-razorpay-event-id') eventId: string | undefined,
  ): Promise<{ received: true }> {
    if (!req.rawBody || !signature) {
      throw new BadRequestException('Missing webhook body or signature');
    }
    await this.paymentsService.receiveMerchantWebhook(
      accountId,
      req.rawBody.toString('utf8'),
      signature,
      eventId,
    );
    return { received: true };
  }
}

import {
  BadRequestException,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Req,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { Public } from '../common/decorators/public.decorator';
import { SkipHttpThrottle } from '../common/throttling/throttle.decorators';
import { BillingWebhookIngestionService } from './billing-webhook-ingestion.service';

/**
 * Phase 7 — D7 SaaS Billing Webhooks wave (docs/saas/DECISIONS.md P7-D3),
 * header names finalized per P7-D4/P7-D5 (Razorpay Subscriptions, the
 * ratified production SaaS billing provider). Owns POST /webhooks/billing
 * (Signed — provider signature, not JWT). Deliberately separate from
 * `PaymentsController`'s POST /payments/webhook (commerce) — frozen SaaS
 * invariant 6 / P7-D3 Part B: SaaS subscription billing and merchant
 * commerce payments are separate, never sharing a route, a table, or a
 * secret. This controller never imports anything from `payments/`; the
 * header NAMES happen to match Razorpay's merchant-commerce webhook
 * convention only because both are Razorpay products, not because any
 * code or secret is shared (see `RazorpayBillingProvider`'s own header
 * comment).
 *
 * `req.rawBody` is available with no extra configuration — `main.ts` sets
 * `rawBody: true` as a GLOBAL Nest option, not per-route.
 *
 * `X-Razorpay-Event-Id` (P7-D5 Part E — empirically confirmed present on
 * a real captured Razorpay Subscriptions webhook delivery; the JSON
 * payload body carries no id of its own) is extracted here and threaded
 * through to `BillingProvider.parseWebhook()` as `providerEventId` —
 * mirroring `PaymentsController`'s own `x-razorpay-event-id` extraction
 * for the merchant commerce webhook exactly, as an independent
 * implementation, never shared code. Optional at this layer (undefined is
 * passed straight through) since `BillingProvider.parseWebhook()`'s own
 * second parameter is optional and a non-Razorpay adapter (or
 * `FakeBillingProvider`) may not need it at all.
 */
@SkipHttpThrottle()
@Controller('webhooks/billing')
export class BillingWebhooksController {
  constructor(
    private readonly ingestionService: BillingWebhookIngestionService,
  ) {}

  @Public()
  @Post()
  @HttpCode(HttpStatus.OK)
  async receive(
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-razorpay-signature') signature: string | undefined,
    @Headers('x-razorpay-event-id') eventId: string | undefined,
  ): Promise<{ received: true }> {
    if (!req.rawBody || !signature) {
      throw new BadRequestException('Missing webhook body or signature');
    }
    await this.ingestionService.receiveWebhook(req.rawBody, signature, eventId);
    return { received: true };
  }
}

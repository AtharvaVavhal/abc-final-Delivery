import { Controller, Get, Param } from '@nestjs/common';
import { ThrottleCheckout } from '../common/throttling/throttle.decorators';
import { PostalLookupView } from './dto/postal-lookup-view.interface';
import { ParsePinCodePipe } from './pipes/pin-code.pipe';
import { PostalLookupService } from './postal.service';

/**
 * `GET /postal-codes/:postalCode` — PIN-code → City/District/State lookup
 * for the checkout shipping form.
 *
 * NOT `@Public()`: the global JwtAuthGuard applies, so only an
 * authenticated customer (the only caller — checkout is behind
 * ProtectedRoute) can reach it. That, plus the global IP throttler and the
 * strict 6-digit `:postalCode` param (no free-form input, no
 * client-supplied URL), is the whole abuse surface.
 *
 * The service returns a normalised, provider-agnostic body; a provider
 * outage surfaces as a 503 the frontend treats as "enter your address
 * manually", never as a checkout blocker.
 */
@ThrottleCheckout()
@Controller('postal-codes')
export class PostalController {
  constructor(private readonly postalLookup: PostalLookupService) {}

  @Get(':postalCode')
  lookup(
    @Param('postalCode', ParsePinCodePipe) postalCode: string,
  ): Promise<PostalLookupView> {
    return this.postalLookup.lookup(postalCode);
  }
}

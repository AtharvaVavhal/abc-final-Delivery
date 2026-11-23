import { Controller, Get, Param, ParseFloatPipe, Query } from '@nestjs/common';
import { ThrottleCheckout } from '../common/throttling/throttle.decorators';
import { AddressSuggestion } from './address-suggestion.util';
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

  /**
   * `GET /postal-codes/reverse?lat=&lng=` — PIN code for the customer's
   * current position ("Use my location" on the address form). Declared
   * before `:postalCode` so "reverse" is never parsed as a PIN.
   */
  @Get('reverse')
  reverse(
    @Query('lat', ParseFloatPipe) lat: number,
    @Query('lng', ParseFloatPipe) lng: number,
  ): Promise<{ postalCode: string } & AddressSuggestion> {
    return this.postalLookup.reverseLookup(lat, lng);
  }

  @Get(':postalCode')
  lookup(
    @Param('postalCode', ParsePinCodePipe) postalCode: string,
  ): Promise<PostalLookupView> {
    return this.postalLookup.lookup(postalCode);
  }
}

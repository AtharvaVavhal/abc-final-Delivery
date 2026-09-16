import { SkipThrottle, Throttle } from '@nestjs/throttler';
import {
  THROTTLE_AUTH,
  THROTTLE_CHECKOUT,
  THROTTLE_PUBLIC_READ,
} from './throttle.constants';

/** Login / register / password-reset. */
export const ThrottleAuth = (): MethodDecorator & ClassDecorator =>
  Throttle({ default: { ...THROTTLE_AUTH.default } });

/** Public storefront GET catalog/settings/reviews. */
export const ThrottlePublicRead = (): MethodDecorator & ClassDecorator =>
  Throttle({ default: { ...THROTTLE_PUBLIC_READ.default } });

/** Checkout, payment initiation/verify, shipping PIN lookup. */
export const ThrottleCheckout = (): MethodDecorator & ClassDecorator =>
  Throttle({ default: { ...THROTTLE_CHECKOUT.default } });

/**
 * Provider webhooks and health checks must not share a browser/IP budget.
 * `@SkipThrottle()` with no args skips the unnamed/`default` throttler.
 */
export const SkipHttpThrottle = (): MethodDecorator & ClassDecorator =>
  SkipThrottle();

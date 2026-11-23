import { Transform } from 'class-transformer';
import {
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  INDIAN_MOBILE_E164_REGEX,
  normalizeIndianMobile,
  PIN_CODE_REGEX,
} from '../../common/validation/indian-address.util';

/**
 * Shipping address is collected directly on this request, not read from
 * the user's profile — checkout owns collecting it, not validating profile
 * completeness. Snapshotted verbatim onto the Order row at creation time
 * (§11 "Immutable shipping snapshot") — a later profile edit never affects
 * an existing order.
 *
 * `shippingPhone` and `shippingPostalCode` carry real format rules as of
 * the Checkout Contact & PIN Validation phase — the frontend normalises
 * too, but the server never trusts that and re-normalises/re-validates
 * here (this is the authoritative gate: the ValidationPipe runs before the
 * order is ever created). Email is not collected here — order email is the
 * authenticated account's `user.email`, already `@IsEmail`-validated at
 * registration.
 */
export class CreateOrderDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(160)
  shippingRecipientName: string;

  /** Accepts `9876543210`, `+919876543210`, `+91 9876543210` (and common
   * separators); normalised to canonical E.164 `+91XXXXXXXXXX` before
   * validation and persistence. The `@Transform` runs first (class-
   * transformer), then `@Matches` checks the normalised value — a value
   * that can't be normalised is left as its trimmed original so the error
   * reads as a format problem, not an empty-field one. */
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string'
      ? (normalizeIndianMobile(value) ?? value.trim())
      : value,
  )
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  @Matches(INDIAN_MOBILE_E164_REGEX, {
    message: 'shippingPhone must be a valid Indian mobile number',
  })
  shippingPhone: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  shippingAddressLine1: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  shippingAddressLine2?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  shippingCity: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  shippingState: string;

  /** Exactly six digits (India). Format only — the postal-lookup endpoint,
   * not this DTO, decides whether the PIN actually exists. */
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  @Matches(PIN_CODE_REGEX, {
    message: 'shippingPostalCode must be a 6-digit PIN code',
  })
  shippingPostalCode: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  shippingCountry: string;

  /** Optional delivery pin — the customer chose to share it so the courier
   * can find the door. Both or neither; see normalizeDeliveryPin. */
  @IsOptional()
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(-90)
  @Max(90)
  shippingLatitude?: number;

  @IsOptional()
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(-180)
  @Max(180)
  shippingLongitude?: number;

  /** Optional (§2.2) — checked and claimed inside the same transaction as
   * order creation (CouponsService.validateAndClaim), never a separate
   * pre-check. Any case accepted; normalized to uppercase before lookup,
   * same as the admin-facing coupon code. */
  @IsOptional()
  @IsString()
  @MaxLength(50)
  @Matches(/^[A-Za-z0-9_-]+$/, {
    message:
      'couponCode must contain only letters, numbers, hyphens, and underscores',
  })
  couponCode?: string;
}

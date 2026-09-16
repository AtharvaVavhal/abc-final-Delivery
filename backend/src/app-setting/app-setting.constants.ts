import { Prisma } from '@prisma/client';

/**
 * The ONLY app_settings keys the storefront may read without
 * authentication. `GET /settings` and `GET /settings/:key` filter to this
 * list, so internal rows (e.g. the order-number / invoice-number counters)
 * are never publicly readable. Tax / invoice settings are admin-only and
 * are deliberately NOT here.
 */
export const PUBLIC_SETTING_KEYS = [
  'announcement_text',
  'hero_slides',
  'banners',
  'showcase_categories',
  // Store identity — the customer-facing store name the storefront chrome
  // renders (Header / hero / footer). `storeAdminName` is deliberately NOT
  // public: it is store-owner information, only ever read behind the admin
  // guard.
  'storeName',
  // Navbar / brand mark. Empty means the storefront uses the bundled
  // default (`/catalog/logo.png`) — never a fabricated third-party logo.
  'storeLogo',
  // Click-to-chat destination for the storefront WhatsApp button. Empty
  // means the button is hidden — never a fabricated number.
  'whatsappNumber',
  // Optional public contact / story / press media. Empty hides the matching
  // storefront surfaces — never fabricated from UvPixel or demo copy.
  'storeContactEmail',
  'storeContactPhone',
  'storeAddress',
  'brand_story',
  'featured_media',
] as const;

export type PublicSettingKey = (typeof PUBLIC_SETTING_KEYS)[number];

export function isPublicSettingKey(key: string): key is PublicSettingKey {
  return (PUBLIC_SETTING_KEYS as readonly string[]).includes(key);
}

export type AdminSettingKind =
  'money' | 'text' | 'boolean' | 'enum' | 'percent';

/**
 * Phase 5 W9 (decision D11) — the frozen ownership axis every configurable
 * setting belongs to, exactly one of the two. Drives which table
 * (`TenantSetting` / `StoreSetting`) `AppSettingService` reads and writes
 * for a given key — never inferred per-row, never client-selectable.
 */
export type SettingOwnership = 'TENANT' | 'STORE';

export interface AdminSettingDefinition {
  key: string;
  label: string;
  description: string;
  kind: AdminSettingKind;
  ownership: SettingOwnership;
  /** Returned when the row does not exist yet — never a fabricated value. */
  default: string;
  /** Allowed values for `kind: 'enum'`. */
  options?: readonly string[];
  /** Marked true for values that MUST be supplied by the client/accountant
   * and are shipped blank — surfaced in the admin UI as "pending". */
  pendingClientInput?: boolean;
}

/**
 * Phase 5 W9 (decision D11) — ownership for PUBLIC_SETTING_KEYS that have
 * no admin-write definition yet (`banners` / `showcase_categories`).
 * `hero_slides` is STORE-owned and now has an admin-write definition.
 */
export const PUBLIC_ONLY_SETTING_OWNERSHIP: Readonly<
  Record<string, SettingOwnership>
> = {
  banners: 'STORE',
  showcase_categories: 'STORE',
};

interface NormalizeOk {
  valid: true;
  value: string;
}
interface NormalizeErr {
  valid: false;
  error: string;
}
export type NormalizeResult = NormalizeOk | NormalizeErr;

const MAX_SHIPPING_FEE_RUPEES = 100000;
const MAX_ANNOUNCEMENT_LENGTH = 200;
const MAX_NAME_LENGTH = 200;
const MAX_ADDRESS_LENGTH = 500;
const MAX_BRAND_STORY_LENGTH = 4000;
const MAX_FEATURED_MEDIA_LENGTH = 8000;
const MAX_EMAIL_LENGTH = 120;
const MAX_PHONE_DISPLAY_LENGTH = 30;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_STORE_NAME_LENGTH = 60;
const MAX_STORE_ADMIN_NAME_LENGTH = 120;
const MAX_STORE_LOGO_LENGTH = 2048;
export const STORE_LOGO_DEFAULT = '/catalog/logo.png';
export const MAX_HERO_SLIDES = 8;
const MAX_HERO_SLIDES_JSON_LENGTH = 16000;
const MAX_HERO_HEADLINE_LENGTH = 80;
const MAX_HERO_SUBTEXT_LENGTH = 240;
const MAX_HERO_CTA_TEXT_LENGTH = 40;
const MAX_HERO_CTA_LINK_LENGTH = 300;
const GSTIN_PATTERN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][A-Z0-9]Z[A-Z0-9]$/;
const INVOICE_PREFIX_PATTERN = /^[A-Z0-9/-]{1,16}$/;

function normalizeMoney(raw: string): NormalizeResult {
  const trimmed = raw.trim();
  if (trimmed === '') {
    return {
      valid: false,
      error: 'A shipping fee is required (use 0 for free shipping)',
    };
  }
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) {
    return {
      valid: false,
      error:
        'Shipping fee must be a non-negative amount with at most 2 decimal places',
    };
  }
  let decimal: Prisma.Decimal;
  try {
    decimal = new Prisma.Decimal(trimmed);
  } catch {
    return { valid: false, error: 'Shipping fee is not a valid amount' };
  }
  if (decimal.isNegative()) {
    return { valid: false, error: 'Shipping fee cannot be negative' };
  }
  if (decimal.greaterThan(MAX_SHIPPING_FEE_RUPEES)) {
    return {
      valid: false,
      error: `Shipping fee cannot exceed ${MAX_SHIPPING_FEE_RUPEES}`,
    };
  }
  return { valid: true, value: decimal.toFixed(2) };
}

function boundedText(max: number, label: string) {
  return (raw: string): NormalizeResult => {
    const trimmed = raw.trim();
    if (trimmed.length > max) {
      return {
        valid: false,
        error: `${label} cannot exceed ${max} characters`,
      };
    }
    return { valid: true, value: trimmed };
  };
}

/** The customer-facing store name. Required — the storefront always shows
 * a name, and an empty value would blank the header / hero / footer. */
function normalizeStoreName(raw: string): NormalizeResult {
  const trimmed = raw.trim();
  if (trimmed === '') {
    return { valid: false, error: 'Store name is required' };
  }
  if (trimmed.length > MAX_STORE_NAME_LENGTH) {
    return {
      valid: false,
      error: `Store name cannot exceed ${MAX_STORE_NAME_LENGTH} characters`,
    };
  }
  return { valid: true, value: trimmed };
}

/** Navbar logo URL. Empty is allowed (storefront falls back to the bundled
 * default). Must be an http(s) URL or a same-origin site path. */
function normalizeStoreLogo(raw: string): NormalizeResult {
  const trimmed = raw.trim();
  if (trimmed === '') {
    return { valid: true, value: '' };
  }
  if (trimmed.length > MAX_STORE_LOGO_LENGTH) {
    return {
      valid: false,
      error: `Logo URL cannot exceed ${MAX_STORE_LOGO_LENGTH} characters`,
    };
  }
  const lower = trimmed.toLowerCase();
  if (
    lower.startsWith('javascript:') ||
    lower.startsWith('data:') ||
    lower.startsWith('vbscript:')
  ) {
    return { valid: false, error: 'Logo must be an http(s) URL or a site path' };
  }
  if (!/^https?:\/\//i.test(trimmed) && !trimmed.startsWith('/')) {
    return {
      valid: false,
      error: 'Logo must be an http(s) URL or a site path',
    };
  }
  return { valid: true, value: trimmed };
}

function isSafeHttpOrSitePath(value: string): boolean {
  const lower = value.toLowerCase();
  if (
    lower.startsWith('javascript:') ||
    lower.startsWith('data:') ||
    lower.startsWith('vbscript:')
  ) {
    return false;
  }
  return /^https?:\/\//i.test(value) || value.startsWith('/');
}

/** Homepage hero carousel. Empty means the storefront hides the carousel
 * rather than inventing slides. */
function normalizeHeroSlides(raw: string): NormalizeResult {
  const trimmed = raw.trim();
  if (trimmed === '') {
    return { valid: true, value: '' };
  }
  if (trimmed.length > MAX_HERO_SLIDES_JSON_LENGTH) {
    return {
      valid: false,
      error: `Hero slides cannot exceed ${MAX_HERO_SLIDES_JSON_LENGTH} characters`,
    };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return { valid: false, error: 'Hero slides must be valid JSON' };
  }
  if (!Array.isArray(parsed)) {
    return { valid: false, error: 'Hero slides must be a JSON array' };
  }
  if (parsed.length > MAX_HERO_SLIDES) {
    return {
      valid: false,
      error: `Hero cannot have more than ${MAX_HERO_SLIDES} slides`,
    };
  }
  const slides: Array<{
    imageUrl: string;
    headline: string;
    subtext: string;
    ctaText: string;
    ctaLink: string;
  }> = [];
  for (const item of parsed) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return { valid: false, error: 'Each hero slide must be an object' };
    }
    const record = item as Record<string, unknown>;
    const imageUrl = typeof record.imageUrl === 'string' ? record.imageUrl.trim() : '';
    const headline = typeof record.headline === 'string' ? record.headline.trim() : '';
    const subtext = typeof record.subtext === 'string' ? record.subtext.trim() : '';
    const ctaText = typeof record.ctaText === 'string' ? record.ctaText.trim() : '';
    const ctaLink = typeof record.ctaLink === 'string' ? record.ctaLink.trim() : '';
    if (!imageUrl || !isSafeHttpOrSitePath(imageUrl)) {
      return {
        valid: false,
        error: 'Each slide needs an image that is an http(s) URL or a site path',
      };
    }
    if (!headline) {
      return { valid: false, error: 'Each slide needs a headline' };
    }
    if (headline.length > MAX_HERO_HEADLINE_LENGTH) {
      return {
        valid: false,
        error: `Headline cannot exceed ${MAX_HERO_HEADLINE_LENGTH} characters`,
      };
    }
    if (subtext.length > MAX_HERO_SUBTEXT_LENGTH) {
      return {
        valid: false,
        error: `Subtext cannot exceed ${MAX_HERO_SUBTEXT_LENGTH} characters`,
      };
    }
    if (ctaText.length > MAX_HERO_CTA_TEXT_LENGTH) {
      return {
        valid: false,
        error: `Button text cannot exceed ${MAX_HERO_CTA_TEXT_LENGTH} characters`,
      };
    }
    if (ctaLink.length > MAX_HERO_CTA_LINK_LENGTH) {
      return {
        valid: false,
        error: `Button link cannot exceed ${MAX_HERO_CTA_LINK_LENGTH} characters`,
      };
    }
    if (ctaLink && !isSafeHttpOrSitePath(ctaLink)) {
      return {
        valid: false,
        error: 'Button link must be an http(s) URL or a site path',
      };
    }
    if ((ctaText && !ctaLink) || (!ctaText && ctaLink)) {
      return {
        valid: false,
        error: 'Button text and link must both be set, or both left blank',
      };
    }
    slides.push({ imageUrl, headline, subtext, ctaText, ctaLink });
  }
  return { valid: true, value: JSON.stringify(slides) };
}

/** Storefront click-to-chat number. Empty hides the button. Canonical
 * stored form is `91` + 10-digit Indian mobile (wa.me digits, no `+`). */
function normalizeWhatsappNumber(raw: string): NormalizeResult {
  const trimmed = raw.trim();
  if (trimmed === '') {
    return { valid: true, value: '' };
  }
  const compact = trimmed.replace(/[\s\-().+]/g, '');
  let digits = compact;
  if (digits.startsWith('91') && digits.length === 12) {
    digits = digits.slice(2);
  } else if (digits.startsWith('0') && digits.length === 11) {
    digits = digits.slice(1);
  }
  if (!/^[6-9]\d{9}$/.test(digits)) {
    return {
      valid: false,
      error: 'Enter a valid 10-digit Indian mobile number for WhatsApp',
    };
  }
  return { valid: true, value: `91${digits}` };
}

function normalizeOptionalEmail(raw: string): NormalizeResult {
  const trimmed = raw.trim();
  if (trimmed === '') return { valid: true, value: '' };
  if (trimmed.length > MAX_EMAIL_LENGTH) {
    return {
      valid: false,
      error: `Email cannot exceed ${MAX_EMAIL_LENGTH} characters`,
    };
  }
  if (!EMAIL_PATTERN.test(trimmed)) {
    return { valid: false, error: 'Enter a valid email address' };
  }
  return { valid: true, value: trimmed.toLowerCase() };
}

function normalizeOptionalPhoneDisplay(raw: string): NormalizeResult {
  const trimmed = raw.trim();
  if (trimmed === '') return { valid: true, value: '' };
  if (trimmed.length > MAX_PHONE_DISPLAY_LENGTH) {
    return {
      valid: false,
      error: `Phone cannot exceed ${MAX_PHONE_DISPLAY_LENGTH} characters`,
    };
  }
  if (!/^[+\d][\d\s().-]{6,}$/.test(trimmed)) {
    return {
      valid: false,
      error: 'Enter a phone number using digits, spaces, or +, -, ()',
    };
  }
  return { valid: true, value: trimmed };
}

/** One http(s) or same-origin path per line. Stored as a JSON string array. */
function normalizeFeaturedMedia(raw: string): NormalizeResult {
  const trimmed = raw.trim();
  if (trimmed === '') return { valid: true, value: '' };
  if (trimmed.length > MAX_FEATURED_MEDIA_LENGTH) {
    return {
      valid: false,
      error: `Featured media cannot exceed ${MAX_FEATURED_MEDIA_LENGTH} characters`,
    };
  }
  let urls: string[] = [];
  if (trimmed.startsWith('[')) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (!Array.isArray(parsed)) {
        return { valid: false, error: 'Featured media JSON must be an array' };
      }
      urls = parsed.map((item) => {
        if (typeof item === 'string') return item.trim();
        if (
          item &&
          typeof item === 'object' &&
          'imageUrl' in item &&
          typeof (item as { imageUrl: unknown }).imageUrl === 'string'
        ) {
          return (item as { imageUrl: string }).imageUrl.trim();
        }
        return '';
      });
    } catch {
      return { valid: false, error: 'Featured media JSON is not valid' };
    }
  } else {
    urls = trimmed.split(/\r?\n/).map((line) => line.trim());
  }
  const cleaned = urls.filter(Boolean);
  if (cleaned.length > 20) {
    return { valid: false, error: 'Featured media cannot list more than 20 URLs' };
  }
  for (const url of cleaned) {
    if (!/^https?:\/\//i.test(url) && !url.startsWith('/')) {
      return {
        valid: false,
        error: 'Each featured media item must be an http(s) URL or a site path',
      };
    }
  }
  return { valid: true, value: JSON.stringify(cleaned) };
}

function normalizeBoolean(raw: string): NormalizeResult {
  const v = raw.trim().toLowerCase();
  if (v !== 'true' && v !== 'false') {
    return { valid: false, error: 'Value must be "true" or "false"' };
  }
  return { valid: true, value: v };
}

/** GST percentage, 0–100, up to 2 decimals. Only meaningful once tax is
 * enabled; the client must confirm the actual rate. */
function normalizePercent(raw: string): NormalizeResult {
  const trimmed = raw.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) {
    return {
      valid: false,
      error: 'Rate must be a number between 0 and 100 with at most 2 decimals',
    };
  }
  const decimal = new Prisma.Decimal(trimmed);
  if (decimal.isNegative() || decimal.greaterThan(100)) {
    return { valid: false, error: 'Rate must be between 0 and 100' };
  }
  return { valid: true, value: decimal.toFixed(2) };
}

/** Structural GST identification-number check only — never a checksum,
 * never a fabricated value. Empty is allowed (pending client input). */
function normalizeGstin(raw: string): NormalizeResult {
  const v = raw.trim().toUpperCase();
  if (v === '') {
    return { valid: true, value: '' };
  }
  if (!GSTIN_PATTERN.test(v)) {
    return {
      valid: false,
      error:
        'GSTIN must be 15 characters in the standard format (e.g. 22AAAAA0000A1Z5)',
    };
  }
  return { valid: true, value: v };
}

function normalizeInvoicePrefix(raw: string): NormalizeResult {
  const v = raw.trim().toUpperCase();
  if (!INVOICE_PREFIX_PATTERN.test(v)) {
    return {
      valid: false,
      error:
        'Invoice prefix must be 1–16 characters using A–Z, 0–9, "-" or "/"',
    };
  }
  return { valid: true, value: v };
}

/** Every tax pricing mode the calculation engine (TaxService) supports. */
export const TAX_MODE_OPTIONS = ['INCLUSIVE', 'EXCLUSIVE'] as const;

/**
 * Phase 13.4 hardening — tax-EXCLUSIVE pricing increases the customer /
 * Razorpay total, and the client has NOT formally confirmed
 * inclusive-vs-exclusive pricing. Until they do, EXCLUSIVE cannot be
 * selected through the normal admin settings API/UI: a PATCH to
 * `tax.pricingMode=EXCLUSIVE` is rejected with a 400, and the setting's
 * dropdown only offers INCLUSIVE.
 *
 * The EXCLUSIVE calculation in TaxService and all its tests are kept
 * intact. To enable it once the client confirms: add `'EXCLUSIVE'` back
 * to `ADMIN_SETTABLE_TAX_MODES` below (one line) — nothing else changes.
 */
export const ADMIN_SETTABLE_TAX_MODES = ['INCLUSIVE'] as const;

function normalizeTaxPricingMode(raw: string): NormalizeResult {
  const v = raw.trim();
  if ((ADMIN_SETTABLE_TAX_MODES as readonly string[]).includes(v)) {
    return { valid: true, value: v };
  }
  if (v === 'EXCLUSIVE') {
    return {
      valid: false,
      error:
        'Tax-exclusive pricing is not available: it would increase customer and Razorpay totals and requires explicit business confirmation of inclusive-vs-exclusive pricing. Contact engineering to enable it.',
    };
  }
  return {
    valid: false,
    error: `Value must be one of: ${ADMIN_SETTABLE_TAX_MODES.join(', ')}`,
  };
}

const NORMALIZERS: Record<string, (raw: string) => NormalizeResult> = {
  shippingFeeFlat: normalizeMoney,
  announcement_text: boundedText(MAX_ANNOUNCEMENT_LENGTH, 'Announcement text'),
  storeName: normalizeStoreName,
  storeLogo: normalizeStoreLogo,
  // Store-owner display name — optional (the User model has no name column
  // to seed it from), only length-bounded. Same rule shape as the invoice
  // seller-identity fields.
  storeAdminName: boundedText(MAX_STORE_ADMIN_NAME_LENGTH, 'Store admin name'),
  whatsappNumber: normalizeWhatsappNumber,
  storeContactEmail: normalizeOptionalEmail,
  storeContactPhone: normalizeOptionalPhoneDisplay,
  storeAddress: boundedText(MAX_ADDRESS_LENGTH, 'Store address'),
  brand_story: boundedText(MAX_BRAND_STORY_LENGTH, 'Brand story'),
  featured_media: normalizeFeaturedMedia,
  hero_slides: normalizeHeroSlides,
  'tax.enabled': normalizeBoolean,
  'tax.pricingMode': normalizeTaxPricingMode,
  'tax.ratePercent': normalizePercent,
  'invoice.numberPrefix': normalizeInvoicePrefix,
  'invoice.sellerLegalName': boundedText(MAX_NAME_LENGTH, 'Legal name'),
  'invoice.sellerAddress': boundedText(MAX_ADDRESS_LENGTH, 'Address'),
  'invoice.sellerGstin': normalizeGstin,
  'invoice.sellerState': boundedText(MAX_NAME_LENGTH, 'State'),
};

export const ADMIN_SETTING_DEFINITIONS: readonly AdminSettingDefinition[] = [
  {
    key: 'storeName',
    ownership: 'STORE',
    label: 'Store name',
    description:
      'The name customers see for this store — in the header, the homepage hero and the footer. Required.',
    kind: 'text',
    default: 'AB Creations',
  },
  {
    key: 'storeLogo',
    ownership: 'STORE',
    label: 'Store logo',
    description:
      'Shown in the storefront navbar. Upload a PNG or JPEG. Leave blank or reset to use the bundled AB Creations mark.',
    kind: 'text',
    default: STORE_LOGO_DEFAULT,
  },
  {
    key: 'storeAdminName',
    ownership: 'STORE',
    label: 'Store admin name',
    description:
      'Display name for the store owner / administrator. Optional — used where store-owner attribution is needed. Never shown to customers unless a specific context calls for it.',
    kind: 'text',
    default: '',
  },
  {
    key: 'shippingFeeFlat',
    ownership: 'STORE',
    label: 'Flat shipping fee (₹)',
    description:
      'Charged once per order at checkout. Use 0 for free shipping. The server always recomputes the order total from this value inside the checkout transaction — it is never taken from the client.',
    kind: 'money',
    default: '0.00',
  },
  {
    key: 'announcement_text',
    ownership: 'STORE',
    label: 'Announcement bar text',
    description:
      'Shown in the storefront announcement bar. Leave blank to hide the bar.',
    kind: 'text',
    default: '',
  },
  {
    key: 'whatsappNumber',
    ownership: 'STORE',
    label: 'WhatsApp number',
    description:
      'Customer click-to-chat number shown as the storefront WhatsApp button. Leave blank to hide the button. Use a 10-digit Indian mobile; country code 91 is added automatically.',
    kind: 'text',
    default: '',
  },
  {
    key: 'storeContactEmail',
    ownership: 'STORE',
    label: 'Store contact email',
    description:
      'Shown in the storefront footer and contact page. Leave blank to hide — never guessed.',
    kind: 'text',
    default: '',
  },
  {
    key: 'storeContactPhone',
    ownership: 'STORE',
    label: 'Store contact phone',
    description:
      'Public phone number shown in the footer and contact page. Leave blank to hide.',
    kind: 'text',
    default: '',
  },
  {
    key: 'storeAddress',
    ownership: 'STORE',
    label: 'Store address',
    description:
      'Public studio/office address. Leave blank to hide until the client supplies it.',
    kind: 'text',
    default: '',
  },
  {
    key: 'brand_story',
    ownership: 'STORE',
    label: 'Brand story',
    description:
      'Homepage “Our Story” copy. Leave blank to use the general AB Creations description already on the About page — do not invent founder claims.',
    kind: 'text',
    default: '',
  },
  {
    key: 'featured_media',
    ownership: 'STORE',
    label: 'Got Featured media',
    description:
      'One image URL per line (or a JSON array) for the homepage press/media row. Leave blank to hide the section. Do not paste unrelated brand assets.',
    kind: 'text',
    default: '',
  },
  {
    key: 'hero_slides',
    ownership: 'STORE',
    label: 'Homepage hero slides',
    description:
      'Images and copy for the homepage banner. Add, replace, or delete slides here. An empty list hides the carousel. PNG or JPEG, up to 8 slides.',
    kind: 'text',
    default: '',
  },
  {
    key: 'tax.enabled',
    ownership: 'TENANT',
    label: 'GST / tax enabled',
    description:
      'When off (default), every order records tax = ₹0.00 and the customer total is unchanged. Turn on ONLY after the client confirms the applicable GST rate. Prices are treated as tax-inclusive unless the pricing mode below says otherwise.',
    kind: 'boolean',
    default: 'false',
  },
  {
    key: 'tax.pricingMode',
    ownership: 'TENANT',
    label: 'Tax pricing mode',
    description:
      'INCLUSIVE (per the app blueprint §4): displayed prices already include GST and the GST amount is extracted from within the total — the customer total never changes. Tax-EXCLUSIVE pricing (GST added on top, total increases) is implemented but LOCKED pending explicit client confirmation of inclusive-vs-exclusive pricing; it cannot be selected here.',
    kind: 'enum',
    options: ADMIN_SETTABLE_TAX_MODES,
    default: 'INCLUSIVE',
  },
  {
    key: 'tax.ratePercent',
    ownership: 'TENANT',
    label: 'Combined GST rate (%)',
    description:
      'Single combined GST percentage applied to the goods value (subtotal − discount). PENDING CLIENT CONFIRMATION — do not set a guessed value. The CGST/SGST/IGST split and place-of-supply rules are NOT implemented and require a separate business decision.',
    kind: 'percent',
    default: '0.00',
    pendingClientInput: true,
  },
  {
    key: 'invoice.numberPrefix',
    ownership: 'TENANT',
    label: 'Invoice number prefix',
    description:
      'Prepended to a dedicated, gap-free invoice sequence (e.g. "INV-" → INV-000001). The statutory format (financial-year series, etc.) is PENDING CLIENT CONFIRMATION — this is a technical placeholder.',
    kind: 'text',
    default: 'INV-',
    pendingClientInput: true,
  },
  {
    key: 'invoice.sellerLegalName',
    ownership: 'TENANT',
    label: 'Seller legal name (on invoice)',
    description:
      'Registered business name printed on invoices. PENDING CLIENT INPUT — left blank until supplied; invoices show a "seller details pending" note while empty.',
    kind: 'text',
    default: '',
    pendingClientInput: true,
  },
  {
    key: 'invoice.sellerAddress',
    ownership: 'TENANT',
    label: 'Seller registered address (on invoice)',
    description:
      'Registered place of business printed on invoices. PENDING CLIENT INPUT.',
    kind: 'text',
    default: '',
    pendingClientInput: true,
  },
  {
    key: 'invoice.sellerGstin',
    ownership: 'TENANT',
    label: 'Seller GSTIN (on invoice)',
    description:
      'The business GST identification number. PENDING CLIENT INPUT — validated for format only if entered, never fabricated. Without it an invoice is not a valid tax invoice.',
    kind: 'text',
    default: '',
    pendingClientInput: true,
  },
  {
    key: 'invoice.sellerState',
    ownership: 'TENANT',
    label: 'Seller state / place of supply',
    description:
      'Seller state for place-of-supply determination. PENDING CLIENT INPUT — intra/inter-state (CGST+SGST vs IGST) logic is not implemented.',
    kind: 'text',
    default: '',
    pendingClientInput: true,
  },
];

export function getAdminSettingDefinition(
  key: string,
): AdminSettingDefinition | undefined {
  return ADMIN_SETTING_DEFINITIONS.find((d) => d.key === key);
}

/**
 * Phase 5 W9 (decision D11) — the single source of truth for which table
 * (`TenantSetting` / `StoreSetting`) a key belongs to. Checks the
 * admin-configurable definitions first, then the 3 public-only keys with
 * no admin-write definition. Returns `undefined` for any key outside the
 * frozen D11 classification (e.g. `order_number_counter`,
 * `invoice_number_counter` — deliberately unclassified; see the W9
 * implementation report).
 */
export function getSettingOwnership(key: string): SettingOwnership | undefined {
  return (
    getAdminSettingDefinition(key)?.ownership ??
    PUBLIC_ONLY_SETTING_OWNERSHIP[key]
  );
}

export function normalizeAdminSettingValue(
  key: string,
  raw: string,
): NormalizeResult {
  const normalize = NORMALIZERS[key];
  if (!normalize) {
    return { valid: false, error: `"${key}" is not an administrable setting` };
  }
  return normalize(raw);
}

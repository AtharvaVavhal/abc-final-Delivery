import {
  CustomizationField,
  CustomizationFieldType,
  Prisma,
  SurchargeType,
} from '@prisma/client';

/**
 * What a customer submits for one field, pre-persistence — the same shape
 * `cart_item_customizations`/`order_item_customizations` snapshot (§15):
 * exactly one of textValue/uploadedFileId is meaningful per field type.
 */
export interface CustomizationSubmission {
  textValue?: string;
  uploadedFileId?: string;
}

export interface CustomizationValidationResult {
  valid: boolean;
  error?: string;
  surchargePaise: bigint;
}

interface FieldConstraints {
  maxLength?: number;
  allowedFormats?: string[];
  maxFileSizeMb?: number;
  options?: string[];
}

const FILE_FIELD_TYPES: ReadonlySet<CustomizationFieldType> = new Set([
  CustomizationFieldType.LOGO_UPLOAD,
  CustomizationFieldType.IMAGE_UPLOAD,
  CustomizationFieldType.DESIGN_FILE_UPLOAD,
]);

export function isFileFieldType(type: CustomizationFieldType): boolean {
  return FILE_FIELD_TYPES.has(type);
}

/** Cloudinary's upload response always reports a JPEG's format as `jpg`,
 * never `jpeg` — but admins configuring a field's `allowedFormats` (or a
 * customer's own file extension, checked client-side) commonly write
 * `jpeg`. Without this, any field whose constraints list only one spelling
 * rejects every real JPEG upload, regardless of which spelling the file
 * itself used, since Cloudinary's returned format never matches. */
export function normalizeImageFormat(format: string): string {
  return format.toLowerCase() === 'jpg' ? 'jpeg' : format.toLowerCase();
}

export function formatMatchesAllowed(
  format: string,
  allowedFormats: readonly string[],
): boolean {
  const normalized = normalizeImageFormat(format);
  return allowedFormats.some((f) => normalizeImageFormat(f) === normalized);
}

export function parseFieldConstraints(
  constraints: Prisma.JsonValue | null,
): FieldConstraints {
  if (
    !constraints ||
    typeof constraints !== 'object' ||
    Array.isArray(constraints)
  ) {
    return {};
  }
  return constraints;
}

/** rupees (Decimal, major units) → paise (bigint), decimal-safe (§11). */
function decimalRupeesToPaise(amount: Prisma.Decimal): bigint {
  const paise = new Prisma.Decimal(amount)
    .times(100)
    .toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP);
  return BigInt(paise.toFixed(0));
}

function computeSurchargePaise(
  field: CustomizationField,
  textValue: string | undefined,
): bigint {
  switch (field.surchargeType) {
    case SurchargeType.NONE:
      return 0n;
    case SurchargeType.FLAT:
      return decimalRupeesToPaise(field.surchargeAmount);
    case SurchargeType.PER_CHARACTER:
      return (
        decimalRupeesToPaise(field.surchargeAmount) *
        BigInt(textValue?.length ?? 0)
      );
    default:
      return 0n;
  }
}

function invalid(error: string): CustomizationValidationResult {
  return { valid: false, error, surchargePaise: 0n };
}

/**
 * Pure, unit-testable core: required-ness, type-shape (text vs. file),
 * text constraints (maxLength/options), and surcharge math. Does NOT touch
 * the database — file existence/ownership/format/size (which need the
 * `uploaded_files` row) are layered on by
 * CustomizationValidationService.validate, the version Cart (Phase 4)
 * should actually call.
 */
export function validateCustomizationFieldShape(
  field: CustomizationField,
  submission: CustomizationSubmission,
): CustomizationValidationResult {
  const constraints = parseFieldConstraints(field.constraints);
  const hasText =
    typeof submission.textValue === 'string' &&
    submission.textValue.trim().length > 0;
  const hasFile =
    typeof submission.uploadedFileId === 'string' &&
    submission.uploadedFileId.length > 0;

  if (!hasText && !hasFile) {
    if (field.isRequired) {
      return invalid(`${field.label} is required`);
    }
    return { valid: true, surchargePaise: 0n };
  }

  if (isFileFieldType(field.type)) {
    if (!hasFile) {
      return invalid(`${field.label} expects an uploaded file`);
    }
    if (hasText) {
      return invalid(`${field.label} does not accept a text value`);
    }
    return {
      valid: true,
      surchargePaise: computeSurchargePaise(field, undefined),
    };
  }

  // Text-bearing types: TEXT, INSTRUCTIONS, COLOR_SELECT.
  if (!hasText) {
    return invalid(`${field.label} expects a text value`);
  }
  if (hasFile) {
    return invalid(`${field.label} does not accept an uploaded file`);
  }
  const textValue = submission.textValue!.trim();

  if (
    constraints.maxLength !== undefined &&
    textValue.length > constraints.maxLength
  ) {
    return invalid(
      `${field.label} must be at most ${constraints.maxLength} characters`,
    );
  }
  if (
    field.type === CustomizationFieldType.COLOR_SELECT &&
    constraints.options &&
    constraints.options.length > 0 &&
    !constraints.options.includes(textValue)
  ) {
    return invalid(
      `${field.label} must be one of: ${constraints.options.join(', ')}`,
    );
  }

  return {
    valid: true,
    surchargePaise: computeSurchargePaise(field, textValue),
  };
}

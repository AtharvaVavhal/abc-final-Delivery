import { BadGatewayException } from '@nestjs/common';

/** Stable Store Admin / API message when Cloudinary forbids asset create. */
export const CLOUDINARY_MISSING_CREATE_MESSAGE =
  'Cloudinary rejected the upload: this API key is missing create/upload permission. In Cloudinary Console → Settings → API Keys, assign a role that includes Upload assets, then restart the backend.';

const CLOUDINARY_CREDENTIALS_REJECTED_MESSAGE =
  'Cloudinary rejected the upload: the configured API credentials were not accepted.';

const CLOUDINARY_UPLOAD_FAILED_MESSAGE = 'Cloudinary upload failed';

interface CloudinaryErrorShape {
  message?: unknown;
  http_code?: unknown;
  name?: unknown;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * Cloudinary's Node SDK often invokes the upload callback with a plain
 * object `{ message, http_code, name }` rather than an Error — and HTTP 403
 * is not in the SDK's parsed status list, so the body is discarded as
 * `UnexpectedResponse`. Unwrap that shape without assuming `instanceof Error`.
 */
export function unwrapCloudinaryError(error: unknown): CloudinaryErrorShape {
  const record = asRecord(error);
  if (!record) {
    return {};
  }
  const nested = asRecord(record.error);
  if (nested && (nested.message != null || nested.http_code != null)) {
    return nested;
  }
  return record;
}

export function cloudinaryUploadException(error: unknown): BadGatewayException {
  const unwrapped = unwrapCloudinaryError(error);
  const httpCode =
    typeof unwrapped.http_code === 'number' ? unwrapped.http_code : undefined;
  const rawMessage =
    typeof unwrapped.message === 'string' ? unwrapped.message : '';
  const name = typeof unwrapped.name === 'string' ? unwrapped.name : '';

  const looksLikeMissingCreate =
    httpCode === 403 ||
    name === 'UnexpectedResponse' ||
    /unexpected status code - 403/i.test(rawMessage) ||
    /missing permissions/i.test(rawMessage);

  if (looksLikeMissingCreate) {
    return new BadGatewayException(CLOUDINARY_MISSING_CREATE_MESSAGE);
  }
  if (httpCode === 401 || /invalid signature|invalid credentials/i.test(rawMessage)) {
    return new BadGatewayException(CLOUDINARY_CREDENTIALS_REJECTED_MESSAGE);
  }
  if (rawMessage.trim() && !/api_secret|apiSecret/i.test(rawMessage)) {
    return new BadGatewayException(rawMessage.trim());
  }
  return new BadGatewayException(CLOUDINARY_UPLOAD_FAILED_MESSAGE);
}

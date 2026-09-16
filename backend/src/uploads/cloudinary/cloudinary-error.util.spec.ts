import { BadGatewayException } from '@nestjs/common';
import {
  CLOUDINARY_MISSING_CREATE_MESSAGE,
  cloudinaryUploadException,
  unwrapCloudinaryError,
} from './cloudinary-error.util';

describe('cloudinaryUploadException', () => {
  it('maps SDK UnexpectedResponse 403 (unparsed body) to missing-create 502', () => {
    const exception = cloudinaryUploadException({
      message: 'Server returned unexpected status code - 403',
      http_code: 403,
      name: 'UnexpectedResponse',
    });
    expect(exception).toBeInstanceOf(BadGatewayException);
    expect(exception.getStatus()).toBe(502);
    expect(exception.message).toBe(CLOUDINARY_MISSING_CREATE_MESSAGE);
  });

  it('maps Cloudinary missing-permissions body to missing-create 502', () => {
    const exception = cloudinaryUploadException({
      message:
        '[prodenv:abc] Request forbidden due to missing permissions (actions=["create"])',
      http_code: 403,
    });
    expect(exception.message).toBe(CLOUDINARY_MISSING_CREATE_MESSAGE);
  });

  it('unwraps the SDK { error: ... } wrapper', () => {
    expect(
      unwrapCloudinaryError({
        error: { message: 'Server returned unexpected status code - 403', http_code: 403 },
      }),
    ).toEqual({
      message: 'Server returned unexpected status code - 403',
      http_code: 403,
    });
  });
});

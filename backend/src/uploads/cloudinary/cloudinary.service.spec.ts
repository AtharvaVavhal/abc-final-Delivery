import { Logger, ServiceUnavailableException } from '@nestjs/common';
import { CloudinaryService } from './cloudinary.service';

function build(cloudinary: Record<string, string>) {
  const config = { get: () => cloudinary };
  const service = new CloudinaryService(config as never);
  service.onModuleInit();
  return service;
}

describe('CloudinaryService when not configured', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it('answers an upload with a clear 503, not a bare 500', async () => {
    const service = build({ cloudName: '', apiKey: '', apiSecret: '' });
    await expect(
      service.uploadBuffer(Buffer.from('x'), {
        purpose: 'customization',
        userId: 'u1',
        deliveryType: 'authenticated',
      }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('keeps the operator detail (variable names) out of the response, in the log', async () => {
    const error = jest.spyOn(Logger.prototype, 'error');
    const service = build({ cloudName: 'x', apiKey: '', apiSecret: '' });
    const attempt = service.uploadBuffer(Buffer.from('x'), {
      purpose: 'customization',
      userId: 'u1',
      deliveryType: 'authenticated',
    });
    await expect(attempt).rejects.toThrow(/temporarily unavailable/);
    await expect(attempt).rejects.not.toThrow(/CLOUDINARY_API_KEY/);
    expect(JSON.stringify(error.mock.calls)).toContain('CLOUDINARY_API_KEY');
  });
});

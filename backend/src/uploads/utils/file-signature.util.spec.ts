import { detectFileSignature } from './file-signature.util';

describe('detectFileSignature', () => {
  it('detects PNG, JPEG, and PDF', () => {
    expect(
      detectFileSignature(
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      ),
    ).toBe('image/png');
    expect(detectFileSignature(Buffer.from([0xff, 0xd8, 0xff, 0x00]))).toBe(
      'image/jpeg',
    );
    expect(detectFileSignature(Buffer.from('%PDF-1.4'))).toBe(
      'application/pdf',
    );
  });

  it('detects MP4 (ftyp) and WebM (EBML) for storefront video uploads', () => {
    const mp4 = Buffer.alloc(12);
    mp4.write('ftyp', 4, 'ascii');
    expect(detectFileSignature(mp4)).toBe('video/mp4');

    expect(
      detectFileSignature(Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x00])),
    ).toBe('video/webm');
  });

  it('rejects unknown bytes', () => {
    expect(detectFileSignature(Buffer.from('GIF89a'))).toBeNull();
  });
});

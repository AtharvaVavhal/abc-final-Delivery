/**
 * Magic-byte (file-signature) detection, independent of the client-declared
 * MIME type — the actual mitigation for MIME-spoofing (§22 threat table).
 * Only the allowlisted formats are checked; anything else returns null.
 */
const SIGNATURES: ReadonlyArray<{
  mime: string;
  matches: (buf: Buffer) => boolean;
}> = [
  {
    mime: 'image/png',
    matches: (buf) =>
      buf.length >= 8 &&
      buf[0] === 0x89 &&
      buf[1] === 0x50 &&
      buf[2] === 0x4e &&
      buf[3] === 0x47 &&
      buf[4] === 0x0d &&
      buf[5] === 0x0a &&
      buf[6] === 0x1a &&
      buf[7] === 0x0a,
  },
  {
    mime: 'image/jpeg',
    matches: (buf) =>
      buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff,
  },
  {
    mime: 'application/pdf',
    matches: (buf) =>
      buf.length >= 4 &&
      buf[0] === 0x25 &&
      buf[1] === 0x50 &&
      buf[2] === 0x44 &&
      buf[3] === 0x46,
  },
  {
    // ISO BMFF (`ftyp` at offset 4) covers MP4 / MOV / M4V. Mapped to
    // video/mp4 so Cloudinary still classifies the actual container.
    mime: 'video/mp4',
    matches: (buf) =>
      buf.length >= 8 && buf.toString('ascii', 4, 8) === 'ftyp',
  },
  {
    // EBML header used by WebM (and Matroska). Allowlisted as video/webm.
    mime: 'video/webm',
    matches: (buf) =>
      buf.length >= 4 &&
      buf[0] === 0x1a &&
      buf[1] === 0x45 &&
      buf[2] === 0xdf &&
      buf[3] === 0xa3,
  },
];

/** Returns the detected MIME type from the file's actual bytes, or null. */
export function detectFileSignature(buffer: Buffer): string | null {
  return SIGNATURES.find((sig) => sig.matches(buffer))?.mime ?? null;
}

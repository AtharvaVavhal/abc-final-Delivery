import { ForbiddenException } from '@nestjs/common';
import { UploadsService } from './uploads.service';
import { MulterFileLike } from './types/multer-file.interface';

/**
 * Phase 6 W5 / P6-D4 — `storage_mb` enforcement at the upload boundary.
 * Same mocked-Prisma-`$transaction` convention as `products.service.spec
 * .ts`/`team.service.spec.ts`. `CloudinaryService`/`LimitEnforcementService`
 * are mocked — this file proves `UploadsService`'s OWN bytes→MiB
 * calculation and transaction composition; the guard-chain-level/real-file
 * proof (whichever exists) is in `test/e2e/upload-magic-bytes.e2e-spec.ts`
 * and the new storage e2e coverage.
 */
describe('UploadsService — storage_mb enforcement (P6-D4)', () => {
  const TENANT_ID = 'tenant-a';
  const USER_ID = 'user-1';

  // Real PNG magic bytes (detectFileSignature checks the buffer's actual
  // content, independent of the declared `size` field) — the buffer's
  // physical length is irrelevant to every test in this file, which only
  // exercises the numeric bytes→MiB calculation driven by `file.size`/
  // Cloudinary's reported `bytes`, not buffer content processing.
  const PNG_SIGNATURE = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  ]);

  function makeFile(size: number): MulterFileLike {
    return {
      buffer: PNG_SIGNATURE,
      originalname: 'test.png',
      mimetype: 'image/png',
      size,
    };
  }

  function makeService(opts: {
    cloudinaryBytes?: number;
    fileSize: number;
    assertLimitImpl?: () => Promise<void>;
    createImpl?: () => Promise<unknown>;
  }) {
    const uploadedFileDelegate = {
      create:
        opts.createImpl ??
        jest.fn().mockResolvedValue({
          id: 'file-1',
          bytes: opts.cloudinaryBytes ?? opts.fileSize,
        }),
    };
    const tx = { uploadedFile: uploadedFileDelegate };
    const prisma = {
      user: { findUnique: jest.fn().mockResolvedValue({ role: 'CUSTOMER' }) },
      $transaction: jest.fn((cb: (tx: unknown) => unknown) => cb(tx)),
    };
    const cloudinary = {
      uploadBuffer: jest.fn().mockResolvedValue({
        public_id: 'pub-1',
        bytes: opts.cloudinaryBytes,
        format: 'png',
        resource_type: 'image',
      }),
    };
    const limitEnforcementService = {
      assertLimit: opts.assertLimitImpl
        ? jest.fn(opts.assertLimitImpl)
        : jest.fn().mockResolvedValue(undefined),
      releaseLimit: jest.fn().mockResolvedValue(undefined),
    };
    const service = new UploadsService(
      prisma as never,
      cloudinary as never,
      limitEnforcementService as never,
    );
    return {
      service,
      prisma,
      cloudinary,
      limitEnforcementService,
      uploadedFileDelegate,
      tx,
    };
  }

  const resolveTenantId = () => Promise.resolve(TENANT_ID);

  // ─── Exact bytes → MiB calculation matrix ────────────────────────────────

  it('0 bytes reserves 0 MiB', async () => {
    const { service, limitEnforcementService } = makeService({
      cloudinaryBytes: 0,
      fileSize: 0,
    });

    await service.create(USER_ID, resolveTenantId, makeFile(0));

    expect(limitEnforcementService.assertLimit).toHaveBeenCalledWith(
      expect.anything(),
      TENANT_ID,
      'storage_mb',
      0,
    );
  });

  it('1 byte reserves 1 MiB (ceil, never rounds down to 0)', async () => {
    const { service, limitEnforcementService } = makeService({
      cloudinaryBytes: 1,
      fileSize: 1,
    });

    await service.create(USER_ID, resolveTenantId, makeFile(1));

    expect(limitEnforcementService.assertLimit).toHaveBeenCalledWith(
      expect.anything(),
      TENANT_ID,
      'storage_mb',
      1,
    );
  });

  it('exactly 1 MiB (1,048,576 bytes) reserves exactly 1 MiB', async () => {
    const { service, limitEnforcementService } = makeService({
      cloudinaryBytes: 1_048_576,
      fileSize: 1_048_576,
    });

    await service.create(USER_ID, resolveTenantId, makeFile(1_048_576));

    expect(limitEnforcementService.assertLimit).toHaveBeenCalledWith(
      expect.anything(),
      TENANT_ID,
      'storage_mb',
      1,
    );
  });

  it('1 MiB + 1 byte (1,048,577 bytes) reserves 2 MiB (ceil rounds up on any remainder)', async () => {
    const { service, limitEnforcementService } = makeService({
      cloudinaryBytes: 1_048_577,
      fileSize: 1_048_577,
    });

    await service.create(USER_ID, resolveTenantId, makeFile(1_048_577));

    expect(limitEnforcementService.assertLimit).toHaveBeenCalledWith(
      expect.anything(),
      TENANT_ID,
      'storage_mb',
      2,
    );
  });

  it('a multi-MiB file (5.5 MiB) reserves 6 MiB', async () => {
    const bytes = Math.floor(5.5 * 1_048_576);
    const { service, limitEnforcementService } = makeService({
      cloudinaryBytes: bytes,
      fileSize: bytes,
    });

    await service.create(USER_ID, resolveTenantId, makeFile(bytes));

    expect(limitEnforcementService.assertLimit).toHaveBeenCalledWith(
      expect.anything(),
      TENANT_ID,
      'storage_mb',
      6,
    );
  });

  it('falls back to file.size when Cloudinary reports no bytes (matches the pre-existing bytes fallback)', async () => {
    const { service, limitEnforcementService, uploadedFileDelegate } =
      makeService({
        cloudinaryBytes: undefined,
        fileSize: 2_097_152, // exactly 2 MiB
      });

    await service.create(USER_ID, resolveTenantId, makeFile(2_097_152));

    expect(limitEnforcementService.assertLimit).toHaveBeenCalledWith(
      expect.anything(),
      TENANT_ID,
      'storage_mb',
      2,
    );
    expect(uploadedFileDelegate.create).toHaveBeenCalledWith(
      expect.objectContaining({
        // jest's own `expect.objectContaining` matcher is typed `any` by
        // design — same convention as support-session.service.spec.ts.
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        data: expect.objectContaining({ bytes: 2_097_152 }),
      }),
    );
  });

  // ─── Unlimited / exhausted / missing PlanLimit ──────────────────────────

  it('unlimited storage: assertLimit resolving successfully allows the upload to proceed (composition proof — the actual unlimited semantics live in LimitEnforcementService/UsageService, already tested there)', async () => {
    const { service, uploadedFileDelegate } = makeService({
      cloudinaryBytes: 10_000_000_000, // huge — would exceed any finite limit
      fileSize: 10_000_000_000,
    });

    const result = await service.create(USER_ID, resolveTenantId, makeFile(1));

    expect(result).toBeDefined();
    expect(uploadedFileDelegate.create).toHaveBeenCalledTimes(1);
  });

  it('exhausted/missing-PlanLimit storage: a rejected assertLimit prevents UploadedFile creation entirely', async () => {
    const { service, uploadedFileDelegate } = makeService({
      cloudinaryBytes: 5,
      fileSize: 5,
      assertLimitImpl: () => {
        throw new ForbiddenException('limit_exceeded');
      },
    });

    await expect(
      service.create(USER_ID, resolveTenantId, makeFile(5)),
    ).rejects.toThrow('limit_exceeded');
    expect(uploadedFileDelegate.create).not.toHaveBeenCalled();
  });

  // ─── Rollback: failed UploadedFile persistence ──────────────────────────

  it('a failed UploadedFile creation propagates the error — the reservation and the create share one $transaction, so a real Postgres rollback reverts both (proven in the real-Postgres e2e suite)', async () => {
    const { service, prisma, limitEnforcementService } = makeService({
      cloudinaryBytes: 5,
      fileSize: 5,
      createImpl: () => Promise.reject(new Error('db constraint violation')),
    });

    await expect(
      service.create(USER_ID, resolveTenantId, makeFile(5)),
    ).rejects.toThrow('db constraint violation');
    // Both calls happened inside the SAME $transaction invocation — proven
    // by both mocks being invoked exactly once, via the one `cb(tx)` call.
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(limitEnforcementService.assertLimit).toHaveBeenCalledTimes(1);
  });

  // ─── Transaction composition ─────────────────────────────────────────────

  it("assertLimit receives the exact same tx object $transaction's callback was given — never a nested/independent transaction", async () => {
    const { service, limitEnforcementService, uploadedFileDelegate, tx } =
      makeService({
        cloudinaryBytes: 5,
        fileSize: 5,
      });

    await service.create(USER_ID, resolveTenantId, makeFile(5));

    expect(limitEnforcementService.assertLimit).toHaveBeenCalledWith(
      tx, // reference equality — the same tx object uploadedFile.create is a property of
      TENANT_ID,
      'storage_mb',
      1,
    );
    expect(uploadedFileDelegate.create).toHaveBeenCalledTimes(1);
  });
});

describe('UploadsService.resolveUrl — local storefront files', () => {
  it('maps local/ public ids to a public path without calling Cloudinary', () => {
    const cloudinary = { signedUrl: jest.fn() };
    const service = new UploadsService(
      {} as never,
      cloudinary as never,
      {} as never,
    );

    expect(service.resolveUrl('local/catalog/PAC01.jpg', 'image', 'upload')).toBe(
      '/catalog/PAC01.jpg',
    );
    expect(cloudinary.signedUrl).not.toHaveBeenCalled();
  });

  it('passes through absolute http(s) listing image URLs', () => {
    const cloudinary = { signedUrl: jest.fn() };
    const service = new UploadsService(
      {} as never,
      cloudinary as never,
      {} as never,
    );

    const remote =
      'https://5.imimg.com/data5/LH/KA/MY-3144071/directional-signs-500x500.jpg';
    expect(service.resolveUrl(remote, 'image', 'upload')).toBe(remote);
    expect(cloudinary.signedUrl).not.toHaveBeenCalled();
  });
});

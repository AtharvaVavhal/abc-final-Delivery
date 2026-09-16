import {
  Injectable,
  PayloadTooLargeException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { UploadedFile } from '@prisma/client';
import { PrismaService } from '../common/database/prisma.service';
import { Role } from '../common/enums/role.enum';
import {
  UPLOAD_ALLOWED_MIME_TYPES,
  UPLOAD_MAX_BYTES,
} from '../common/constants/app.constants';
import { LimitEnforcementService } from '../limits/limit-enforcement.service';
import { CloudinaryService } from './cloudinary/cloudinary.service';
import { detectFileSignature } from './utils/file-signature.util';
import { MulterFileLike } from './types/multer-file.interface';

/** P6-D4 — 1 MiB = 1,048,576 bytes, the same unit `UPLOAD_MAX_BYTES`/
 * `maxFileSizeMb` already use elsewhere in this codebase. */
const BYTES_PER_MIB = 1_048_576;

@Injectable()
export class UploadsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cloudinary: CloudinaryService,
    private readonly limitEnforcementService: LimitEnforcementService,
  ) {}

  /**
   * `resolveTenantId` is a thunk, not an already-resolved value — invoked
   * only after every validation step below has passed, so a bad file is
   * still rejected with the correct 4xx (size/signature) even when tenant
   * resolution would itself fail (e.g. an ambiguous multi-tenant test
   * fixture); this preserves the pre-existing validation-error precedence
   * (Phase 4 W7 / P4-D2 must not change it).
   */
  async create(
    userId: string,
    resolveTenantId: () => Promise<string>,
    file: MulterFileLike,
  ): Promise<UploadedFile> {
    if (file.size > UPLOAD_MAX_BYTES) {
      throw new PayloadTooLargeException(
        `File exceeds the maximum allowed size of ${UPLOAD_MAX_BYTES} bytes`,
      );
    }

    const detectedMime = detectFileSignature(file.buffer);
    if (!detectedMime || !UPLOAD_ALLOWED_MIME_TYPES.includes(detectedMime)) {
      throw new UnprocessableEntityException(
        "This file doesn't match its extension — please re-export and try again.",
      );
    }

    // §22 two-tier folder: admins land in products/ (this shared endpoint is
    // also how a product image gets uploaded before POST /products/:id/images
    // references it), everyone else in customizations/{userId}/. Role is
    // looked up fresh here rather than threaded through from the controller,
    // to keep this change confined to the uploads module.
    const uploader = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { role: true },
    });
    const purpose: 'product' | 'customization' =
      uploader?.role === Role.ADMIN ? 'product' : 'customization';

    // §22's signed/authenticated delivery protects the confidentiality of
    // private customer customization files — it has no purpose for public
    // storefront product photos, which should be plain, cheaply
    // CDN-cacheable URLs instead of gated behind a signed request every
    // time. Customization uploads are unaffected: still 'authenticated'.
    const deliveryType: 'upload' | 'authenticated' =
      purpose === 'product' ? 'upload' : 'authenticated';

    // The external Cloudinary upload is deliberately OUTSIDE any DB
    // transaction (an irreversible network side effect can never be part
    // of a Postgres transaction) — this is the existing, unavoidable
    // architecture, unchanged by W5. No storage compensation/rollback
    // mechanism exists for a Cloudinary object left behind by a failed DB
    // write below, and none is invented here (W5 authorization §2/§14) —
    // this matches the exact same pre-existing risk profile every other
    // upload always had, before storage enforcement existed at all.
    const result = await this.cloudinary.uploadBuffer(file.buffer, {
      purpose,
      userId,
      deliveryType,
    });

    // The authoritative byte count: Cloudinary's own reported size when
    // present, else the originally-uploaded buffer's size — the exact
    // same fallback `bytes:` below already used before W5 (unchanged),
    // just named so the MiB conversion below reads unambiguously (W5
    // authorization §3 — explicit, not `Math.ceil(result.bytes ?? file
    // .size / BYTES_PER_MIB)`, which operator precedence would silently
    // miscompute).
    const bytes = result.bytes ?? file.size;
    const storageMiB = Math.ceil(bytes / BYTES_PER_MIB);

    const tenantId = await resolveTenantId();

    // Phase 6 W5 / P6-D4 — assertLimit's reservation and the UploadedFile
    // row are created in the SAME transaction: if the DB write fails for
    // any reason, the reservation rolls back with it. `LimitEnforcement
    // Service` never opens its own transaction — this `$transaction` call
    // is the caller's own, exactly matching the `Products`/`Team`
    // integration convention already established.
    return this.prisma.$transaction(async (tx) => {
      await this.limitEnforcementService.assertLimit(
        tx,
        tenantId,
        'storage_mb',
        storageMiB,
      );

      return tx.uploadedFile.create({
        data: {
          cloudinaryPublicId: result.public_id,
          uploadedByUserId: userId,
          format: result.format ?? detectedMime.split('/')[1],
          bytes,
          resourceType: result.resource_type,
          deliveryType,
          // Server-derived from the caller's own resolved tenant context —
          // never a client-supplied value (Phase 4 W7 / P4-D2).
          tenantId,
        },
      });
    });
  }

  async findById(id: string): Promise<UploadedFile | null> {
    return this.prisma.uploadedFile.findUnique({ where: { id } });
  }

  getSignedUrl(file: UploadedFile): string {
    return this.resolveUrl(
      file.cloudinaryPublicId,
      file.resourceType,
      file.deliveryType,
    );
  }

  /**
   * The generic form of getSignedUrl — for callers (ProductsService) that
   * have a denormalized (publicId, resourceType, deliveryType) triple
   * rather than a full UploadedFile row. Despite the name (kept as-is on
   * CloudinaryService, see its own doc comment), this produces a plain
   * unsigned URL when deliveryType is 'upload' and only signs for
   * 'authenticated' — correct for both product and customization images.
   */
  resolveUrl(
    cloudinaryPublicId: string,
    resourceType: string,
    deliveryType: string,
  ): string {
    // Storefront files shipped in frontend/public — not Cloudinary objects.
    if (cloudinaryPublicId.startsWith('local/')) {
      return `/${cloudinaryPublicId.slice('local/'.length)}`;
    }
    // IndiaMART / Identica listing images stored as absolute URLs.
    if (
      cloudinaryPublicId.startsWith('https://') ||
      cloudinaryPublicId.startsWith('http://')
    ) {
      return cloudinaryPublicId;
    }
    return this.cloudinary.signedUrl(
      cloudinaryPublicId,
      resourceType,
      deliveryType,
    );
  }
}

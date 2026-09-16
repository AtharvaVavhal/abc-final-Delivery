import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { v2 as cloudinary, UploadApiResponse } from 'cloudinary';
import { AppConfig } from '../../common/config/configuration';
import {
  cloudinaryUploadException,
  unwrapCloudinaryError,
} from './cloudinary-error.util';

export interface CloudinaryUploadOptions {
  /**
   * Selects the §22 two-tier folder: 'product' -> printforge/{env}/products,
   * 'customization' -> printforge/{env}/customizations/{userId}. The caller
   * decides purpose (e.g. by the uploader's role) — this class owns only
   * the resulting path convention.
   */
  purpose: 'product' | 'customization';
  /** Required when purpose is 'customization'; ignored for 'product'. */
  userId?: string;
  /** 'authenticated' gates delivery behind a signed URL (§9); 'upload' is public. */
  deliveryType: 'upload' | 'authenticated';
}

/**
 * Thin wrapper around the Cloudinary SDK. Eager transforms are intentionally
 * not implemented here — Phase 2 scope is "upload-and-record" only (no
 * deletion, no image transforms). Folder scheme (§22) is implemented:
 * printforge/{env}/products/ vs printforge/{env}/customizations/{userId}/.
 */
@Injectable()
export class CloudinaryService implements OnModuleInit {
  private readonly logger = new Logger(CloudinaryService.name);
  private configured = false;

  constructor(private readonly configService: ConfigService<AppConfig, true>) {}

  onModuleInit(): void {
    const config = this.configService.get('cloudinary', { infer: true });

    if (!config.cloudName || !config.apiKey || !config.apiSecret) {
      // Missing keys must not be fatal at boot (same reasoning as the
      // Razorpay boot fix) — uploads simply fail at call time instead.
      this.logger.warn(
        'CLOUDINARY_CLOUD_NAME/API_KEY/API_SECRET not set — Cloudinary client not configured. Upload endpoints will fail until configured.',
      );
      return;
    }

    cloudinary.config({
      cloud_name: config.cloudName,
      api_key: config.apiKey,
      api_secret: config.apiSecret,
      secure: true,
    });
    this.configured = true;
  }

  async uploadBuffer(
    buffer: Buffer,
    options: CloudinaryUploadOptions,
  ): Promise<UploadApiResponse> {
    if (!this.configured) {
      throw new Error(
        'Cloudinary client is not configured — set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET.',
      );
    }

    const folder = this.resolveFolder(options);

    return new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          folder,
          resource_type: 'auto',
          type: options.deliveryType,
        },
        (error, result) => {
          if (error || !result) {
            const unwrapped = unwrapCloudinaryError(error);
            const httpCode =
              typeof unwrapped.http_code === 'number'
                ? unwrapped.http_code
                : undefined;
            const rawMessage =
              typeof unwrapped.message === 'string'
                ? unwrapped.message
                : 'Cloudinary upload failed';
            this.logger.error(
              `Cloudinary upload failed${httpCode != null ? ` (HTTP ${httpCode})` : ''}: ${rawMessage}`,
            );
            reject(cloudinaryUploadException(error));
            return;
          }
          resolve(result);
        },
      );
      uploadStream.end(buffer);
    });
  }

  /** §22 two-tier folder scheme — the sole place this path convention is built. */
  private resolveFolder(options: CloudinaryUploadOptions): string {
    const nodeEnv = this.configService.get('nodeEnv', { infer: true });

    if (options.purpose === 'product') {
      return `printforge/${nodeEnv}/products`;
    }

    if (!options.userId) {
      throw new Error("userId is required when purpose is 'customization'");
    }
    return `printforge/${nodeEnv}/customizations/${options.userId}`;
  }

  /**
   * Computed fresh on every read, never persisted (§9: "signed URLs...
   * computed on read"). Signed via Cloudinary's basic sign_url mechanism —
   * this gates access to the asset but is not additionally time-boxed to
   * 60 minutes; true expiring delivery needs Cloudinary's auth_token
   * feature, which requires an account-level key not among the current
   * CLOUDINARY_* env vars (§31). Flagged in the completion report.
   */
  signedUrl(
    publicId: string,
    resourceType: string,
    deliveryType: string,
  ): string {
    if (!this.configured) {
      throw new Error(
        'Cloudinary client is not configured — set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET.',
      );
    }

    return cloudinary.url(publicId, {
      resource_type: resourceType,
      type: deliveryType,
      sign_url: deliveryType === 'authenticated',
      secure: true,
    });
  }

  // TODO(uploads): destroy() — for the 48h orphan-cleanup poller only, never
  // for a file still referenced by a cart or order (§24 invariant 7).
}

import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Prisma, User } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import type { Response } from 'express';
import {
  BCRYPT_COST,
  LOGIN_DELAY_CURVE_MS,
  PASSWORD_RESET_TOKEN_TTL_MS,
  REFRESH_TOKEN_COOKIE_NAME,
} from '../common/constants/app.constants';
import { AppConfig } from '../common/config/configuration';
import { PrismaService } from '../common/database/prisma.service';
import { UsersService } from '../users/users.service';
import { OtpService } from './otp/otp.service';
import { nationalIndianMobile } from './otp/phone.util';
import { withPlatformRlsBypass } from '../common/tenant/tenant-rls';
import { NotificationsService } from '../notifications/notifications.service';
import { refreshCookieBaseOptions } from '../common/http/refresh-cookie-options';
import { refreshTtlMsForUser } from './refresh-ttl';
import { parseDurationMs } from './utils/duration.util';
import {
  generateOpaqueToken,
  hashRefreshToken,
  hashResetToken,
} from './utils/token.util';

/** Generic, non-enumerating message for every login failure mode (§23). */
const GENERIC_LOGIN_ERROR = 'Invalid email or password';

/**
 * A password hash of a value nobody will ever submit, computed once at
 * process start. Compared against on a "user not found" login so that a
 * non-existent-email attempt costs roughly the same wall-clock time as a
 * wrong-password attempt for a real account — otherwise the bcrypt-skip
 * would leak account existence via response timing even though the
 * response body/status are already identical.
 */
const DUMMY_PASSWORD_HASH = bcrypt.hashSync(
  'printforge-timing-normalization-only',
  BCRYPT_COST,
);

export interface PublicUser {
  id: string;
  email: string | null;
  role: string;
  createdAt: Date;
}

export interface AuthTokenResult {
  accessToken: string;
  user: PublicUser;
}

@Injectable()
export class AuthService {
  private readonly refreshTokenSecret: string;
  private readonly customerRefreshTokenTtlMs: number;
  private readonly adminRefreshTokenTtlMs: number;
  private readonly frontendUrl: string;
  private readonly backendUrl: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly usersService: UsersService,
    private readonly notificationsService: NotificationsService,
    private readonly jwtService: JwtService,
    private readonly otpService: OtpService,
    configService: ConfigService<AppConfig, true>,
  ) {
    const authConfig = configService.get('auth', { infer: true });
    this.refreshTokenSecret = authConfig.refreshTokenSecret;
    this.customerRefreshTokenTtlMs = parseDurationMs(
      authConfig.refreshTokenExpiresIn,
    );
    this.adminRefreshTokenTtlMs = parseDurationMs(
      authConfig.adminRefreshTokenExpiresIn,
    );
    this.frontendUrl = configService.get('frontendUrl', { infer: true });
    this.backendUrl = configService.get('backendUrl', { infer: true });
  }

  // ─── Register (§13.A) ───────────────────────────────────────────────

  async register(
    email: string,
    password: string,
    res: Response,
  ): Promise<AuthTokenResult> {
    const normalizedEmail = email.toLowerCase();
    const passwordHash = await bcrypt.hash(password, BCRYPT_COST);
    const rawRefreshToken = generateOpaqueToken();
    const refreshTokenHash = hashRefreshToken(
      rawRefreshToken,
      this.refreshTokenSecret,
    );
    // Register always creates a CUSTOMER — never an admin session.
    const refreshTokenExpiresAt = this.refreshExpiryFor({
      role: 'CUSTOMER',
      platformRole: null,
    });

    let user: User;
    try {
      user = await this.prisma.$transaction(async (tx) => {
        const created = await tx.user.create({
          data: { email: normalizedEmail, passwordHash },
        });
        await tx.refreshToken.create({
          data: {
            userId: created.id,
            tokenHash: refreshTokenHash,
            expiresAt: refreshTokenExpiresAt,
          },
        });
        return created;
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException(
          'An account with this email already exists',
        );
      }
      throw err;
    }

    this.setRefreshCookie(res, rawRefreshToken, refreshTokenExpiresAt);
    return {
      accessToken: this.signAccessToken(user),
      user: this.toPublicUser(user),
    };
  }

  // ─── Login (§13.B, §23 progressive delay) ──────────────────────────

  async login(
    email: string,
    password: string,
    res: Response,
  ): Promise<AuthTokenResult> {
    const normalizedEmail = email.toLowerCase();
    const user = await this.usersService.findByEmail(normalizedEmail);

    if (!user || !user.isActive) {
      await bcrypt.compare(password, DUMMY_PASSWORD_HASH);
      throw new UnauthorizedException(GENERIC_LOGIN_ERROR);
    }

    const delayIndex = Math.min(
      user.failedLoginAttempts,
      LOGIN_DELAY_CURVE_MS.length - 1,
    );
    const delayMs = LOGIN_DELAY_CURVE_MS[delayIndex];
    if (delayMs > 0) {
      await this.sleep(delayMs);
    }

    // Phone-only (OTP) accounts have no password — they can never pass here.
    const passwordValid = user.passwordHash
      ? await bcrypt.compare(password, user.passwordHash)
      : (await bcrypt.compare(password, DUMMY_PASSWORD_HASH), false);
    if (!passwordValid) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: { failedLoginAttempts: { increment: 1 } },
      });
      throw new UnauthorizedException(GENERIC_LOGIN_ERROR);
    }

    if (user.failedLoginAttempts !== 0) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: { failedLoginAttempts: 0 },
      });
    }

    const rawRefreshToken = generateOpaqueToken();
    const refreshTokenHash = hashRefreshToken(
      rawRefreshToken,
      this.refreshTokenSecret,
    );
    const refreshTokenExpiresAt = this.refreshExpiryFor(user);
    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: refreshTokenHash,
        expiresAt: refreshTokenExpiresAt,
      },
    });

    this.setRefreshCookie(res, rawRefreshToken, refreshTokenExpiresAt);
    return {
      accessToken: this.signAccessToken(user),
      user: this.toPublicUser(user),
    };
  }

  // ─── Phone OTP (docs/architecture/PHONE-OTP-AUTH-DESIGN.md) ────────

  async requestOtp(
    phone: string,
    ip: string | undefined,
    hostname?: string,
  ): Promise<void> {
    this.otpService.assertEnabled();
    const store = await this.resolveOtpStore(hostname);
    await this.otpService.requestCode(phone, ip, store.id);
  }

  /**
   * Verifies the SMS code, finds or creates the CUSTOMER account for that
   * verified number, and issues the same access token + rotating refresh
   * cookie as password login. Staff (admin / platform) accounts can never
   * sign in this way.
   *
   * Memberships are checked even for legacy CUSTOMER-role staff. The global
   * phone identity remains unique (P9-D1); it cannot be claimed by another store.
   */
  async verifyOtpAndLogin(
    phone: string,
    code: string,
    res: Response,
    hostname?: string,
  ): Promise<AuthTokenResult> {
    this.otpService.assertEnabled();
    const store = await this.resolveOtpStore(hostname);
    const phoneE164 = await this.otpService.verifyCode(phone, code, store.id);

    let user = await this.prisma.user.findUnique({
      where: { phoneE164 },
    });
    if (!user) {
      try {
        user = await this.prisma.user.create({
          data: {
            phoneE164,
            // The number they just proved they own is also their contact
            // number until they say otherwise (shown on My account and
            // prefilled at checkout).
            phone: nationalIndianMobile(phoneE164),
            phoneVerifiedAt: new Date(),
            otpStoreId: store.id,
          },
        });
      } catch (err) {
        if (
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === 'P2002'
        ) {
          // Lost a race with a concurrent verify for the same number.
          user = await this.prisma.user.findUnique({
            where: { phoneE164 },
          });
        } else {
          throw err;
        }
      }
    }

    if (
      !user ||
      !user.isActive ||
      user.role !== 'CUSTOMER' ||
      user.platformRole !== null ||
      user.otpStoreId !== store.id
    ) {
      throw new UnauthorizedException('Invalid or expired code');
    }

    await this.assertOtpSession(user, hostname);
    await this.saveLoginPhoneToProfile(user);

    if (!user.phoneVerifiedAt) {
      user = await this.prisma.user.update({
        where: { id: user.id },
        data: { phoneVerifiedAt: new Date() },
      });
    }

    const rawRefreshToken = generateOpaqueToken();
    const refreshTokenExpiresAt = this.refreshExpiryFor(user);
    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: hashRefreshToken(rawRefreshToken, this.refreshTokenSecret),
        expiresAt: refreshTokenExpiresAt,
      },
    });
    this.setRefreshCookie(res, rawRefreshToken, refreshTokenExpiresAt);
    return {
      accessToken: this.signAccessToken(user),
      user: this.toPublicUser(user),
    };
  }

  /**
   * Fills the profile phone with the number the customer just verified, but
   * only when it is still empty — a number they typed themselves is never
   * overwritten. The `phone: null` condition is in the UPDATE itself, so a
   * concurrent profile save cannot be clobbered either. Covers accounts made
   * before this behaviour existed: they are filled in on their next login.
   */
  private async saveLoginPhoneToProfile(user: User): Promise<void> {
    if (!user.phoneE164 || user.phone) return;
    await this.prisma.user.updateMany({
      where: { id: user.id, phone: null },
      data: { phone: nationalIndianMobile(user.phoneE164) },
    });
  }

  // ─── Refresh rotation + reuse detection (§13.C, §23) ───────────────

  /** No tenant ID from the client and no newest-tenant fallback at auth boundaries.
   * The configured API host maps to the configured frontend's StoreDomain;
   * other hosts must themselves be registered StoreDomains. */
  private async resolveOtpStore(hostname?: string) {
    const host = hostname?.toLowerCase();
    if (!host) throw new UnauthorizedException('Store sign-in is unavailable');
    const backendHost = new URL(this.backendUrl).hostname;
    const domainHost =
      host === backendHost ? new URL(this.frontendUrl).hostname : host;
    const domain = await withPlatformRlsBypass(this.prisma, (tx) =>
      tx.storeDomain.findUnique({
        where: { hostname: domainHost },
        include: { store: { include: { tenant: true } } },
      }),
    );
    if (
      !domain ||
      domain.tenantId !== domain.store.tenantId ||
      domain.verificationStatus !== 'VERIFIED' ||
      domain.store.status !== 'ACTIVE' ||
      domain.store.tenant.status !== 'ACTIVE'
    ) {
      throw new UnauthorizedException('Store sign-in is unavailable');
    }
    return domain.store;
  }

  /** DB-derived binding keeps thin JWTs unchanged. Used at issuance, refresh
   * and every access-token validation. Password/staff sessions are unaffected. */
  async assertOtpSession(
    user: User,
    hostname?: string,
  ): Promise<{ tenantId: string; storeId: string } | undefined> {
    if (!user.otpStoreId && !(user.phoneE164 && !user.passwordHash)) return;
    const store = await this.resolveOtpStore(hostname);
    const membership = await withPlatformRlsBypass(this.prisma, (tx) =>
      tx.tenantMembership.findFirst({
        where: { userId: user.id },
        select: { id: true },
      }),
    );
    if (
      user.otpStoreId !== store.id ||
      user.role !== 'CUSTOMER' ||
      user.platformRole ||
      membership
    ) {
      throw new UnauthorizedException('Invalid storefront session');
    }
    return { tenantId: store.tenantId, storeId: store.id };
  }

  async refresh(
    rawToken: string | undefined,
    res: Response,
    hostname?: string,
  ): Promise<AuthTokenResult> {
    if (!rawToken) {
      throw new UnauthorizedException('Missing refresh token');
    }

    const tokenHash = hashRefreshToken(rawToken, this.refreshTokenSecret);
    const tokenRow = await this.prisma.refreshToken.findFirst({
      where: { tokenHash },
    });

    if (!tokenRow) {
      this.clearRefreshCookie(res);
      throw new UnauthorizedException('Invalid refresh token');
    }

    if (tokenRow.revokedAt) {
      // Reuse of an already-rotated/revoked token: theft detection —
      // revoke the entire refresh-token family and bump tokenVersion so
      // every outstanding access token is also instantly invalidated (§23).
      await this.prisma.$transaction([
        this.prisma.refreshToken.updateMany({
          where: { userId: tokenRow.userId, revokedAt: null },
          data: { revokedAt: new Date() },
        }),
        this.prisma.user.update({
          where: { id: tokenRow.userId },
          data: { tokenVersion: { increment: 1 } },
        }),
      ]);
      this.clearRefreshCookie(res);
      throw new UnauthorizedException(
        'Refresh token reuse detected — all sessions have been revoked',
      );
    }

    if (tokenRow.expiresAt.getTime() < Date.now()) {
      await this.prisma.refreshToken.update({
        where: { id: tokenRow.id },
        data: { revokedAt: new Date() },
      });
      this.clearRefreshCookie(res);
      throw new UnauthorizedException('Refresh token expired');
    }

    const user = await this.usersService.findById(tokenRow.userId);
    if (!user || !user.isActive) {
      this.clearRefreshCookie(res);
      throw new UnauthorizedException();
    }

    await this.assertOtpSession(user, hostname);

    const newRawToken = generateOpaqueToken();
    const newTokenHash = hashRefreshToken(newRawToken, this.refreshTokenSecret);
    const newExpiresAt = this.refreshExpiryFor(user);

    await this.prisma.$transaction(async (tx) => {
      const spent = await tx.refreshToken.updateMany({
        where: {
          id: tokenRow.id,
          revokedAt: null,
          expiresAt: { gt: new Date() },
        },
        data: { revokedAt: new Date() },
      });
      if (spent.count !== 1)
        throw new UnauthorizedException('Invalid refresh token');
      const created = await tx.refreshToken.create({
        data: {
          userId: user.id,
          tokenHash: newTokenHash,
          expiresAt: newExpiresAt,
        },
      });
      await tx.refreshToken.update({
        where: { id: tokenRow.id },
        data: { revokedAt: new Date(), replacedByTokenId: created.id },
      });
    });

    this.setRefreshCookie(res, newRawToken, newExpiresAt);
    return {
      accessToken: this.signAccessToken(user),
      user: this.toPublicUser(user),
    };
  }

  // ─── Logout / logout-all (§13.D) ────────────────────────────────────

  async logout(
    userId: string,
    rawToken: string | undefined,
    res: Response,
  ): Promise<void> {
    if (rawToken) {
      const tokenHash = hashRefreshToken(rawToken, this.refreshTokenSecret);
      await this.prisma.refreshToken.updateMany({
        where: { tokenHash, userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }
    this.clearRefreshCookie(res);
  }

  async logoutAll(userId: string, res: Response): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: { tokenVersion: { increment: 1 } },
      }),
      this.prisma.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);
    this.clearRefreshCookie(res);
  }

  // ─── Password reset (§13.E) ─────────────────────────────────────────

  async requestPasswordReset(email: string): Promise<void> {
    const normalizedEmail = email.toLowerCase();
    const user = await this.usersService.findByEmail(normalizedEmail);

    // Always a generic (void) response regardless of match — no enumeration.
    if (!user || !user.isActive) {
      return;
    }

    const rawToken = generateOpaqueToken();
    const tokenHash = hashResetToken(rawToken);
    const expiresAt = new Date(Date.now() + PASSWORD_RESET_TOKEN_TTL_MS);
    const requestNonce = generateOpaqueToken().slice(0, 16);
    const resetLink = `${this.frontendUrl}/reset-password?token=${rawToken}`;

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: {
          passwordResetTokenHash: tokenHash,
          passwordResetExpiresAt: expiresAt,
        },
      });
      await this.notificationsService.enqueueOutboxEvent(tx, {
        eventType: 'PASSWORD_RESET_REQUESTED',
        aggregateType: 'User',
        aggregateId: user.id,
        eventKey: `PASSWORD_RESET_REQUESTED:${user.id}:${requestNonce}`,
        payload: {
          userId: user.id,
          email: user.email,
          resetLink,
          expiresAt: expiresAt.toISOString(),
        },
      });
    });
  }

  async confirmPasswordReset(
    token: string,
    newPassword: string,
  ): Promise<void> {
    const tokenHash = hashResetToken(token);
    const user = await this.prisma.user.findFirst({
      where: { passwordResetTokenHash: tokenHash },
    });

    if (
      !user ||
      !user.passwordResetExpiresAt ||
      user.passwordResetExpiresAt.getTime() < Date.now()
    ) {
      throw new UnauthorizedException('Invalid or expired reset token');
    }

    const passwordHash = await bcrypt.hash(newPassword, BCRYPT_COST);
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: user.id },
        data: {
          passwordHash,
          passwordResetTokenHash: null,
          passwordResetExpiresAt: null,
          tokenVersion: { increment: 1 },
          failedLoginAttempts: 0,
        },
      }),
      this.prisma.refreshToken.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);
  }

  // ─── Helpers ─────────────────────────────────────────────────────────

  private refreshExpiryFor(user: {
    role: string;
    platformRole: string | null;
  }): Date {
    return new Date(
      Date.now() +
        refreshTtlMsForUser(user, {
          customerMs: this.customerRefreshTokenTtlMs,
          adminMs: this.adminRefreshTokenTtlMs,
        }),
    );
  }

  private signAccessToken(user: User): string {
    // Thin token (decision P2-D4 / Master Plan §8): only `sub` + `tokenVersion`.
    // email / role / platformRole / memberships are resolved fresh from the DB
    // in JwtStrategy.validate() on every request — never trusted from the
    // token. Pre-Phase-2a tokens that still carry `email`/`role` stay valid for
    // one refresh-TTL window (validate() ignores those fields). tokenVersion is
    // NOT bumped by this change — existing sessions are not invalidated.
    return this.jwtService.sign({
      sub: user.id,
      tokenVersion: user.tokenVersion,
    });
  }

  private toPublicUser(user: User): PublicUser {
    return {
      id: user.id,
      email: user.email,
      role: user.role,
      createdAt: user.createdAt,
    };
  }

  private refreshCookieOptions(res: Response) {
    const originHeader = res.req?.headers?.origin;
    const origin =
      typeof originHeader === 'string' && originHeader.length > 0
        ? originHeader
        : this.frontendUrl;
    return refreshCookieBaseOptions(origin, this.backendUrl);
  }

  private setRefreshCookie(
    res: Response,
    token: string,
    expiresAt: Date,
  ): void {
    res.cookie(REFRESH_TOKEN_COOKIE_NAME, token, {
      ...this.refreshCookieOptions(res),
      expires: expiresAt,
    });
  }

  private clearRefreshCookie(res: Response): void {
    res.clearCookie(REFRESH_TOKEN_COOKIE_NAME, this.refreshCookieOptions(res));
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

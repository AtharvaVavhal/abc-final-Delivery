import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Public } from '../common/decorators/public.decorator';
import { ThrottleAuth } from '../common/throttling/throttle.decorators';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { REFRESH_TOKEN_COOKIE_NAME } from '../common/constants/app.constants';
import { AuthService, AuthTokenResult } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { PasswordResetRequestDto } from './dto/password-reset-request.dto';
import { PasswordResetConfirmDto } from './dto/password-reset-confirm.dto';

/**
 * Owns (§20): POST /auth/register, POST /auth/login (no 423
 * ACCOUNT_LOCKED — progressive delay only, §23), POST /auth/refresh
 * (refresh cookie, rotation), POST /auth/logout, POST /auth/logout-all,
 * POST /auth/password-reset/request, POST /auth/password-reset/confirm.
 *
 * /auth/refresh is deliberately @Public() rather than routed through a
 * second Passport strategy: the refresh token is an opaque, DB-backed
 * value (not a JWT — see auth/utils/token.util.ts), so there is nothing
 * for a passport-jwt-shaped strategy to verify; AuthService.refresh()
 * performs the cookie-presence + DB lookup + rotation/reuse-detection
 * itself and throws UnauthorizedException on any failure, which the global
 * HttpExceptionFilter shapes into the standard error envelope.
 */
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @ThrottleAuth()
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  async register(
    @Body() dto: RegisterDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthTokenResult> {
    return this.authService.register(dto.email, dto.password, res);
  }

  @Public()
  @ThrottleAuth()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthTokenResult> {
    return this.authService.login(dto.email, dto.password, res);
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthTokenResult> {
    const rawToken = (
      req.cookies as Record<string, string | undefined> | undefined
    )?.[REFRESH_TOKEN_COOKIE_NAME];
    return this.authService.refresh(rawToken, res);
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ message: string }> {
    const rawToken = (
      req.cookies as Record<string, string | undefined> | undefined
    )?.[REFRESH_TOKEN_COOKIE_NAME];
    await this.authService.logout(user.id, rawToken, res);
    return { message: 'Logged out successfully' };
  }

  @Post('logout-all')
  @HttpCode(HttpStatus.OK)
  async logoutAll(
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ message: string }> {
    await this.authService.logoutAll(user.id, res);
    return { message: 'Logged out of all sessions successfully' };
  }

  @Public()
  @ThrottleAuth()
  @Post('password-reset/request')
  @HttpCode(HttpStatus.OK)
  async requestPasswordReset(
    @Body() dto: PasswordResetRequestDto,
  ): Promise<{ message: string }> {
    await this.authService.requestPasswordReset(dto.email);
    // Always identical regardless of match — no enumeration (§23).
    return {
      message:
        'If an account exists for this email, a password reset link has been sent.',
    };
  }

  @Public()
  @ThrottleAuth()
  @Post('password-reset/confirm')
  @HttpCode(HttpStatus.OK)
  async confirmPasswordReset(
    @Body() dto: PasswordResetConfirmDto,
  ): Promise<{ message: string }> {
    await this.authService.confirmPasswordReset(dto.token, dto.newPassword);
    return { message: 'Password has been reset. Please log in again.' };
  }
}

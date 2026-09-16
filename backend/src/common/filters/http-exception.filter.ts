import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import * as Sentry from '@sentry/node';
import { Request, Response } from 'express';
import { ApiErrorResponse } from '../types/api-response.interface';

/**
 * Mirror-image of ResponseInterceptor: shapes every thrown error into the
 * frozen {success:false, error:{code, message, details}} envelope (§21).
 * Catches everything (not just HttpException) so an unexpected error never
 * leaks a raw stack trace to the client.
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const isHttpException = exception instanceof HttpException;
    const status: number = isHttpException
      ? exception.getStatus()
      : HttpStatus.INTERNAL_SERVER_ERROR;

    const technicalMessage = isHttpException
      ? this.extractMessage(exception)
      : 'Internal server error';
    const isThrottled = status === 429;

    const body: ApiErrorResponse = {
      success: false,
      error: {
        code: HttpStatus[status] ?? 'INTERNAL_SERVER_ERROR',
        message: isThrottled
          ? 'Please wait a moment and try again.'
          : technicalMessage,
        details: isHttpException ? this.extractDetails(exception) : [],
      },
    };

    if (!isHttpException) {
      // Unexpected (non-HttpException) errors are always logged with full detail server-side.
      this.logger.error(
        exception instanceof Error ? exception.stack : exception,
      );
    } else if (isThrottled) {
      this.logger.warn(
        `${request.method} ${request.path} throttled: ${technicalMessage}`,
      );
    }

    if (status >= Number(HttpStatus.INTERNAL_SERVER_ERROR)) {
      // §30: only genuine server-side failures (5xx) go to Sentry —
      // expected 4xx client errors (validation, auth, RBAC, IDOR, etc.) are
      // normal application flow, not incidents. Context is limited to the
      // request path + method; the body/headers are never attached, so no
      // password, token, or card/payment field can reach this call — the
      // same thing this filter has always logged server-side, nothing
      // more. A no-op when SENTRY_DSN is unset (main.ts guards Sentry.init
      // on it), so local dev and the e2e suite are unaffected.
      Sentry.captureException(exception, {
        tags: { 'http.method': request.method, 'http.path': request.path },
      });
    }

    response.status(status).json(body);
  }

  private extractMessage(exception: HttpException): string {
    const res = exception.getResponse();
    if (typeof res === 'string') return res;
    if (typeof res === 'object' && res !== null && 'message' in res) {
      const m = res.message;
      return Array.isArray(m) ? exception.message : String(m);
    }
    return exception.message;
  }

  private extractDetails(exception: HttpException): unknown[] {
    const res = exception.getResponse();
    if (typeof res === 'object' && res !== null && 'message' in res) {
      const m = res.message;
      return Array.isArray(m) ? m : [];
    }
    return [];
  }
}

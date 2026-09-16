import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import * as Sentry from '@sentry/node';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { AppConfig } from './common/config/configuration';
import { API_PREFIX } from './common/constants/app.constants';
import { corsAllowedOrigins } from './common/http/cors-origins';

// §30 "Sentry (both apps)" — initialized before Nest bootstraps (so it's
// live for any error during module init too), guarded by SENTRY_DSN: a
// no-op when unset, so local dev and the e2e suite (.env.test never sets
// this) are unaffected. Error tracking only — no tracesSampleRate, so no
// performance/tracing data is collected. Read from process.env directly
// (not ConfigService) because the Nest DI container doesn't exist yet at
// this point in bootstrap.
if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV ?? 'development',
  });
}

async function bootstrap(): Promise<void> {
  // rawBody: true — POST /payments/webhook needs the exact undecoded bytes
  // Razorpay signed (§12.3 "capture raw body before body-parsing
  // middleware"); this Nest/Express option exposes it as req.rawBody
  // without disabling normal JSON parsing for every other route.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    rawBody: true,
  });
  const configService = app.get(ConfigService<AppConfig, true>);

  // Render (and any TLS terminator) forwards the client IP in
  // X-Forwarded-For. Without this, ThrottlerGuard keys every visitor on
  // the proxy address and the refresh cookie's Secure flag still works
  // because it is hardcoded, but req.ip would be wrong.
  app.set('trust proxy', 1);
  app.enableShutdownHooks();

  app.setGlobalPrefix(API_PREFIX);

  // CORP defaults to same-origin and would block the storefront on
  // www.abcmanufactures.com from reading api.abcmanufactures.com.
  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );
  app.use(cookieParser());

  // Credentialed allowlist — never a wildcard (§23). FRONTEND_URL plus
  // the production storefront hosts and local Vite origins.
  app.enableCors({
    origin: corsAllowedOrigins(
      configService.get('frontendUrl', { infer: true }),
    ),
    credentials: true,
  });

  // whitelist + forbidNonWhitelisted: unexpected/extra fields are rejected,
  // never silently dropped or trusted (§23).
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const port = configService.get('port', { infer: true });
  await app.listen(port);
}

void bootstrap();

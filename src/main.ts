import './common/bigint-json';
import { HttpAdapterHost, NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { initSentry, SentryFilter } from './common/sentry';
import { AppConfig } from './config/app-config.service';
import { preflight } from './preflight';

async function bootstrap() {
  // Le .env est déjà chargé et validé à l'import d'AppModule (ConfigModule.forRoot)
  await preflight(process.env);

  initSentry(
    process.env.SENTRY_DSN || undefined,
    process.env.NODE_ENV ?? 'development',
  );

  // rawBody : la signature Meta se vérifie sur le corps brut, octet pour octet
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    rawBody: true,
  });
  const config = app.get(AppConfig);
  const production = config.get('NODE_ENV') === 'production';

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          // Attributs style des graphiques (Recharts)
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:', 'blob:'],
          fontSrc: ["'self'", 'data:'],
          connectSrc: ["'self'"],
          frameAncestors: ["'none'"],
          formAction: ["'self'"],
          // En local (http://localhost), ne pas forcer le passage en https
          upgradeInsecureRequests: production ? [] : null,
        },
      },
      crossOriginEmbedderPolicy: false,
    }),
  );
  app.use(cookieParser());
  app.useBodyParser('json', { limit: '1mb' });
  app.useGlobalFilters(new SentryFilter(app.get(HttpAdapterHost).httpAdapter));
  app.enableShutdownHooks();
  // Derrière le proxy de Railway : adresse IP réelle du client
  app.set('trust proxy', 1);
  await app.listen(config.get('PORT'));
}
void bootstrap();

/**
 * Shared application setup used by every entrypoint that serves HTTP (src/main.ts and
 * scripts/seed-example.ts). Kept separate from main.ts so alternative entrypoints cannot drift
 * from the real server configuration (CORS, docs, shutdown hooks).
 */
import { INestApplication, Logger } from '@nestjs/common';
import { SwaggerModule } from '@nestjs/swagger';
import { buildAdminDocument, buildIntegrationDocument } from './common/openapi/build-documents.js';
import { repositoryDriver } from './persistence/repository.module.js';
import { PrismaService } from './persistence/prisma/prisma.service.js';

export async function configureApp(app: INestApplication): Promise<void> {
  const logger = new Logger('Bootstrap');

  // CORS is only enabled when ADMIN_UI_ORIGINS is set (comma-separated origins of the admin web
  // interface, e.g. http://localhost:5173). The admin UI sends the token as an Authorization
  // header; auth is purely token-based (no cookie) → credentials: false.
  const adminUiOrigins = (process.env.ADMIN_UI_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
  if (adminUiOrigins.length === 0) {
    logger.warn(
      'ADMIN_UI_ORIGINS is not set — CORS is disabled and browser requests from the admin UI ' +
        'will fail. Set it to the admin UI origin(s), e.g. http://localhost:5173.',
    );
  } else {
    app.enableCors({
      origin: adminUiOrigins,
      credentials: false,
      allowedHeaders: [
        'Authorization',
        'Content-Type',
        'x-admin-token',
        'Idempotency-Key',
        'x-service-token',
        'x-customer-id',
        'x-actor-user-id',
        'x-actor-name',
        'x-actor-email',
        'x-actor-role',
      ],
    });
  }

  // Optional, gated Swagger UIs (default off): OPENAPI_DOCS_ENABLED=true serves the two specs
  // at /docs/admin and /docs/integration.
  if (process.env.OPENAPI_DOCS_ENABLED === 'true') {
    SwaggerModule.setup('docs/admin', app, buildAdminDocument(app));
    SwaggerModule.setup('docs/integration', app, buildIntegrationDocument(app));
    logger.log('Swagger UIs enabled at /docs/admin and /docs/integration');
  }

  // DomainErrorFilter is registered as APP_FILTER in AppModule (also applies to TestingModule).
  app.enableShutdownHooks(); // SIGTERM/SIGINT → app.close() → OnModuleDestroy (incl. Prisma $disconnect)
  if (repositoryDriver() === 'prisma') {
    await app.get(PrismaService).enableShutdownHooks(app);
  }
}

/**
 * Builds the two OpenAPI documents of the service — shared by `pnpm openapi`
 * (scripts/openapi.ts, writes the committed JSON files) and the optional gated Swagger UIs
 * (main.ts, OPENAPI_DOCS_ENABLED=true):
 *
 *  - **admin**: everything under `/admin/**` — consumed by the admin UI generator
 *    (openapi.admin.json).
 *  - **integration**: the service-to-service surface for calling tools — `/customers/**`
 *    (compliance gate, pending popup, consent writes, onboarding) and `/webhooks/postmark`
 *    (openapi.integration.json).
 */
import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule, type OpenAPIObject } from '@nestjs/swagger';
import { AcceptModule } from '../../accept/accept.module.js';
import { AdminModule } from '../../admin/admin.module.js';
import { AgreementsModule } from '../../agreements/agreements.module.js';
import { AdminAuthModule } from '../auth/admin-auth.module.js';
import { ComplianceModule } from '../../compliance/compliance.module.js';
import { ConsentModule } from '../../consent/consent.module.js';
import { EmailModule } from '../../plugins/email/email.module.js';
import { EventsModule } from '../../events/events.module.js';
import { SEC_ADMIN_TOKEN, SEC_GOOGLE_SSO, SEC_SERVICE_TOKEN, SEC_WEBHOOK_TOKEN } from './security.decorators.js';

const VERSION = '0.1.0';

export const buildAdminDocument = (app: INestApplication): OpenAPIObject => {
  const config = new DocumentBuilder()
    .setTitle('clickwrap-server — admin API')
    .setDescription(
      'Administration surface (`/admin/**`): documents & versions, publish/rollout, customers, ' +
        'operations (per-version dashboard, history, manual acceptance, deadlines/reminders) and the dynamic ' +
        'entities (audiences, document types). Errors are always `{ code, message }` — the codes ' +
        'are documented in docs/API.md §7.',
    )
    .setVersion(VERSION)
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Google ID token (Google SSO; domain/allowlist checked server-side).',
      },
      SEC_GOOGLE_SSO,
    )
    .addApiKey(
      {
        type: 'apiKey',
        in: 'header',
        name: 'x-admin-token',
        description: 'Static admin token fallback (dev/CI; ADMIN_API_TOKEN). Optional: x-admin-user names the actor.',
      },
      SEC_ADMIN_TOKEN,
    )
    .build();
  return SwaggerModule.createDocument(app, config, {
    include: [AdminModule, AgreementsModule, AdminAuthModule, EventsModule],
  });
};

export const buildIntegrationDocument = (app: INestApplication): OpenAPIObject => {
  const config = new DocumentBuilder()
    .setTitle('clickwrap-server — integration API')
    .setDescription(
      'Service-to-service surface for the calling tools: compliance gate, pending-agreements ' +
        'popup feed, consent/objection/delivery writes, customer onboarding (`POST /customers`) ' +
        'and the Postmark delivery webhook. Auth: shared `x-service-token`; the customer-scoped ' +
        'routes additionally require the verified context headers (`x-customer-id`, `x-actor-*`) ' +
        '— actor and customer NEVER come from the body. Exception: the hosted acceptance page ' +
        '(`/accept/**`) is authenticated by its capability link token alone (no integration ' +
        'needed). Errors are always `{ code, message }`.',
    )
    .setVersion(VERSION)
    .addApiKey(
      {
        type: 'apiKey',
        in: 'header',
        name: 'x-service-token',
        description: 'Shared service secret (SERVICE_API_TOKEN).',
      },
      SEC_SERVICE_TOKEN,
    )
    .addApiKey(
      {
        type: 'apiKey',
        in: 'header',
        name: 'token',
        description: 'Postmark webhook token (POSTMARK_WEBHOOK_TOKEN).',
      },
      SEC_WEBHOOK_TOKEN,
    )
    .build();
  return SwaggerModule.createDocument(app, config, {
    include: [ConsentModule, ComplianceModule, EmailModule, AcceptModule],
  });
};

/**
 * Central definitions of the OpenAPI security schemes and small reusable decorators so every
 * controller declares its auth consistently. The scheme names must match those registered on the
 * DocumentBuilder in scripts/openapi.ts.
 */
import { applyDecorators } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiSecurity } from '@nestjs/swagger';

/** Google SSO bearer token (admin web UI). */
export const SEC_GOOGLE_SSO = 'google-sso';
/** Static admin token fallback (dev/CI). */
export const SEC_ADMIN_TOKEN = 'admin-token';
/** Service-to-service shared secret for the integration API. */
export const SEC_SERVICE_TOKEN = 'service-token';
/** Postmark webhook token header. */
export const SEC_WEBHOOK_TOKEN = 'postmark-webhook-token';

/** Admin routes: Google SSO bearer OR the x-admin-token fallback. */
export const AdminAuth = (): ClassDecorator & MethodDecorator =>
  applyDecorators(ApiBearerAuth(SEC_GOOGLE_SSO), ApiSecurity(SEC_ADMIN_TOKEN));

/** Integration routes: x-service-token (+ x-customer-id / x-actor-* context headers where required). */
export const ServiceApiKey = (): ClassDecorator & MethodDecorator => applyDecorators(ApiSecurity(SEC_SERVICE_TOKEN));

/** Postmark webhook: token header. */
export const WebhookAuth = (): ClassDecorator & MethodDecorator => applyDecorators(ApiSecurity(SEC_WEBHOOK_TOKEN));

/**
 * Customer-scoped service routes (ServiceGuard): the verified context is forwarded via headers —
 * customerId/actor NEVER come from the body.
 */
export const ServiceContextHeaders = (): ClassDecorator & MethodDecorator =>
  applyDecorators(
    ApiSecurity(SEC_SERVICE_TOKEN),
    ApiHeader({ name: 'x-customer-id', required: true, description: 'Authenticated customer (must match the path).' }),
    ApiHeader({ name: 'x-actor-user-id', required: true, description: 'Acting user in the calling tool.' }),
    ApiHeader({ name: 'x-actor-name', required: false }),
    ApiHeader({ name: 'x-actor-email', required: false }),
    ApiHeader({ name: 'x-actor-role', required: false, description: 'Portal role, logged with the evidence.' }),
  );

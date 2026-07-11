/**
 * Integration consent endpoints (active consent, objection, delivery report). The customer is
 * addressed by query parameter — either `customerId` or `externalRef` (+ required `audience`); see
 * {@link resolveIntegrationCustomer}. Auth: shared `x-service-token` via {@link ServiceTokenGuard};
 * the acting identity comes from the forwarded `x-actor-*` headers (and, for consent, the body's
 * `signerName`/`signerEmail`), never a customer-context header. Channel = PORTAL.
 */
import { BadRequestException, Body, Controller, Headers, HttpCode, Inject, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBody, ApiCreatedResponse, ApiHeader, ApiOkResponse, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import type { Actor, CustomerContext } from '../common/auth/actor.js';
import { ServiceTokenGuard } from '../common/auth/service-token.guard.js';
import { resolveIntegrationCustomer } from '../common/integration/resolve-customer.js';
import { ApiErrorResponses } from '../common/openapi/api-error-responses.decorator.js';
import { ServiceApiKey } from '../common/openapi/security.decorators.js';
import type { AudienceRepo, CustomerRepo } from '../domain/ports.js';
import { TOKENS } from '../persistence/tokens.js';
import { AcceptanceService, type AcceptanceResponse } from './acceptance.service.js';
import {
  integrationAcceptanceBodySchema,
  notificationBodySchema,
  objectionBodySchema,
  ZodBodyPipe,
  type IntegrationAcceptanceBody,
  type NotificationBody,
  type ObjectionBody,
} from './dto.js';
import { NotificationService, type NotificationResponse } from './notification.service.js';
import { ObjectionService, type ObjectionResponse } from './objection.service.js';
import {
  AcceptanceResponseModel,
  IntegrationAcceptanceBodyModel,
  NotificationBodyModel,
  NotificationResponseModel,
  ObjectionBodyModel,
  ObjectionResponseModel,
} from './openapi.models.js';

type RequestWithServiceActor = Request & { serviceActor?: Actor };

const CUSTOMER_QUERY = [
  { name: 'customerId', required: false, description: 'Internal customer id (exactly one of customerId | externalRef).' },
  { name: 'externalRef', required: false, description: "Caller's external reference (requires audience)." },
  { name: 'audience', required: false, description: 'Required with externalRef (resolution discriminator).' },
] as const;

@ApiTags('integration-consent')
@ServiceApiKey()
@Controller('customers')
@UseGuards(ServiceTokenGuard)
export class ConsentController {
  constructor(
    private readonly acceptanceService: AcceptanceService,
    private readonly objectionService: ObjectionService,
    private readonly notificationService: NotificationService,
    @Inject(TOKENS.CustomerRepo) private readonly customers: CustomerRepo,
    @Inject(TOKENS.AudienceRepo) private readonly audiences: AudienceRepo,
  ) {}

  /** POST /customers/acceptances?customerId=... | ?externalRef=...&audience=... — Idempotency-Key required. */
  @Post('acceptances')
  @ApiOperation({
    summary: 'Record active consent (Idempotency-Key required)',
    description:
      'Resolves the customer by `customerId` or `externalRef`+`audience`, then records active ' +
      'consent through the shared acceptance flow (idempotency, version-current check, ACTIVE ' +
      'consent-text cross-check). The acting identity comes from `signerName`/`signerEmail` and/or ' +
      'the `x-actor-*` headers; channel = PORTAL. Replay with the same Idempotency-Key returns the ' +
      'identical 201.',
  })
  @ApiQuery(CUSTOMER_QUERY[0])
  @ApiQuery(CUSTOMER_QUERY[1])
  @ApiQuery(CUSTOMER_QUERY[2])
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiBody({ type: IntegrationAcceptanceBodyModel })
  @ApiCreatedResponse({ type: AcceptanceResponseModel })
  @ApiErrorResponses({
    400: 'Bad customer selector / missing Idempotency-Key / body validation failed.',
    401: 'Missing/invalid service token.',
    404: 'CUSTOMER_NOT_FOUND · VERSION_NOT_FOUND',
    409: 'ALREADY_ACCEPTED',
    422: 'VERSION_NOT_CURRENT · ROLE_MISMATCH · CONSENT_TEXT_MISMATCH · UNKNOWN_AUDIENCE',
  })
  @HttpCode(201)
  async accept(
    @Query('customerId') customerId: string | undefined,
    @Query('externalRef') externalRef: string | undefined,
    @Query('audience') audience: string | undefined,
    @Body(new ZodBodyPipe(integrationAcceptanceBodySchema)) body: IntegrationAcceptanceBody,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() req: RequestWithServiceActor,
  ): Promise<AcceptanceResponse> {
    const customer = await resolveIntegrationCustomer(this.customers, this.audiences, { customerId, externalRef, audience });
    return this.acceptanceService.accept({
      customerId: customer.id,
      versionId: body.versionId,
      displayedConsentText: body.displayedConsentText,
      idempotencyKey: this.requireIdempotencyKey(idempotencyKey),
      context: this.contextFor(req, customer.id, { name: body.signerName, email: body.signerEmail }),
      channel: 'PORTAL',
    });
  }

  /** POST /customers/objections?customerId=... | ?externalRef=...&audience=... — Idempotency-Key required. */
  @Post('objections')
  @ApiOperation({ summary: 'Record an objection — PASSIVE versions within the objection period only (Idempotency-Key required)' })
  @ApiQuery(CUSTOMER_QUERY[0])
  @ApiQuery(CUSTOMER_QUERY[1])
  @ApiQuery(CUSTOMER_QUERY[2])
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiBody({ type: ObjectionBodyModel })
  @ApiCreatedResponse({ type: ObjectionResponseModel })
  @ApiErrorResponses({
    400: 'Bad customer selector / missing Idempotency-Key / body validation failed.',
    401: 'Missing/invalid service token.',
    404: 'CUSTOMER_NOT_FOUND · VERSION_NOT_FOUND',
    422: 'OBJECTION_NOT_APPLICABLE · OBJECTION_PERIOD_EXPIRED · UNKNOWN_AUDIENCE',
  })
  @HttpCode(201)
  async object(
    @Query('customerId') customerId: string | undefined,
    @Query('externalRef') externalRef: string | undefined,
    @Query('audience') audience: string | undefined,
    @Body(new ZodBodyPipe(objectionBodySchema)) body: ObjectionBody,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() req: RequestWithServiceActor,
  ): Promise<ObjectionResponse> {
    const customer = await resolveIntegrationCustomer(this.customers, this.audiences, { customerId, externalRef, audience });
    return this.objectionService.object({
      customerId: customer.id,
      versionId: body.versionId,
      reason: body.reason,
      idempotencyKey: this.requireIdempotencyKey(idempotencyKey),
      context: this.contextFor(req, customer.id),
    });
  }

  /** POST /customers/notifications?customerId=... | ?externalRef=...&audience=... — naturally idempotent. */
  @Post('notifications')
  @ApiOperation({
    summary: 'Report delivery ("popup was displayed") — starts the deadline',
    description:
      'notifiedAt is set to SERVER time, atomically and only from PENDING_NOTIFICATION. ' +
      'displayedAt is a plausibility check only. Naturally idempotent (no key needed).',
  })
  @ApiQuery(CUSTOMER_QUERY[0])
  @ApiQuery(CUSTOMER_QUERY[1])
  @ApiQuery(CUSTOMER_QUERY[2])
  @ApiBody({ type: NotificationBodyModel })
  @ApiOkResponse({ type: NotificationResponseModel })
  @ApiErrorResponses({
    400: 'Bad customer selector / body validation failed.',
    401: 'Missing/invalid service token.',
    404: 'CUSTOMER_NOT_FOUND · VERSION_NOT_FOUND',
    422: 'INVALID_STATE · UNKNOWN_AUDIENCE',
  })
  @HttpCode(200)
  async notify(
    @Query('customerId') customerId: string | undefined,
    @Query('externalRef') externalRef: string | undefined,
    @Query('audience') audience: string | undefined,
    @Body(new ZodBodyPipe(notificationBodySchema)) body: NotificationBody,
    @Req() req: RequestWithServiceActor,
  ): Promise<NotificationResponse> {
    const customer = await resolveIntegrationCustomer(this.customers, this.audiences, { customerId, externalRef, audience });
    return this.notificationService.notify({
      customerId: customer.id,
      versionId: body.versionId,
      channel: body.channel,
      displayedAt: body.displayedAt ? new Date(body.displayedAt) : undefined,
      context: this.contextFor(req, customer.id),
    });
  }

  /**
   * Evidence context. The actor is the portal user forwarded via `x-actor-*` (ServiceTokenGuard →
   * req.serviceActor); a self-declared signer name/e-mail (consent only) takes precedence for the
   * recorded name/e-mail. IP/UA are taken server-side.
   */
  private contextFor(req: RequestWithServiceActor, customerId: string, signer?: { name?: string; email?: string }): CustomerContext {
    const actor: Actor = req.serviceActor ?? { userId: 'service' };
    return {
      customerId,
      actor: {
        userId: actor.userId,
        name: signer?.name ?? actor.name,
        email: signer?.email ?? actor.email,
        portalRole: actor.portalRole,
      },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    };
  }

  private requireIdempotencyKey(key: string | undefined): string {
    if (!key || key.trim() === '') {
      throw new BadRequestException('Idempotency-Key header is required');
    }
    return key;
  }
}

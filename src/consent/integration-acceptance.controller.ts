/**
 * Integration accept endpoint keyed by (`externalRef`, `audience`) — records the portal user's
 * active consent for an upstream system (the metergrid Main Portal) that only knows the customer by
 * its own external reference, not clickwrap's internal id. Backs the Betreiberportal native accept
 * overlay (rendered with mg-ui). Auth: the shared `x-service-token` via {@link ServiceTokenGuard}
 * (NOT the stricter {@link ServiceGuard} — there is no forwarded `x-customer-id`, the customer is
 * resolved here from the external reference).
 *
 * An `externalRef` is only unique in combination with an audience, so `audience` is a REQUIRED
 * query param (the resolution discriminator). The active customer carrying `externalRef` whose
 * roles include `audience` is resolved, then the SHARED {@link AcceptanceService} — the same one
 * behind the per-customerId accept route — applies the idempotency, version-current and
 * consent-text rules unchanged. The acting portal user's identity comes from the body
 * (`signerName`/`signerEmail`) and/or the forwarded `x-actor-*` headers; the channel is PORTAL.
 */
import { BadRequestException, Body, Controller, Headers, HttpCode, Inject, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBody, ApiCreatedResponse, ApiHeader, ApiOperation, ApiParam, ApiQuery, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import type { Actor, CustomerContext } from '../common/auth/actor';
import { ServiceTokenGuard } from '../common/auth/service-token.guard';
import { DomainError } from '../common/errors';
import { ApiErrorResponses } from '../common/openapi/api-error-responses.decorator';
import { ServiceApiKey } from '../common/openapi/security.decorators';
import type { AudienceRepo, CustomerRepo } from '../domain/ports';
import type { Customer } from '../domain/types';
import { resolveAudienceKey } from '../compliance/audience';
import { TOKENS } from '../persistence/tokens';
import { AcceptanceService, type AcceptanceResponse } from './acceptance.service';
import { integrationAcceptanceBodySchema, ZodBodyPipe, type IntegrationAcceptanceBody } from './dto';
import { AcceptanceResponseModel, IntegrationAcceptanceBodyModel } from './openapi.models';

type RequestWithServiceActor = Request & { serviceActor?: Actor };

@ApiTags('integration-consent')
@ServiceApiKey()
@Controller('customers')
@UseGuards(ServiceTokenGuard)
export class IntegrationAcceptanceController {
  constructor(
    private readonly acceptanceService: AcceptanceService,
    @Inject(TOKENS.CustomerRepo) private readonly customers: CustomerRepo,
    @Inject(TOKENS.AudienceRepo) private readonly audiences: AudienceRepo,
  ) {}

  /** POST /customers/by-external-ref/:externalRef/acceptances?audience=... — audience + Idempotency-Key required. */
  @Post('by-external-ref/:externalRef/acceptances')
  @HttpCode(201)
  @ApiOperation({
    summary: 'Record active consent by external reference (inbound integration)',
    description:
      'Resolves the ACTIVE customer by (`externalRef`, `audience`) — the record carrying ' +
      '`externalRef` whose roles include the required `audience` query param — and records the ' +
      "portal user's active consent through the SAME acceptance flow as POST " +
      '/customers/:customerId/acceptances (idempotency via Idempotency-Key, version-current check, ' +
      'ACTIVE consent-text cross-check; PASSIVE versions carry no consent text). The acting ' +
      'identity comes from `signerName`/`signerEmail` in the body and/or the `x-actor-*` headers; ' +
      'channel = PORTAL. Backs the Betreiberportal native accept overlay.',
  })
  @ApiParam({ name: 'externalRef', description: "Caller's stable external reference." })
  @ApiQuery({ name: 'audience', required: true, description: 'Audience key (resolution discriminator).' })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiBody({ type: IntegrationAcceptanceBodyModel })
  @ApiCreatedResponse({ type: AcceptanceResponseModel })
  @ApiErrorResponses({
    400: 'Missing `audience` / Idempotency-Key, or body validation failed (strict schema).',
    401: 'Missing/invalid service token.',
    404: 'CUSTOMER_NOT_FOUND — no active customer for this (externalRef, audience) · VERSION_NOT_FOUND',
    409: 'ALREADY_ACCEPTED',
    422: 'VERSION_NOT_CURRENT · CONSENT_TEXT_MISMATCH · ROLE_MISMATCH · UNKNOWN_AUDIENCE',
  })
  async acceptByExternalRef(
    @Param('externalRef') externalRef: string,
    @Query('audience') audience: string | undefined,
    @Body(new ZodBodyPipe(integrationAcceptanceBodySchema)) body: IntegrationAcceptanceBody,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() req: RequestWithServiceActor,
  ): Promise<AcceptanceResponse> {
    if (!audience || audience.trim() === '') {
      throw new BadRequestException('audience query parameter is required');
    }
    // Validate the audience FIRST (422 UNKNOWN_AUDIENCE) so an unknown key is never masked as a 404
    // by the customer resolution below.
    await resolveAudienceKey(this.audiences, audience);
    const customer = await this.resolveActiveCustomer(externalRef, audience);
    return this.acceptanceService.accept({
      customerId: customer.id,
      versionId: body.versionId,
      displayedConsentText: body.displayedConsentText,
      idempotencyKey: this.requireIdempotencyKey(idempotencyKey),
      context: this.contextFor(req, customer.id, body),
      channel: 'PORTAL',
    });
  }

  /**
   * The active customer carrying `externalRef` whose roles include `audience`. Unknown externalRef,
   * a soft-deleted match, or a customer of a different audience sharing the same `externalRef` all
   * yield CUSTOMER_NOT_FOUND (404).
   */
  private async resolveActiveCustomer(externalRef: string, audience: string): Promise<Customer> {
    const matches = await this.customers.findAllByExternalRef(externalRef);
    const customer = matches.find((c) => c.deletedAt === undefined && c.roles.includes(audience));
    if (!customer) {
      throw new DomainError('CUSTOMER_NOT_FOUND', `No active customer for externalRef "${externalRef}" and audience "${audience}"`);
    }
    return customer;
  }

  /**
   * The evidence context. The actor is the portal user the Main Portal forwards via the `x-actor-*`
   * headers (ServiceTokenGuard → req.serviceActor); the self-declared `signerName`/`signerEmail`
   * in the body take precedence for the recorded name/e-mail. IP/UA are taken server-side.
   */
  private contextFor(req: RequestWithServiceActor, customerId: string, body: IntegrationAcceptanceBody): CustomerContext {
    const serviceActor: Actor = req.serviceActor ?? { userId: 'service' };
    return {
      customerId,
      actor: {
        userId: serviceActor.userId,
        name: body.signerName ?? serviceActor.name,
        email: body.signerEmail ?? serviceActor.email,
        portalRole: serviceActor.portalRole,
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

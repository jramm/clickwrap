/**
 * Integration pending-agreements feed (portal popup content). The customer is addressed by query
 * parameter — either `customerId` or `externalRef` (+ required `audience`); see
 * {@link resolveIntegrationCustomer}. Auth: shared `x-service-token` via {@link ServiceTokenGuard}.
 * Thin route — logic lives in PendingAgreementsService.
 */
import { Controller, Get, Inject, Query, UseGuards } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { ServiceTokenGuard } from '../common/auth/service-token.guard.js';
import { resolveIntegrationCustomer } from '../common/integration/resolve-customer.js';
import { ApiErrorResponses } from '../common/openapi/api-error-responses.decorator.js';
import { ServiceApiKey } from '../common/openapi/security.decorators.js';
import type { AudienceRepo, CustomerRepo } from '../domain/ports.js';
import { TOKENS } from '../persistence/tokens.js';
import { PendingAgreementsService, type PendingAgreementItem } from './pending-agreements.service.js';
import { PendingAgreementItemModel } from './openapi.models.js';

@ApiTags('integration-consent')
@ServiceApiKey()
@Controller('customers')
@UseGuards(ServiceTokenGuard)
export class PendingAgreementsController {
  constructor(
    private readonly pendingAgreementsService: PendingAgreementsService,
    @Inject(TOKENS.CustomerRepo) private readonly customers: CustomerRepo,
    @Inject(TOKENS.AudienceRepo) private readonly audiences: AudienceRepo,
  ) {}

  /** GET /customers/pending-agreements?customerId=... | ?externalRef=...&audience=... */
  @Get('pending-agreements')
  @ApiOperation({
    summary: 'Popup content — open items for the customer (empty = nothing to show)',
    description:
      'Resolves the customer by `customerId` or `externalRef`+`audience`, then returns current ' +
      'PUBLISHED versions with an open state (PENDING_NOTIFICATION | NOTIFIED | EXPIRED_BLOCKING) ' +
      'plus UPCOMING published versions (validFrom in the future, marked `upcoming: true`). With ' +
      '`externalRef`, `audience` is required; with `customerId` it is an optional scope.',
  })
  @ApiQuery({ name: 'customerId', required: false, description: 'Internal customer id (exactly one of customerId | externalRef).' })
  @ApiQuery({ name: 'externalRef', required: false, description: "Caller's external reference (requires audience)." })
  @ApiQuery({ name: 'audience', required: false, description: 'Required with externalRef; optional scope with customerId.' })
  @ApiOkResponse({ type: [PendingAgreementItemModel] })
  @ApiErrorResponses({
    400: 'Provide exactly one of customerId | externalRef; audience required with externalRef.',
    401: 'Missing/invalid service token.',
    404: 'CUSTOMER_NOT_FOUND.',
    422: 'UNKNOWN_AUDIENCE.',
  })
  async getPendingAgreements(
    @Query('customerId') customerId: string | undefined,
    @Query('externalRef') externalRef: string | undefined,
    @Query('audience') audience: string | undefined,
  ): Promise<PendingAgreementItem[]> {
    const customer = await resolveIntegrationCustomer(this.customers, this.audiences, { customerId, externalRef, audience });
    return this.pendingAgreementsService.getPendingAgreements(customer.id, audience?.trim() || undefined);
  }
}

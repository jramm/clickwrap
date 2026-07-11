/**
 * Integration pending-agreements feed keyed by (`externalRef`, `audience`) — the outstanding-AGB
 * popup content for an upstream system (the metergrid Main Portal) that only knows the customer by
 * its own external reference, not clickwrap's internal id. Backs the Betreiberportal native accept
 * overlay (rendered with mg-ui). Auth: the shared `x-service-token` via {@link ServiceTokenGuard}
 * (NOT the stricter {@link ServiceGuard} — there is no forwarded `x-customer-id`, the customer is
 * resolved here from the external reference).
 *
 * An `externalRef` is only unique in combination with an audience, so `audience` is a REQUIRED
 * query param (the resolution discriminator). The active customer carrying `externalRef` whose
 * roles include `audience` is resolved, then the SHARED {@link PendingAgreementsService} — the same
 * one behind the per-customerId popup endpoint — returns the outstanding items unchanged.
 */
import { BadRequestException, Controller, Get, Inject, Param, Query, UseGuards } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiParam, ApiQuery, ApiTags } from '@nestjs/swagger';
import { ServiceTokenGuard } from '../common/auth/service-token.guard.js';
import { DomainError } from '../common/errors.js';
import { ApiErrorResponses } from '../common/openapi/api-error-responses.decorator.js';
import { ServiceApiKey } from '../common/openapi/security.decorators.js';
import type { Customer } from '../domain/types.js';
import type { AudienceRepo, CustomerRepo } from '../domain/ports.js';
import { TOKENS } from '../persistence/tokens.js';
import { resolveAudienceKey } from './audience.js';
import { PendingAgreementsService, type PendingAgreementItem } from './pending-agreements.service.js';
import { PendingAgreementItemModel } from './openapi.models.js';

@ApiTags('integration-consent')
@ServiceApiKey()
@Controller('customers')
@UseGuards(ServiceTokenGuard)
export class IntegrationPendingAgreementsController {
  constructor(
    private readonly pendingAgreementsService: PendingAgreementsService,
    @Inject(TOKENS.CustomerRepo) private readonly customers: CustomerRepo,
    @Inject(TOKENS.AudienceRepo) private readonly audiences: AudienceRepo,
  ) {}

  /** GET /customers/by-external-ref/:externalRef/pending-agreements?audience=... — audience is required. */
  @Get('by-external-ref/:externalRef/pending-agreements')
  @ApiOperation({
    summary: 'Outstanding agreements by external reference (inbound integration)',
    description:
      'Resolves the ACTIVE customer by (`externalRef`, `audience`) — the record carrying ' +
      '`externalRef` whose roles include the required `audience` query param — and returns the ' +
      'outstanding agreements for that customer (empty array = nothing to show). The response is ' +
      'the SAME shape as GET /customers/:customerId/pending-agreements: current PUBLISHED versions ' +
      'with an open state plus UPCOMING published versions (advance acceptance). Backs the ' +
      'Betreiberportal native accept overlay.',
  })
  @ApiParam({ name: 'externalRef', description: "Caller's stable external reference." })
  @ApiQuery({ name: 'audience', required: true, description: 'Audience key (resolution discriminator + scope).' })
  @ApiOkResponse({ type: [PendingAgreementItemModel] })
  @ApiErrorResponses({
    400: 'Missing `audience` query parameter.',
    401: 'Missing/invalid service token.',
    404: 'CUSTOMER_NOT_FOUND — no active customer for this (externalRef, audience).',
    422: 'UNKNOWN_AUDIENCE',
  })
  async getPendingAgreementsByExternalRef(
    @Param('externalRef') externalRef: string,
    @Query('audience') audience: string | undefined,
  ): Promise<PendingAgreementItem[]> {
    if (!audience || audience.trim() === '') {
      throw new BadRequestException('audience query parameter is required');
    }
    // Validate the audience FIRST (422 UNKNOWN_AUDIENCE) so an unknown key is never masked as a 404
    // by the customer resolution below.
    await resolveAudienceKey(this.audiences, audience);
    const customer = await this.resolveActiveCustomer(externalRef, audience);
    return this.pendingAgreementsService.getPendingAgreements(customer.id, audience);
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
}

/**
 * Integration compliance query keyed by (`externalRef`, `audience`) — the compliance gate for an
 * upstream system (the metergrid Main Portal) that only knows the customer by its own external
 * reference, not clickwrap's internal id. Auth: the shared `x-service-token` via
 * {@link ServiceTokenGuard} (NOT the stricter {@link ServiceGuard} — there is no forwarded
 * `x-customer-id`, the customer is resolved here from the external reference).
 *
 * An `externalRef` is only unique in combination with an audience, so `audience` is a REQUIRED
 * query param: it is both the resolution discriminator and the compliance scope. The active
 * customer carrying `externalRef` whose roles include `audience` is resolved, then the shared
 * {@link ComplianceService.getCompliance} answers the gate unchanged.
 */
import { BadRequestException, Controller, Get, Inject, Param, Query, UseGuards } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiParam, ApiQuery, ApiTags } from '@nestjs/swagger';
import { ServiceTokenGuard } from '../common/auth/service-token.guard';
import { DomainError } from '../common/errors';
import { ApiErrorResponses } from '../common/openapi/api-error-responses.decorator';
import { ServiceApiKey } from '../common/openapi/security.decorators';
import type { Customer } from '../domain/types';
import type { AudienceRepo, CustomerRepo } from '../domain/ports';
import { TOKENS } from '../persistence/tokens';
import { resolveAudienceKey } from './audience';
import { ComplianceService, type ComplianceResponse } from './compliance.service';
import { ComplianceResponseModel } from './openapi.models';

@ApiTags('integration-compliance')
@ServiceApiKey()
@Controller('customers')
@UseGuards(ServiceTokenGuard)
export class IntegrationComplianceController {
  constructor(
    private readonly complianceService: ComplianceService,
    @Inject(TOKENS.CustomerRepo) private readonly customers: CustomerRepo,
    @Inject(TOKENS.AudienceRepo) private readonly audiences: AudienceRepo,
  ) {}

  /** GET /customers/by-external-ref/:externalRef/compliance?audience=... — audience is required. */
  @Get('by-external-ref/:externalRef/compliance')
  @ApiOperation({
    summary: 'Compliance gate by external reference (inbound integration)',
    description:
      'Resolves the ACTIVE customer by (`externalRef`, `audience`) — the record carrying ' +
      '`externalRef` whose roles include the required `audience` query param — and returns the ' +
      'compliance gate for that audience. `compliant=false` only for EXPIRED_BLOCKING or a ' +
      'not-yet-accepted carry-over state. Callers query this live per request (no cache) and FAIL ' +
      'OPEN: any error/timeout OR a 404 is treated as compliant (no block).',
  })
  @ApiParam({ name: 'externalRef', description: "Caller's stable external reference." })
  @ApiQuery({ name: 'audience', required: true, description: 'Audience key (resolution discriminator + compliance scope).' })
  @ApiOkResponse({ type: ComplianceResponseModel })
  @ApiErrorResponses({
    400: 'Missing `audience` query parameter.',
    401: 'Missing/invalid service token.',
    404: 'CUSTOMER_NOT_FOUND — no active customer for this (externalRef, audience).',
    422: 'UNKNOWN_AUDIENCE',
  })
  async getComplianceByExternalRef(
    @Param('externalRef') externalRef: string,
    @Query('audience') audience: string | undefined,
  ): Promise<ComplianceResponse> {
    if (!audience || audience.trim() === '') {
      throw new BadRequestException('audience query parameter is required');
    }
    // Validate the audience FIRST (422 UNKNOWN_AUDIENCE) so an unknown key is never masked as a 404
    // by the customer resolution below.
    await resolveAudienceKey(this.audiences, audience);
    const customer = await this.resolveActiveCustomer(externalRef, audience);
    return this.complianceService.getCompliance(customer.id, audience);
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

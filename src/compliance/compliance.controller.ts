/**
 * Integration compliance gate. The customer is addressed by query parameter — either `customerId`
 * or `externalRef` (+ required `audience`); see {@link resolveIntegrationCustomer}. Auth: shared
 * `x-service-token` via {@link ServiceTokenGuard}. Thin route — logic lives in ComplianceService.
 */
import { Controller, Get, Inject, Query, UseGuards } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { ServiceTokenGuard } from '../common/auth/service-token.guard.js';
import { resolveIntegrationCustomer } from '../common/integration/resolve-customer.js';
import { ApiErrorResponses } from '../common/openapi/api-error-responses.decorator.js';
import { ServiceApiKey } from '../common/openapi/security.decorators.js';
import type { AudienceRepo, CustomerRepo } from '../domain/ports.js';
import { TOKENS } from '../persistence/tokens.js';
import { ComplianceService, type ComplianceResponse } from './compliance.service.js';
import { ComplianceResponseModel } from './openapi.models.js';

@ApiTags('integration-compliance')
@ServiceApiKey()
@Controller('customers')
@UseGuards(ServiceTokenGuard)
export class ComplianceController {
  constructor(
    private readonly complianceService: ComplianceService,
    @Inject(TOKENS.CustomerRepo) private readonly customers: CustomerRepo,
    @Inject(TOKENS.AudienceRepo) private readonly audiences: AudienceRepo,
  ) {}

  /** GET /customers/compliance?customerId=... | ?externalRef=...&audience=... */
  @Get('compliance')
  @ApiOperation({
    summary: 'Compliance gate',
    description:
      'Resolves the customer by `customerId` or `externalRef`+`audience` and returns the gate. ' +
      "compliant=false ONLY for EXPIRED_BLOCKING or a not-yet-accepted carry-over state. With " +
      '`externalRef`, `audience` is required (resolution discriminator + scope). With `customerId`, ' +
      "`audience` is an optional scope — omit it to aggregate all of the customer's roles. Callers " +
      'query this live per request and FAIL OPEN: any error/timeout or 404 is treated as compliant.',
  })
  @ApiQuery({ name: 'customerId', required: false, description: 'Internal customer id (exactly one of customerId | externalRef).' })
  @ApiQuery({ name: 'externalRef', required: false, description: "Caller's external reference (requires audience)." })
  @ApiQuery({ name: 'audience', required: false, description: 'Required with externalRef; optional scope with customerId.' })
  @ApiOkResponse({ type: ComplianceResponseModel })
  @ApiErrorResponses({
    400: 'Provide exactly one of customerId | externalRef; audience required with externalRef.',
    401: 'Missing/invalid service token.',
    404: 'CUSTOMER_NOT_FOUND.',
    422: 'UNKNOWN_AUDIENCE.',
  })
  async getCompliance(
    @Query('customerId') customerId: string | undefined,
    @Query('externalRef') externalRef: string | undefined,
    @Query('audience') audience: string | undefined,
  ): Promise<ComplianceResponse> {
    const customer = await resolveIntegrationCustomer(this.customers, this.audiences, { customerId, externalRef, audience });
    return this.complianceService.getCompliance(customer.id, audience?.trim() || undefined);
  }
}

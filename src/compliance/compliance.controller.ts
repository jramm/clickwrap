/** HTTP route for the tool gate — thin, logic lives in ComplianceService. */
import { Controller, Get, Param, Query, Req, UseGuards } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { ServiceGuard } from '../common/auth/service.guard';
import { ApiErrorResponses } from '../common/openapi/api-error-responses.decorator';
import { ServiceContextHeaders } from '../common/openapi/security.decorators';
import { ComplianceService, type ComplianceResponse } from './compliance.service';
import { assertCustomerMatchesContext } from './http/assert-customer-context';
import { ComplianceResponseModel } from './openapi.models';

@ApiTags('integration-compliance')
@ServiceContextHeaders()
@ApiErrorResponses({
  401: 'Missing/invalid service token or customer context.',
  403: 'FORBIDDEN — path customerId does not match the auth context.',
})
@UseGuards(ServiceGuard)
@Controller('customers/:customerId/compliance')
export class ComplianceController {
  constructor(private readonly complianceService: ComplianceService) {}

  /** GET /customers/:customerId/compliance?audience=... — path customerId must match the auth context. */
  @Get()
  @ApiOperation({
    summary: 'Compliance gate',
    description:
      'compliant=false ONLY for EXPIRED_BLOCKING or a not-yet-accepted carry-over state. ' +
      'Without `audience` the result aggregates all of the customer\'s roles.',
  })
  @ApiQuery({ name: 'audience', required: false, description: 'Audience key of the calling tool.' })
  @ApiOkResponse({ type: ComplianceResponseModel })
  @ApiErrorResponses({ 404: 'CUSTOMER_NOT_FOUND', 422: 'UNKNOWN_AUDIENCE' })
  async getCompliance(
    @Param('customerId') customerId: string,
    @Query('audience') audience: string | undefined,
    @Req() req: Request,
  ): Promise<ComplianceResponse> {
    assertCustomerMatchesContext(req, customerId);
    return this.complianceService.getCompliance(customerId, audience);
  }
}

/** HTTP route for the portal popup — thin, logic lives in PendingAgreementsService. */
import { Controller, Get, Param, Query, Req, UseGuards } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { ServiceGuard } from '../common/auth/service.guard';
import { ApiErrorResponses } from '../common/openapi/api-error-responses.decorator';
import { ServiceContextHeaders } from '../common/openapi/security.decorators';
import { PendingAgreementsService, type PendingAgreementItem } from './pending-agreements.service';
import { assertCustomerMatchesContext } from './http/assert-customer-context';
import { PendingAgreementItemModel } from './openapi.models';

@ApiTags('integration-consent')
@ServiceContextHeaders()
@ApiErrorResponses({
  401: 'Missing/invalid service token or customer context.',
  403: 'FORBIDDEN — path customerId does not match the auth context.',
})
@UseGuards(ServiceGuard)
@Controller('customers/:customerId/pending-agreements')
export class PendingAgreementsController {
  constructor(private readonly pendingAgreementsService: PendingAgreementsService) {}

  /** GET /customers/:customerId/pending-agreements?audience=... — path customerId must match the auth context. */
  @Get()
  @ApiOperation({
    summary: 'Popup content — open items for the customer (empty = nothing to show)',
    description:
      'Current PUBLISHED versions with an open state (PENDING_NOTIFICATION | NOTIFIED | ' +
      'EXPIRED_BLOCKING) plus UPCOMING published versions (validFrom in the future, marked ' +
      '`upcoming: true` with their `validFrom`) — acceptance may be collected in advance; the ' +
      'current version stays required until the flip.',
  })
  @ApiQuery({ name: 'audience', required: false, description: 'Audience key of the calling tool.' })
  @ApiOkResponse({ type: [PendingAgreementItemModel] })
  @ApiErrorResponses({ 404: 'CUSTOMER_NOT_FOUND', 422: 'UNKNOWN_AUDIENCE' })
  async getPendingAgreements(
    @Param('customerId') customerId: string,
    @Query('audience') audience: string | undefined,
    @Req() req: Request,
  ): Promise<PendingAgreementItem[]> {
    assertCustomerMatchesContext(req, customerId);
    return this.pendingAgreementsService.getPendingAgreements(customerId, audience);
  }
}

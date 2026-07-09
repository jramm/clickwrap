import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { AdminGuard } from '../common/auth/admin.guard';
import { ApiErrorResponses } from '../common/openapi/api-error-responses.decorator';
import { AdminAuth } from '../common/openapi/security.decorators';
import { EventsService, type EventCategory } from './events.service';
import { EventListResponseModel } from './openapi.models';

/**
 * Legal event / audit log endpoint (admin). One normalized, chronological (newest-first),
 * paginated, filterable list aggregating the existing append-only sources (admin audit log,
 * acceptances, objections, notification events). AdminGuard protects the route.
 */
@ApiTags('admin')
@AdminAuth()
@ApiErrorResponses({ 401: 'Missing/invalid admin authentication.' })
@UseGuards(AdminGuard)
@Controller('admin')
export class EventsController {
  constructor(private readonly eventsService: EventsService) {}

  @Get('events')
  @ApiOperation({
    summary: 'Chronological legal event / audit log (aggregated, filterable, 50/page)',
    description:
      'Normalizes every append-only source (admin audit log, acceptances, objections, notification ' +
      'events) into a single newest-first event list for legal tracing — for the whole system or one ' +
      'customer. Categories: COMMUNICATION (e-mail sent), ACCESS (hosted acceptance page opened), ' +
      'CONSENT (acceptances + objections), ADMINISTRATION (all admin/system actions). All filters run ' +
      'BEFORE pagination, so `total` is the filtered count. A date-only `to` is treated as end-of-day.',
  })
  @ApiQuery({ name: 'customerId', required: false, description: 'Exact customer id.' })
  @ApiQuery({
    name: 'from',
    required: false,
    description: 'Inclusive lower bound on occurredAt (ISO date-time; a date-only value = start of that day).',
  })
  @ApiQuery({
    name: 'to',
    required: false,
    description: 'Inclusive upper bound on occurredAt (ISO date-time; a date-only value = END of that day).',
  })
  @ApiQuery({
    name: 'category',
    required: false,
    enum: ['COMMUNICATION', 'ACCESS', 'CONSENT', 'ADMINISTRATION'],
  })
  @ApiQuery({ name: 'documentType', required: false, description: 'Exact document type key.' })
  @ApiQuery({ name: 'versionId', required: false, description: 'Exact version id.' })
  @ApiQuery({ name: 'page', required: false, description: '1-based page (50 events per page).' })
  @ApiOkResponse({ type: EventListResponseModel })
  async listEvents(
    @Query('customerId') customerId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('category') category?: EventCategory,
    @Query('documentType') documentType?: string,
    @Query('versionId') versionId?: string,
    @Query('page') page?: string,
  ) {
    return this.eventsService.list({
      customerId,
      from,
      to,
      category,
      documentType,
      versionId,
      page: page ? Number(page) : undefined,
    });
  }
}

/**
 * Portal/service endpoints of the consent module.
 * ServiceGuard provides req.customerContext; the customerId in the path MUST match it (FORBIDDEN).
 */
import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  HttpCode,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBody, ApiCreatedResponse, ApiHeader, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import type { CustomerContext } from '../common/auth/actor';
import { ServiceGuard } from '../common/auth/service.guard';
import { ApiErrorResponses } from '../common/openapi/api-error-responses.decorator';
import { ServiceContextHeaders } from '../common/openapi/security.decorators';
import { DomainError } from '../common/errors';
import { AcceptanceService, type AcceptanceResponse } from './acceptance.service';
import {
  acceptanceBodySchema,
  notificationBodySchema,
  objectionBodySchema,
  ZodBodyPipe,
  type AcceptanceBody,
  type NotificationBody,
  type ObjectionBody,
} from './dto';
import { NotificationService, type NotificationResponse } from './notification.service';
import { ObjectionService, type ObjectionResponse } from './objection.service';
import {
  AcceptanceBodyModel,
  AcceptanceResponseModel,
  NotificationBodyModel,
  NotificationResponseModel,
  ObjectionBodyModel,
  ObjectionResponseModel,
} from './openapi.models';

type RequestWithContext = Request & { customerContext?: CustomerContext };

@ApiTags('integration-consent')
@ServiceContextHeaders()
@ApiErrorResponses({
  401: 'Missing/invalid service token or customer context.',
  403: 'FORBIDDEN — path customerId does not match the auth context.',
})
@Controller('customers/:customerId')
@UseGuards(ServiceGuard)
export class ConsentController {
  constructor(
    private readonly acceptanceService: AcceptanceService,
    private readonly objectionService: ObjectionService,
    private readonly notificationService: NotificationService,
  ) {}

  @Post('acceptances')
  @ApiOperation({
    summary: 'Record active consent (Idempotency-Key required)',
    description:
      'The actor comes exclusively from the auth context; displayedConsentText is only a ' +
      'cross-check against the server-side versioned consent text. Replay with the same ' +
      'Idempotency-Key returns the identical 201 response.',
  })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiBody({ type: AcceptanceBodyModel })
  @ApiCreatedResponse({ type: AcceptanceResponseModel })
  @ApiErrorResponses({
    400: 'Missing Idempotency-Key / body validation failed (strict schema).',
    404: 'VERSION_NOT_FOUND',
    409: 'ALREADY_ACCEPTED',
    422: 'VERSION_NOT_CURRENT · ROLE_MISMATCH · CONSENT_TEXT_MISMATCH',
  })
  @HttpCode(201)
  async accept(
    @Param('customerId') customerId: string,
    @Body(new ZodBodyPipe(acceptanceBodySchema)) body: AcceptanceBody,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() req: RequestWithContext,
  ): Promise<AcceptanceResponse> {
    const context = this.contextFor(req, customerId);
    return this.acceptanceService.accept({
      customerId,
      versionId: body.versionId,
      displayedConsentText: body.displayedConsentText,
      idempotencyKey: this.requireIdempotencyKey(idempotencyKey),
      context,
    });
  }

  @Post('objections')
  @ApiOperation({
    summary: 'Record an objection — PASSIVE versions within the objection period only (Idempotency-Key required)',
  })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiBody({ type: ObjectionBodyModel })
  @ApiCreatedResponse({ type: ObjectionResponseModel })
  @ApiErrorResponses({
    400: 'Missing Idempotency-Key / body validation failed.',
    404: 'VERSION_NOT_FOUND',
    422: 'OBJECTION_NOT_APPLICABLE · OBJECTION_PERIOD_EXPIRED',
  })
  @HttpCode(201)
  async object(
    @Param('customerId') customerId: string,
    @Body(new ZodBodyPipe(objectionBodySchema)) body: ObjectionBody,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() req: RequestWithContext,
  ): Promise<ObjectionResponse> {
    const context = this.contextFor(req, customerId);
    return this.objectionService.object({
      customerId,
      versionId: body.versionId,
      reason: body.reason,
      idempotencyKey: this.requireIdempotencyKey(idempotencyKey),
      context,
    });
  }

  @Post('notifications')
  @ApiOperation({
    summary: 'Report delivery ("popup was displayed") — starts the deadline',
    description:
      'notifiedAt is set to SERVER time, atomically and only from PENDING_NOTIFICATION. ' +
      'displayedAt is a plausibility check only. Naturally idempotent (no key needed).',
  })
  @ApiBody({ type: NotificationBodyModel })
  @ApiOkResponse({ type: NotificationResponseModel })
  @ApiErrorResponses({ 400: 'Body validation failed.', 404: 'VERSION_NOT_FOUND', 422: 'INVALID_STATE' })
  @HttpCode(200)
  async notify(
    @Param('customerId') customerId: string,
    @Body(new ZodBodyPipe(notificationBodySchema)) body: NotificationBody,
    @Req() req: RequestWithContext,
  ): Promise<NotificationResponse> {
    const context = this.contextFor(req, customerId);
    return this.notificationService.notify({
      customerId,
      versionId: body.versionId,
      channel: body.channel,
      displayedAt: body.displayedAt ? new Date(body.displayedAt) : undefined,
      context,
    });
  }

  /** The actor comes from the auth context; the path customerId must match the context. */
  private contextFor(req: RequestWithContext, customerId: string): CustomerContext {
    const context = req.customerContext;
    if (!context) {
      throw new DomainError('FORBIDDEN', 'No customer context');
    }
    if (context.customerId !== customerId) {
      throw new DomainError('FORBIDDEN', 'customerId in the path does not match the auth context');
    }
    return context;
  }

  private requireIdempotencyKey(key: string | undefined): string {
    if (!key || key.trim() === '') {
      throw new BadRequestException('Idempotency-Key header is required');
    }
    return key;
  }
}

/**
 * Integration onboarding endpoint: an integrator creates a customer (typically right after a
 * signed offer) — optionally recording the signed document versions as IMPORT acceptances in the
 * same call. Auth: service token WITHOUT a customer context (there is no customer yet), via
 * {@link ServiceTokenGuard}. The customer-scoped routes keep the stricter {@link ServiceGuard}.
 */
import { Body, Controller, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBody, ApiCreatedResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import type { Actor } from '../common/auth/actor';
import { ServiceTokenGuard } from '../common/auth/service-token.guard';
import { ApiErrorResponses } from '../common/openapi/api-error-responses.decorator';
import { ServiceApiKey } from '../common/openapi/security.decorators';
import { CustomerAdminService, type CreateCustomerResult } from '../customers/customer-admin.service';
import { createCustomerBodySchema, type CreateCustomerBody } from '../customers/dto';
import { CreateCustomerBodyModel, CreateCustomerResponseModel } from '../customers/openapi.models';
import { ZodBodyPipe } from './dto';

type RequestWithServiceActor = Request & { serviceActor?: Actor };

@ApiTags('integration-customers')
@ServiceApiKey()
@Controller('customers')
@UseGuards(ServiceTokenGuard)
export class CustomerOnboardingController {
  constructor(private readonly customerAdminService: CustomerAdminService) {}

  @Post()
  @HttpCode(201)
  @ApiOperation({
    summary: 'Create a customer (integration onboarding)',
    description:
      'Creates a customer, optionally recording versions the customer already accepted out-of-band ' +
      '(e.g. by signing an offer) as IMPORT acceptances in the same call. A `roles` change takes ' +
      'effect on the next publish/rollout only. `externalRef` is unique only among customers with ' +
      'OVERLAPPING roles (the partner and customer external ID spaces are separate): a duplicate ' +
      'that shares at least one role returns 422 INVALID_STATE — integrators can treat that as the ' +
      'idempotency signal per overlapping role set. Use distinct refs per audience space, or GET ' +
      'first, to avoid ambiguity.',
  })
  @ApiBody({ type: CreateCustomerBodyModel })
  @ApiCreatedResponse({ type: CreateCustomerResponseModel, description: 'Customer created (with importedAcceptances).' })
  @ApiErrorResponses({
    400: 'Body validation failed (strict schema — no actor fields in the body).',
    401: 'Missing/invalid service token.',
    404: 'VERSION_NOT_FOUND (acceptedVersions)',
    422: 'INVALID_STATE (externalRef duplicate sharing a role / invalid input) · UNKNOWN_AUDIENCE · ROLE_MISMATCH',
  })
  async create(
    @Body(new ZodBodyPipe(createCustomerBodySchema)) body: CreateCustomerBody,
    @Req() req: RequestWithServiceActor,
  ): Promise<CreateCustomerResult> {
    const actor: Actor = req.serviceActor ?? { userId: 'service' };
    return this.customerAdminService.create(body, actor, 'integration');
  }
}

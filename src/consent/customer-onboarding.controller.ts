/**
 * Integration onboarding endpoint: an integrator creates a customer (typically right after a
 * signed offer) — optionally recording the signed document versions as IMPORT acceptances in the
 * same call. Auth: service token WITHOUT a customer context (there is no customer yet), via
 * {@link ServiceTokenGuard}. The customer-scoped routes keep the stricter {@link ServiceGuard}.
 */
import { BadRequestException, Body, Controller, Delete, HttpCode, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBody, ApiCreatedResponse, ApiNoContentResponse, ApiOkResponse, ApiOperation, ApiParam, ApiQuery, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import type { Actor } from '../common/auth/actor';
import { ServiceTokenGuard } from '../common/auth/service-token.guard';
import { ApiErrorResponses } from '../common/openapi/api-error-responses.decorator';
import { ServiceApiKey } from '../common/openapi/security.decorators';
import { CustomerAdminService, type CreateCustomerResult, type CustomerRow } from '../customers/customer-admin.service';
import {
  createCustomerBodySchema,
  upsertByExternalRefBodySchema,
  type CreateCustomerBody,
  type UpsertByExternalRefBody,
} from '../customers/dto';
import {
  CreateCustomerBodyModel,
  CreateCustomerResponseModel,
  CustomerRowModel,
  UpsertByExternalRefBodyModel,
} from '../customers/openapi.models';
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

  @Put('by-external-ref/:externalRef')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Upsert a customer by external reference (inbound integration)',
    description:
      'Idempotent inbound upsert through which an upstream system (the metergrid Main Portal) PUSHES ' +
      'a provider-group customer into clickwrap (clickwrap never pulls). Resolved by (`externalRef`, ' +
      '`audience`) — the target is the record carrying `externalRef` whose `roles` OVERLAP the body ' +
      "`roles` (an `externalRef` is only unique per audience), INCLUDING soft-deleted records: no " +
      'overlapping match → CREATE → CUSTOMER_CREATED; a soft-deleted match → REACTIVATE + apply ' +
      'fields → CUSTOMER_UPDATED; an active match with a real change → UPDATE the changed fields → ' +
      'CUSTOMER_UPDATED; an active match with no change → no write and no event (idempotent). A ' +
      'different-audience customer sharing the same `externalRef` is never touched. `source` (default ' +
      "`external`) is stored as a provenance tag on create only — it is NOT the resolution key.",
  })
  @ApiParam({ name: 'externalRef', description: "Caller's stable external reference (non-empty)." })
  @ApiBody({ type: UpsertByExternalRefBodyModel })
  @ApiOkResponse({ type: CustomerRowModel, description: 'The upserted customer row.' })
  @ApiErrorResponses({
    400: 'Body validation failed (strict schema — no actor fields in the body).',
    401: 'Missing/invalid service token.',
    422: 'UNKNOWN_AUDIENCE (unknown role) · INVALID_STATE (invalid e-mail / externalRef / overlapping duplicate)',
  })
  async upsertByExternalRef(
    @Param('externalRef') externalRef: string,
    @Body(new ZodBodyPipe(upsertByExternalRefBodySchema)) body: UpsertByExternalRefBody,
    @Req() req: RequestWithServiceActor,
  ): Promise<CustomerRow> {
    const actor: Actor = req.serviceActor ?? { userId: 'service' };
    return this.customerAdminService.upsertByExternalRef({ ...body, externalRef }, actor);
  }

  @Delete('by-external-ref/:externalRef')
  @HttpCode(204)
  @ApiOperation({
    summary: 'Deactivate a customer by external reference (inbound integration)',
    description:
      'Idempotent inbound soft-delete used when an upstream provider group is merged away. Resolved ' +
      'by (`externalRef`, `audience`) — the required `?audience=` query param names the audience ' +
      'whose record is deactivated (an `externalRef` is only unique per audience). Soft-deletes the ' +
      'matching active customer (evidence chain preserved) → CUSTOMER_DELETED; a different-audience ' +
      'customer sharing the `externalRef` is left untouched. Not found or already deactivated → ' +
      'idempotent no-op (no event). Returns 204. Missing `audience` → 400.',
  })
  @ApiParam({ name: 'externalRef', description: "Caller's stable external reference." })
  @ApiQuery({ name: 'audience', required: true, description: 'Audience key whose record is deactivated.' })
  @ApiNoContentResponse({ description: 'Customer deactivated (or already inactive / not found — idempotent).' })
  @ApiErrorResponses({ 400: 'Missing `audience` query parameter.', 401: 'Missing/invalid service token.' })
  async deactivateByExternalRef(
    @Param('externalRef') externalRef: string,
    @Query('audience') audience: string | undefined,
    @Req() req: RequestWithServiceActor,
  ): Promise<void> {
    if (!audience || audience.trim() === '') {
      throw new BadRequestException('audience query parameter is required');
    }
    const actor: Actor = req.serviceActor ?? { userId: 'service' };
    await this.customerAdminService.deactivateByExternalRef(externalRef, audience, actor);
  }
}

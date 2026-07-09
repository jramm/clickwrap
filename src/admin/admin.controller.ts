import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import {
  ApiBody,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';
import {
  AcceptanceLinkAdminService,
  type CreateAcceptanceLinkInput,
} from '../accept/acceptance-link-admin.service';
import {
  CreateAcceptanceLinkBodyModel,
  CreateAcceptanceLinkResponseModel,
} from '../accept/openapi.models';
import { AdminGuard } from '../common/auth/admin.guard';
import { ApiErrorResponses } from '../common/openapi/api-error-responses.decorator';
import { AdminAuth } from '../common/openapi/security.decorators';
import { PublishService } from '../agreements/publish.service';
import type { Actor } from '../common/auth/actor';
import {
  CustomerAdminService,
  type CreateCustomerInput,
  type UpdateCustomerInput,
} from '../customers/customer-admin.service';
import { createCustomerBodySchema, updateCustomerBodySchema } from '../customers/dto';
import {
  CreateCustomerBodyModel,
  CreateCustomerResponseModel,
  CustomerListResponseModel,
  CustomerRowModel,
  UpdateCustomerBodyModel,
} from '../customers/openapi.models';
import { PublishResponseModel } from '../agreements/openapi.models';
import {
  CreateDocumentTypeBodyModel,
  CreateEmailTemplateBodyModel,
  CreateNamedEntityBodyModel,
  CustomerHistoryResponseModel,
  CustomerVersionStateModel,
  DashboardResponseModel,
  DocumentTypeModel,
  EmailTemplateModel,
  EmailTemplatePreviewBodyModel,
  EmailTemplatePreviewResponseModel,
  ManualAcceptanceBodyModel,
  ManualAcceptanceResponseModel,
  NamedEntityModel,
  PatchStateBodyModel,
  UpdateDocumentTypeBodyModel,
  UpdateEmailTemplateBodyModel,
  UpdateNamedEntityBodyModel,
  VersionCustomersResponseModel,
  VersionStatsModel,
} from './openapi.models';
import { ZodBodyPipe } from '../consent/dto';
import { AudienceAdminService, type CreateAudienceInput } from './audience-admin.service';
import { CustomerVersionStateAdminService } from './customer-version-state-admin.service';
import { DocumentTypeAdminService, type CreateDocumentTypeInput } from './document-type-admin.service';
import {
  EmailTemplateAdminService,
  type CreateEmailTemplateInput,
  type UpdateEmailTemplateInput,
} from './email-template-admin.service';
import {
  createEmailTemplateBodySchema,
  emailTemplatePreviewBodySchema,
  updateEmailTemplateBodySchema,
  type EmailTemplatePreviewBody,
} from './email-template.dto';
import { DashboardService } from './dashboard.service';
import { HistoryService } from './history.service';
import { ManualAcceptanceService } from './manual-acceptance.service';
import {
  VersionCustomersService,
  type VersionCustomerFilterState,
} from './version-customers.service';

type AdminRequest = Request & { adminActor?: { userId: string } };

interface ManualAcceptanceBody {
  versionId: string;
  method: 'ACTIVE_CONSENT' | 'IMPORT';
  reason: string;
  /** Evidence as base64 (until multipart/multer is integrated). */
  evidenceDocument: string;
  evidenceFileName: string;
}

interface PatchStateBody {
  deadlineAt?: string;
  suspendBlock?: boolean;
  reason: string;
}

const adminUserId = (req: AdminRequest): string => req.adminActor?.userId ?? 'admin';
const adminActorOf = (req: AdminRequest): Actor => ({ userId: adminUserId(req) });

/** Admin operations endpoints. AdminGuard protects all routes; mutations write the audit log. */
@ApiTags('admin')
@AdminAuth()
@ApiErrorResponses({ 401: 'Missing/invalid admin authentication.' })
@UseGuards(AdminGuard)
@Controller('admin')
export class AdminController {
  constructor(
    private readonly publishService: PublishService,
    private readonly dashboardService: DashboardService,
    private readonly versionCustomersService: VersionCustomersService,
    private readonly historyService: HistoryService,
    private readonly manualAcceptanceService: ManualAcceptanceService,
    private readonly customerVersionStateAdminService: CustomerVersionStateAdminService,
    private readonly audienceAdminService: AudienceAdminService,
    private readonly documentTypeAdminService: DocumentTypeAdminService,
    private readonly emailTemplateAdminService: EmailTemplateAdminService,
    private readonly customerAdminService: CustomerAdminService,
    private readonly acceptanceLinkAdminService: AcceptanceLinkAdminService,
  ) {}

  @Get('customers')
  @ApiOperation({ summary: 'List customers (paginated, 50/page, sorted by name/externalRef).' })
  @ApiQuery({ name: 'page', required: false, description: '1-based page (50 rows per page).' })
  @ApiQuery({
    name: 'search',
    required: false,
    description:
      'Case-insensitive substring match on name, externalRef and contactEmails. Applied before ' +
      'pagination; `total` reflects the filtered count.',
  })
  @ApiOkResponse({ type: CustomerListResponseModel })
  async listCustomers(@Query('page') page?: string, @Query('search') search?: string) {
    return this.customerAdminService.list(page ? Number(page) : undefined, search);
  }

  @Get('customers/:id')
  @ApiOperation({
    summary: 'Get a single customer by id',
    description: 'The full customer record (id, externalRef, firstName, lastName, companyName, roles, contactEmails) — e.g. for the detail-page header.',
  })
  @ApiOkResponse({ type: CustomerRowModel })
  @ApiErrorResponses({ 404: 'CUSTOMER_NOT_FOUND' })
  async getCustomer(@Param('id') id: string) {
    return this.customerAdminService.get(id);
  }

  @Post('customers')
  @ApiOperation({
    summary: 'Create a customer',
    description:
      'Roles are validated against the audiences; a role change takes effect on the next ' +
      'publish/rollout only (no auto-rollout here). Optional `acceptedVersions` records already ' +
      'signed versions as IMPORT acceptances. externalRef is unique only among customers with ' +
      'OVERLAPPING roles — the partner and customer external ID spaces are separate, so the same ' +
      'externalRef may coexist on records with disjoint roles; a duplicate that shares at least ' +
      'one role → 422 INVALID_STATE.',
  })
  @ApiBody({ type: CreateCustomerBodyModel })
  @ApiCreatedResponse({ type: CreateCustomerResponseModel })
  @ApiErrorResponses({
    400: 'Body validation failed (strict schema).',
    404: 'VERSION_NOT_FOUND (acceptedVersions)',
    422: 'INVALID_STATE (externalRef duplicate sharing a role, invalid e-mail) · UNKNOWN_AUDIENCE · ROLE_MISMATCH',
  })
  async createCustomer(
    @Body(new ZodBodyPipe(createCustomerBodySchema)) body: CreateCustomerInput,
    @Req() req: AdminRequest,
  ) {
    return this.customerAdminService.create(body, adminActorOf(req), 'admin');
  }

  @Patch('customers/:id')
  @ApiOperation({
    summary: 'Update a customer (subset of firstName/lastName/companyName/roles/contactEmails)',
    description:
      'A `roles` change takes effect on the next publish/rollout only (no auto-rollout on role ' +
      'add). Adding a role is rejected with 422 INVALID_STATE if it would overlap another customer ' +
      'that already shares this externalRef.',
  })
  @ApiBody({ type: UpdateCustomerBodyModel })
  @ApiOkResponse({ type: CustomerRowModel })
  @ApiErrorResponses({
    400: 'Body validation failed (strict schema).',
    404: 'CUSTOMER_NOT_FOUND',
    422: 'INVALID_STATE (invalid e-mail, externalRef overlap on role add) · UNKNOWN_AUDIENCE',
  })
  async updateCustomer(
    @Param('id') id: string,
    @Body(new ZodBodyPipe(updateCustomerBodySchema)) body: UpdateCustomerInput,
    @Req() req: AdminRequest,
  ) {
    return this.customerAdminService.update(id, body, adminActorOf(req));
  }

  @Post('customers/:id/acceptance-links')
  @ApiOperation({
    summary: 'Mint a hosted acceptance link for a customer',
    description:
      'Returns `${PUBLIC_BASE_URL}/accept/<token>` — a capability URL the admin sends directly ' +
      'to the person who has to accept (no portal integration needed). The raw token appears ' +
      'only in this response; the server persists just its SHA-256. Optional `audienceKey` ' +
      'scopes the page to one audience; `expiresInDays` defaults to 30 (max 365). Writes an ' +
      'ACCEPTANCE_LINK_CREATE audit entry.',
  })
  @ApiBody({ type: CreateAcceptanceLinkBodyModel, required: false })
  @ApiCreatedResponse({ type: CreateAcceptanceLinkResponseModel })
  @ApiErrorResponses({
    404: 'CUSTOMER_NOT_FOUND',
    422: 'INVALID_STATE (PUBLIC_BASE_URL unset, expiresInDays out of range) · UNKNOWN_AUDIENCE',
  })
  async createAcceptanceLink(
    @Param('id') customerId: string,
    @Body() body: CreateAcceptanceLinkInput | undefined,
    @Req() req: AdminRequest,
  ) {
    return this.acceptanceLinkAdminService.create(
      customerId,
      { audienceKey: body?.audienceKey, expiresInDays: body?.expiresInDays },
      adminUserId(req),
    );
  }

  @Post('versions/:id/publish')
  @ApiOperation({
    summary: 'Publish a DRAFT version (immutable afterwards) + rollout',
    description:
      'Retires the previous version, supersedes its open customer states, creates ' +
      'PENDING_NOTIFICATION states for all customers with a matching role and triggers e-mails. ' +
      'Scheduled effectiveness: with a FUTURE validFrom the rollout still happens immediately ' +
      '(advance acceptance), but the previous version stays PUBLISHED — it remains the ' +
      'compliance baseline until the flip at validFrom, when the activation sweeper retires it ' +
      'and supersedes its open states.',
  })
  @ApiCreatedResponse({ type: PublishResponseModel })
  @ApiErrorResponses({
    404: 'VERSION_NOT_FOUND',
    409: 'VERSION_IMMUTABLE',
    422: 'CHANGE_SUMMARY_REQUIRED · CONSENT_TEXT_REQUIRED · INVALID_STATE',
  })
  async publish(@Param('id') versionId: string, @Req() req: AdminRequest) {
    return this.publishService.publish(versionId, adminUserId(req));
  }

  @Get('dashboard')
  @ApiOperation({
    summary: 'Per-version acceptance dashboard — current + upcoming published versions',
    description:
      'One entry per RELEVANT version (the current published version and, if any, the upcoming ' +
      'scheduled published version of every document) with acceptance counters: totalCustomers ' +
      '(relevant/non-SUPERSEDED states), accepted, acceptedByChannel/Method, pending, blocked, ' +
      'objected and acceptanceRate.',
  })
  @ApiOkResponse({ type: DashboardResponseModel })
  async dashboard() {
    return this.dashboardService.dashboard();
  }

  @Get('versions/:id/stats')
  @ApiOperation({ summary: 'Acceptance counters for a single version' })
  @ApiOkResponse({ type: VersionStatsModel })
  @ApiErrorResponses({ 404: 'VERSION_NOT_FOUND' })
  async versionStats(@Param('id') versionId: string) {
    return this.dashboardService.versionStats(versionId);
  }

  @Get('versions/:id/customers')
  @ApiOperation({
    summary: 'Per-version customer status list (pages of 50)',
    description:
      'Every row reports the customer state and acceptance FOR THIS version (not the currently ' +
      'effective one) — so drilling into an upcoming version shows who has (not) accepted THAT ' +
      'version. SUPERSEDED states are excluded; `acceptance` is the effective acceptance of this ' +
      'version only. `stats` reuses the dashboard per-version counters so the header matches the card.',
  })
  @ApiQuery({ name: 'state', required: false, enum: ['accepted', 'pending', 'blocked', 'objected'] })
  @ApiQuery({
    name: 'search',
    required: false,
    description: 'Case-insensitive substring on the customer name / externalRef / contactEmails.',
  })
  @ApiQuery({ name: 'page', required: false })
  @ApiOkResponse({ type: VersionCustomersResponseModel })
  @ApiErrorResponses({ 404: 'VERSION_NOT_FOUND' })
  async versionCustomers(
    @Param('id') versionId: string,
    @Query('state') state?: VersionCustomerFilterState,
    @Query('search') search?: string,
    @Query('page') page?: string,
  ) {
    return this.versionCustomersService.list(versionId, {
      state,
      search,
      page: page ? Number(page) : undefined,
    });
  }

  @Get('customers/:id/history')
  @ApiOperation({ summary: 'Full customer history incl. evidence and rollout states' })
  @ApiOkResponse({ type: CustomerHistoryResponseModel })
  @ApiErrorResponses({ 404: 'CUSTOMER_NOT_FOUND' })
  async history(@Param('id') customerId: string) {
    return this.historyService.history(customerId);
  }

  @Post('customers/:id/acceptances')
  @ApiOperation({ summary: 'Manual (back-dated) acceptance recording — reason + evidence required' })
  @ApiBody({ type: ManualAcceptanceBodyModel })
  @ApiCreatedResponse({ type: ManualAcceptanceResponseModel })
  @ApiErrorResponses({
    404: 'CUSTOMER_NOT_FOUND · VERSION_NOT_FOUND',
    409: 'ALREADY_ACCEPTED',
    422: 'INVALID_STATE (missing reason/evidence) · ROLE_MISMATCH',
  })
  async manualAcceptance(
    @Param('id') customerId: string,
    @Body() body: ManualAcceptanceBody,
    @Req() req: AdminRequest,
  ) {
    return this.manualAcceptanceService.record(
      customerId,
      {
        versionId: body.versionId,
        method: body.method,
        reason: body.reason,
        evidenceDocument: {
          buffer: Buffer.from(body.evidenceDocument ?? '', 'base64'),
          fileName: body.evidenceFileName,
        },
      },
      adminActorOf(req),
    );
  }

  @Patch('customer-version-states/:id')
  @ApiOperation({ summary: 'Extend a deadline / suspend a block (reason required)' })
  @ApiBody({ type: PatchStateBodyModel })
  @ApiOkResponse({ type: CustomerVersionStateModel })
  @ApiErrorResponses({ 404: 'VERSION_NOT_FOUND (unknown state id)', 422: 'INVALID_STATE' })
  async patchState(@Param('id') stateId: string, @Body() body: PatchStateBody, @Req() req: AdminRequest) {
    return this.customerVersionStateAdminService.patch(
      stateId,
      {
        deadlineAt: body.deadlineAt ? new Date(body.deadlineAt) : undefined,
        suspendBlock: body.suspendBlock,
        reason: body.reason,
      },
      adminUserId(req),
    );
  }

  @Post('customer-version-states/:id/remind')
  @ApiOperation({ summary: 'Re-send the reminder e-mail (remindersSent++)' })
  @ApiCreatedResponse({ type: CustomerVersionStateModel })
  @ApiErrorResponses({ 404: 'VERSION_NOT_FOUND (unknown state id)', 422: 'INVALID_STATE' })
  async remind(@Param('id') stateId: string, @Req() req: AdminRequest) {
    return this.customerVersionStateAdminService.remind(stateId, adminUserId(req));
  }

  @Get('audiences')
  @ApiOperation({ summary: 'List audiences (sorted by key)' })
  @ApiOkResponse({ type: [NamedEntityModel] })
  async listAudiences() {
    return this.audienceAdminService.list();
  }

  @Post('audiences')
  @ApiOperation({ summary: 'Create an audience' })
  @ApiBody({ type: CreateNamedEntityBodyModel })
  @ApiCreatedResponse({ type: NamedEntityModel })
  @ApiErrorResponses({ 422: 'INVALID_STATE (invalid slug, duplicate key, missing name)' })
  async createAudience(@Body() body: CreateAudienceInput, @Req() req: AdminRequest) {
    return this.audienceAdminService.create(body, adminUserId(req));
  }

  @Patch('audiences/:id')
  @ApiOperation({ summary: 'Rename an audience (key is immutable)' })
  @ApiBody({ type: UpdateNamedEntityBodyModel })
  @ApiOkResponse({ type: NamedEntityModel })
  @ApiErrorResponses({ 404: 'Unknown id.', 422: 'INVALID_STATE (key in the body)' })
  async updateAudience(@Param('id') id: string, @Body() body: Record<string, unknown>, @Req() req: AdminRequest) {
    return this.audienceAdminService.update(id, body, adminUserId(req));
  }

  @Delete('audiences/:id')
  @ApiOperation({ summary: 'Delete an unreferenced audience' })
  @ApiResponse({ status: 204, description: 'Deleted.' })
  @ApiErrorResponses({ 404: 'Unknown id.', 422: 'INVALID_STATE (still referenced)' })
  @HttpCode(204)
  async deleteAudience(@Param('id') id: string, @Req() req: AdminRequest): Promise<void> {
    await this.audienceAdminService.remove(id, adminUserId(req));
  }

  @Get('document-types')
  @ApiOperation({ summary: 'List document types (sorted by key) incl. e-mail template assignments' })
  @ApiOkResponse({ type: [DocumentTypeModel] })
  async listDocumentTypes() {
    return this.documentTypeAdminService.list();
  }

  @Post('document-types')
  @ApiOperation({
    summary: 'Create a document type',
    description:
      'Set `external: true` to create an externally-signed document type (SignedDocument flow — no ' +
      'versions/publish/gate). `external` is settable only here and immutable afterwards.',
  })
  @ApiBody({ type: CreateDocumentTypeBodyModel })
  @ApiCreatedResponse({ type: DocumentTypeModel })
  @ApiErrorResponses({ 422: 'INVALID_STATE (invalid slug, duplicate key, missing name)' })
  async createDocumentType(@Body() body: CreateDocumentTypeInput, @Req() req: AdminRequest) {
    return this.documentTypeAdminService.create(body, adminUserId(req));
  }

  @Patch('document-types/:id')
  @ApiOperation({
    summary: 'Rename a document type / assign e-mail templates (key is immutable)',
    description:
      'Assign per-document-type notification/reminder templates via notificationTemplateId / ' +
      'reminderTemplateId (must reference an existing template of the matching kind); `null` ' +
      'clears an assignment, an omitted field keeps it.',
  })
  @ApiBody({ type: UpdateDocumentTypeBodyModel })
  @ApiOkResponse({ type: DocumentTypeModel })
  @ApiErrorResponses({
    404: 'Unknown id.',
    422: 'INVALID_STATE (key in the body, unknown/incompatible template)',
  })
  async updateDocumentType(
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
    @Req() req: AdminRequest,
  ) {
    return this.documentTypeAdminService.update(id, body, adminUserId(req));
  }

  @Delete('document-types/:id')
  @ApiOperation({ summary: 'Delete an unreferenced document type' })
  @ApiResponse({ status: 204, description: 'Deleted.' })
  @ApiErrorResponses({ 404: 'Unknown id.', 422: 'INVALID_STATE (still referenced)' })
  @HttpCode(204)
  async deleteDocumentType(@Param('id') id: string, @Req() req: AdminRequest): Promise<void> {
    await this.documentTypeAdminService.remove(id, adminUserId(req));
  }

  @Get('email-templates')
  @ApiOperation({ summary: 'List e-mail templates (sorted by name; default rows flagged)' })
  @ApiOkResponse({ type: [EmailTemplateModel] })
  async listEmailTemplates() {
    return this.emailTemplateAdminService.list();
  }

  @Post('email-templates')
  @ApiOperation({ summary: 'Create an e-mail template' })
  @ApiBody({ type: CreateEmailTemplateBodyModel })
  @ApiCreatedResponse({ type: EmailTemplateModel })
  @ApiErrorResponses({ 400: 'Body validation failed (strict schema).' })
  async createEmailTemplate(
    @Body(new ZodBodyPipe(createEmailTemplateBodySchema)) body: CreateEmailTemplateInput,
    @Req() req: AdminRequest,
  ) {
    return this.emailTemplateAdminService.create(body, adminUserId(req));
  }

  @Patch('email-templates/:id')
  @ApiOperation({ summary: 'Update an e-mail template (default rows are editable)' })
  @ApiBody({ type: UpdateEmailTemplateBodyModel })
  @ApiOkResponse({ type: EmailTemplateModel })
  @ApiErrorResponses({ 400: 'Body validation failed (strict schema).', 404: 'Unknown id.' })
  async updateEmailTemplate(
    @Param('id') id: string,
    @Body(new ZodBodyPipe(updateEmailTemplateBodySchema)) body: UpdateEmailTemplateInput,
    @Req() req: AdminRequest,
  ) {
    return this.emailTemplateAdminService.update(id, body, adminUserId(req));
  }

  @Delete('email-templates/:id')
  @ApiOperation({ summary: 'Delete an e-mail template (default rows and assigned ones are refused)' })
  @ApiResponse({ status: 204, description: 'Deleted.' })
  @ApiErrorResponses({
    404: 'Unknown id.',
    422: 'INVALID_STATE (default template, or still assigned to a document type)',
  })
  @HttpCode(204)
  async deleteEmailTemplate(@Param('id') id: string, @Req() req: AdminRequest): Promise<void> {
    await this.emailTemplateAdminService.remove(id, adminUserId(req));
  }

  @Post('email-templates/:id/preview')
  @ApiOperation({ summary: 'Render a template with realistic sample values (subject/html/text)' })
  @ApiBody({ type: EmailTemplatePreviewBodyModel, required: false })
  @ApiOkResponse({ type: EmailTemplatePreviewResponseModel })
  @ApiErrorResponses({ 400: 'Body validation failed (strict schema).', 404: 'Unknown id.' })
  @HttpCode(200)
  async previewEmailTemplate(
    @Param('id') id: string,
    @Body(new ZodBodyPipe(emailTemplatePreviewBodySchema)) body: EmailTemplatePreviewBody,
  ) {
    return this.emailTemplateAdminService.preview(id, body.documentTypeKey);
  }
}

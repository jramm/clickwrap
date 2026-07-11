/**
 * Integration surface for externally-signed documents. The customer is addressed by query
 * parameter — either `customerId` or `externalRef` (+ required `audience`); see
 * {@link resolveIntegrationCustomer}. Auth: shared service token via {@link ServiceTokenGuard}.
 * `uploadedBy` is taken from the forwarded actor headers (`x-actor-*`), never the body. Reuses
 * {@link SignedDocumentService}, so there is no logic duplication with the admin surface; the
 * integration path does NOT write the admin audit log.
 */
import { Body, Controller, Get, HttpCode, Inject, Post, Query, Req, UseGuards, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import type { Actor } from '../common/auth/actor.js';
import { ServiceTokenGuard } from '../common/auth/service-token.guard.js';
import { resolveIntegrationCustomer } from '../common/integration/resolve-customer.js';
import { ApiErrorResponses } from '../common/openapi/api-error-responses.decorator.js';
import { ServiceApiKey } from '../common/openapi/security.decorators.js';
import type { AudienceRepo, CustomerRepo } from '../domain/ports.js';
import { TOKENS } from '../persistence/tokens.js';
import { buildUploadInput, MAX_SIGNED_PDF_BYTES, type SignedDocumentUploadBody } from './multipart.js';
import { SignedDocumentListResponseModel, SignedDocumentModel, SignedDocumentUploadBodyModel } from './openapi.models.js';
import { SignedDocumentService } from './signed-document.service.js';

type RequestWithServiceActor = Request & { serviceActor?: Actor };

const CUSTOMER_QUERY = [
  { name: 'customerId', required: false, description: 'Internal customer id (exactly one of customerId | externalRef).' },
  { name: 'externalRef', required: false, description: "Caller's external reference (requires audience)." },
  { name: 'audience', required: false, description: 'Required with externalRef (resolution discriminator).' },
] as const;

@ApiTags('integration-customers')
@ServiceApiKey()
@ApiErrorResponses({ 401: 'Missing/invalid service token.' })
@Controller('customers')
@UseGuards(ServiceTokenGuard)
export class SignedDocumentsIntegrationController {
  constructor(
    private readonly signedDocuments: SignedDocumentService,
    @Inject(TOKENS.CustomerRepo) private readonly customers: CustomerRepo,
    @Inject(TOKENS.AudienceRepo) private readonly audiences: AudienceRepo,
  ) {}

  /** POST /customers/signed-documents?customerId=... | ?externalRef=...&audience=... */
  @Post('signed-documents')
  @HttpCode(201)
  @ApiOperation({
    summary: 'Upload an externally-signed document for a customer (integration)',
    description:
      'Resolves the customer by `customerId` or `externalRef`+`audience`, then archives an ' +
      'externally-signed PDF (e.g. a counter-signed offer). The documentType MUST be an external ' +
      'type (422 DOCUMENT_TYPE_NOT_EXTERNAL otherwise). Signed documents are a pure evidence ' +
      'archive and NEVER affect the compliance gate.',
  })
  @ApiQuery(CUSTOMER_QUERY[0])
  @ApiQuery(CUSTOMER_QUERY[1])
  @ApiQuery(CUSTOMER_QUERY[2])
  @ApiConsumes('multipart/form-data', 'application/json')
  @ApiBody({ type: SignedDocumentUploadBodyModel })
  @ApiCreatedResponse({ type: SignedDocumentModel })
  @ApiErrorResponses({
    400: 'Bad customer selector / PDF / documentTypeKey / signedAt missing.',
    404: 'CUSTOMER_NOT_FOUND',
    422: 'UNKNOWN_DOCUMENT_TYPE · DOCUMENT_TYPE_NOT_EXTERNAL · UNKNOWN_AUDIENCE',
  })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_SIGNED_PDF_BYTES } }))
  async upload(
    @Query('customerId') customerId: string | undefined,
    @Query('externalRef') externalRef: string | undefined,
    @Query('audience') audience: string | undefined,
    @Body() body: SignedDocumentUploadBody,
    @Req() req: RequestWithServiceActor,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    const customer = await resolveIntegrationCustomer(this.customers, this.audiences, { customerId, externalRef, audience });
    const actor: Actor = req.serviceActor ?? { userId: 'service' };
    return this.signedDocuments.upload(customer.id, buildUploadInput(body, file), actor);
  }

  /** GET /customers/signed-documents?customerId=... | ?externalRef=...&audience=... */
  @Get('signed-documents')
  @ApiOperation({ summary: 'List a customer’s signed documents (newest first)' })
  @ApiQuery(CUSTOMER_QUERY[0])
  @ApiQuery(CUSTOMER_QUERY[1])
  @ApiQuery(CUSTOMER_QUERY[2])
  @ApiOkResponse({ type: SignedDocumentListResponseModel })
  @ApiErrorResponses({ 400: 'Bad customer selector.', 404: 'CUSTOMER_NOT_FOUND', 422: 'UNKNOWN_AUDIENCE' })
  async list(
    @Query('customerId') customerId: string | undefined,
    @Query('externalRef') externalRef: string | undefined,
    @Query('audience') audience: string | undefined,
  ) {
    const customer = await resolveIntegrationCustomer(this.customers, this.audiences, { customerId, externalRef, audience });
    return { items: await this.signedDocuments.list(customer.id) };
  }
}

/**
 * Integration surface for externally-signed documents. Auth: shared service token WITHOUT a
 * customer context (the customer id is a path param), via {@link ServiceTokenGuard} — the SAME
 * guard the onboarding endpoint uses. `uploadedBy` is taken from the forwarded actor headers
 * (`x-actor-*`), never the body. Reuses {@link SignedDocumentService}, so there is no logic
 * duplication with the admin surface; the integration path does NOT write the admin audit log.
 */
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import type { Actor } from '../common/auth/actor.js';
import { ServiceTokenGuard } from '../common/auth/service-token.guard.js';
import { ApiErrorResponses } from '../common/openapi/api-error-responses.decorator.js';
import { ServiceApiKey } from '../common/openapi/security.decorators.js';
import { buildUploadInput, MAX_SIGNED_PDF_BYTES, type SignedDocumentUploadBody } from './multipart.js';
import { SignedDocumentListResponseModel, SignedDocumentModel, SignedDocumentUploadBodyModel } from './openapi.models.js';
import { SignedDocumentService } from './signed-document.service.js';

type RequestWithServiceActor = Request & { serviceActor?: Actor };

@ApiTags('integration-customers')
@ServiceApiKey()
@ApiErrorResponses({ 401: 'Missing/invalid service token.' })
@Controller('customers')
@UseGuards(ServiceTokenGuard)
export class SignedDocumentsIntegrationController {
  constructor(private readonly signedDocuments: SignedDocumentService) {}

  @Post(':id/signed-documents')
  @HttpCode(201)
  @ApiOperation({
    summary: 'Upload an externally-signed document for a customer (integration)',
    description:
      'Archives an externally-signed PDF (e.g. a counter-signed offer) against a customer. The ' +
      'documentType MUST be an external type (422 DOCUMENT_TYPE_NOT_EXTERNAL otherwise — non-external ' +
      'types use the version/clickwrap flow). Signed documents are a pure evidence archive and NEVER ' +
      'affect the compliance gate.',
  })
  @ApiConsumes('multipart/form-data', 'application/json')
  @ApiBody({ type: SignedDocumentUploadBodyModel })
  @ApiCreatedResponse({ type: SignedDocumentModel })
  @ApiErrorResponses({
    400: 'PDF / documentTypeKey / signedAt missing.',
    404: 'CUSTOMER_NOT_FOUND',
    422: 'UNKNOWN_DOCUMENT_TYPE · DOCUMENT_TYPE_NOT_EXTERNAL · UNKNOWN_AUDIENCE',
  })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_SIGNED_PDF_BYTES } }))
  async upload(
    @Param('id') customerId: string,
    @Body() body: SignedDocumentUploadBody,
    @Req() req: RequestWithServiceActor,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    const actor: Actor = req.serviceActor ?? { userId: 'service' };
    return this.signedDocuments.upload(customerId, buildUploadInput(body, file), actor);
  }

  @Get(':id/signed-documents')
  @ApiOperation({ summary: 'List a customer’s signed documents (newest first)' })
  @ApiOkResponse({ type: SignedDocumentListResponseModel })
  async list(@Param('id') customerId: string) {
    return { items: await this.signedDocuments.list(customerId) };
  }
}

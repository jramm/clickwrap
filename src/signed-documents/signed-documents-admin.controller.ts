/**
 * Admin surface for externally-signed documents (AdminGuard). Uploads write a SIGNED_DOCUMENT_UPLOAD
 * audit entry (actor from the admin auth context). The download route 302-redirects to a fresh
 * presigned URL so presigned expiry is irrelevant and the endpoint stays storage-plugin-agnostic.
 */
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBody,
  ApiConsumes,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';
import type { Actor } from '../common/auth/actor.js';
import { AdminGuard } from '../common/auth/admin.guard.js';
import { ApiErrorResponses } from '../common/openapi/api-error-responses.decorator.js';
import { AdminAuth } from '../common/openapi/security.decorators.js';
import { buildUploadInput, MAX_SIGNED_PDF_BYTES, type SignedDocumentUploadBody } from './multipart.js';
import { SignedDocumentListResponseModel, SignedDocumentModel, SignedDocumentUploadBodyModel } from './openapi.models.js';
import { SignedDocumentService } from './signed-document.service.js';

type AdminRequest = Request & { adminActor?: { userId: string } };

const adminActorOf = (req: AdminRequest): Actor => ({ userId: req.adminActor?.userId ?? 'admin' });

@ApiTags('admin')
@AdminAuth()
@ApiErrorResponses({ 401: 'Missing/invalid admin authentication.' })
@UseGuards(AdminGuard)
@Controller('admin')
export class SignedDocumentsAdminController {
  constructor(private readonly signedDocuments: SignedDocumentService) {}

  @Post('customers/:id/signed-documents')
  @HttpCode(201)
  @ApiOperation({ summary: 'Upload an externally-signed document for a customer (multipart; base64 JSON fallback)' })
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
    @Req() req: AdminRequest,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    return this.signedDocuments.upload(customerId, buildUploadInput(body, file), adminActorOf(req), {
      recordAudit: true,
    });
  }

  @Get('customers/:id/signed-documents')
  @ApiOperation({ summary: 'List a customer’s signed documents (newest first)' })
  @ApiOkResponse({ type: SignedDocumentListResponseModel })
  async list(@Param('id') customerId: string) {
    return { items: await this.signedDocuments.list(customerId) };
  }

  @Get('signed-documents/:id/pdf')
  @ApiOperation({ summary: 'Download a signed document PDF (302 → presigned URL)' })
  @ApiResponse({ status: 302, description: 'Redirect to a fresh presigned PDF URL (time-limited).' })
  @ApiErrorResponses({ 404: 'VERSION_NOT_FOUND (unknown signed document id)' })
  async pdf(@Param('id') id: string, @Res() res: Response): Promise<void> {
    const url = await this.signedDocuments.getPdfUrl(id);
    res.redirect(302, url);
  }
}

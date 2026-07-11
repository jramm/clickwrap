import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import type { Request } from 'express';
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
import { AdminGuard } from '../common/auth/admin.guard.js';
import { ApiErrorResponses } from '../common/openapi/api-error-responses.decorator.js';
import { AdminAuth } from '../common/openapi/security.decorators.js';
import type { AcceptanceMode } from '../domain/types.js';
import { DocumentService } from './document.service.js';
import {
  AffectedCustomersModel,
  CreateDocumentBodyModel,
  CreateVersionBodyModel,
  CreateVersionResponseModel,
  DocumentListResponseModel,
  DocumentModel,
  PatchVersionBodyModel,
  VersionListResponseModel,
  VersionModel,
} from './openapi.models.js';
import type { PdfUpload } from './ports.js';
import { VersionService, type PatchDraftInput } from './version.service.js';

/** AdminGuard populates `adminActor` on the request; the admin user id defaults to 'admin'. */
type AdminRequest = Request & { adminActor?: { userId: string } };
const adminUserId = (req: AdminRequest): string => req.adminActor?.userId ?? 'admin';

interface CreateDocumentBody {
  /** Document type key (dynamic entity, validated by DocumentService). */
  type: string;
  /** Audience key (dynamic entity, validated by DocumentService). */
  audience: string;
  name: string;
}

/**
 * Version upload: primarily multipart/form-data (field `file`); as a fallback the
 * PDF is still accepted as base64 JSON (`file` + `fileName` in the body). With multipart all
 * metadata arrives as strings — number fields are parsed in the controller.
 */
interface CreateVersionBody {
  /** Fallback: PDF as base64 string (only without a multipart `file`). */
  file?: string;
  fileName?: string;
  versionLabel: string;
  changeSummary: string;
  acceptanceMode: AcceptanceMode;
  consentText?: string;
  objectionPeriodDays?: number | string;
  gracePeriodDays?: number | string;
  /** ACTIVE only: absolute acceptance deadline as a full ISO date-time (must be >= validFrom). */
  hardDeadlineAt?: string;
  validFrom: string;
}

interface PatchVersionBody
  extends Omit<PatchDraftInput, 'validFrom' | 'objectionPeriodDays' | 'gracePeriodDays' | 'hardDeadlineAt'> {
  validFrom?: string;
  objectionPeriodDays?: number | string;
  gracePeriodDays?: number | string;
  hardDeadlineAt?: string;
  /** Fallback: replacement PDF as base64 string (only without a multipart `file`). */
  file?: string;
  fileName?: string;
}

/** PDF max. 20 MB. */
const MAX_PDF_BYTES = 20 * 1024 * 1024;

const base64Upload = (file: string, fileName: string): PdfUpload => ({
  buffer: Buffer.from(file, 'base64'),
  fileName,
});

/** Prefer the multipart `file`; otherwise the base64 fallback from the JSON body; otherwise undefined. */
const resolveUpload = (
  multipartFile: Express.Multer.File | undefined,
  base64File: string | undefined,
  base64FileName: string | undefined,
): PdfUpload | undefined => {
  if (multipartFile) {
    return { buffer: multipartFile.buffer, fileName: multipartFile.originalname };
  }
  if (base64File !== undefined && base64FileName !== undefined) {
    return base64Upload(base64File, base64FileName);
  }
  return undefined;
};

/** Multipart delivers number fields as strings — tolerate both. */
const toOptionalNumber = (value: number | string | undefined): number | undefined => {
  if (value === undefined || value === '') {
    return undefined;
  }
  const parsed = Number(value);
  if (Number.isNaN(parsed)) {
    throw new BadRequestException(`Invalid number: ${String(value)}`);
  }
  return parsed;
};

/**
 * Admin endpoints for documents & versions. AdminGuard protects all routes.
 * PDF upload as multipart/form-data (FileInterceptor, field `file`, max. 20 MB); base64 JSON
 * remains available as a fallback.
 */
@ApiTags('admin')
@AdminAuth()
@ApiErrorResponses({ 401: 'Missing/invalid admin authentication.' })
@UseGuards(AdminGuard)
@Controller('admin')
export class AgreementsAdminController {
  constructor(
    private readonly documentService: DocumentService,
    private readonly versionService: VersionService,
  ) {}

  @Post('documents')
  @ApiOperation({ summary: 'Create a document (one per type × audience)' })
  @ApiBody({ type: CreateDocumentBodyModel })
  @ApiCreatedResponse({ type: DocumentModel })
  @ApiErrorResponses({ 422: 'INVALID_STATE (duplicate) · UNKNOWN_DOCUMENT_TYPE · UNKNOWN_AUDIENCE' })
  async createDocument(@Body() body: CreateDocumentBody, @Req() req: AdminRequest) {
    return this.documentService.create({ type: body.type, audience: body.audience, name: body.name }, adminUserId(req));
  }

  @Get('documents')
  @ApiOperation({ summary: 'List documents (flat) including the current PUBLISHED version DTO (or null)' })
  @ApiOkResponse({ type: DocumentListResponseModel })
  async listDocuments() {
    return { items: await this.documentService.list() };
  }

  @Get('documents/:id/versions')
  @ApiOperation({ summary: 'Version history of a document — every entry carries a presigned pdfUrl' })
  @ApiOkResponse({ type: VersionListResponseModel })
  async listVersions(@Param('id') documentId: string) {
    return { items: await this.versionService.listDtosByDocument(documentId) };
  }

  @Post('documents/:id/versions')
  @ApiOperation({ summary: 'Create a DRAFT version (multipart/form-data primary; base64 JSON fallback)' })
  @ApiConsumes('multipart/form-data', 'application/json')
  @ApiBody({ type: CreateVersionBodyModel })
  @ApiCreatedResponse({ type: CreateVersionResponseModel })
  @ApiErrorResponses({ 400: 'PDF missing / invalid number field.', 422: 'INVALID_STATE (unknown document)' })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_PDF_BYTES } }))
  async createVersion(
    @Param('id') documentId: string,
    @Body() body: CreateVersionBody,
    @Req() req: AdminRequest,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    const base64File = typeof body.file === 'string' ? body.file : undefined;
    const upload = resolveUpload(file, base64File, body.fileName);
    if (!upload) {
      throw new BadRequestException('PDF missing: multipart field `file` or base64 `file`+`fileName` required');
    }
    const version = await this.versionService.createDraft(
      {
        documentId,
        versionLabel: body.versionLabel,
        changeSummary: body.changeSummary,
        acceptanceMode: body.acceptanceMode,
        consentText: body.consentText,
        objectionPeriodDays: toOptionalNumber(body.objectionPeriodDays),
        gracePeriodDays: toOptionalNumber(body.gracePeriodDays),
        hardDeadlineAt: body.hardDeadlineAt !== undefined && body.hardDeadlineAt !== ''
          ? new Date(body.hardDeadlineAt)
          : undefined,
        validFrom: new Date(body.validFrom),
        file: upload,
      },
      adminUserId(req),
    );
    return {
      versionId: version.id,
      status: version.status,
      contentHash: version.contentHash,
      fileName: version.fileName,
    };
  }

  @Get('versions/:id')
  @ApiOperation({ summary: 'Version detail (incl. presigned pdfUrl)' })
  @ApiOkResponse({ type: VersionModel })
  @ApiErrorResponses({ 404: 'VERSION_NOT_FOUND' })
  async getVersion(@Param('id') versionId: string) {
    return this.versionService.getVersionDto(versionId);
  }

  @Get('versions/:id/affected-customers')
  @ApiOperation({
    summary: 'How many customers publishing this version would affect',
    description:
      'Number of customers the publish rollout would target (customers whose roles include the ' +
      'document audience). Lets the admin UI show the impact next to the publish button before a ' +
      'DRAFT is published (issue #27).',
  })
  @ApiOkResponse({ type: AffectedCustomersModel })
  @ApiErrorResponses({ 404: 'VERSION_NOT_FOUND' })
  async getAffectedCustomers(@Param('id') versionId: string) {
    return this.versionService.getAffectedCustomerCount(versionId);
  }

  @Patch('versions/:id')
  @ApiOperation({ summary: 'Patch a DRAFT version (metadata and/or replacement PDF)' })
  @ApiConsumes('multipart/form-data', 'application/json')
  @ApiBody({ type: PatchVersionBodyModel })
  @ApiOkResponse({ description: 'The updated version entity.' })
  @ApiErrorResponses({ 404: 'VERSION_NOT_FOUND', 409: 'VERSION_IMMUTABLE (not a DRAFT)' })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_PDF_BYTES } }))
  async patchVersion(
    @Param('id') versionId: string,
    @Body() body: PatchVersionBody,
    @Req() req: AdminRequest,
    @UploadedFile() multipartFile?: Express.Multer.File,
  ) {
    const { file, fileName, validFrom, objectionPeriodDays, gracePeriodDays, hardDeadlineAt, ...rest } = body;
    const patch: PatchDraftInput = {
      ...rest,
      ...(validFrom !== undefined ? { validFrom: new Date(validFrom) } : {}),
      ...(objectionPeriodDays !== undefined ? { objectionPeriodDays: toOptionalNumber(objectionPeriodDays) } : {}),
      ...(gracePeriodDays !== undefined ? { gracePeriodDays: toOptionalNumber(gracePeriodDays) } : {}),
      ...(hardDeadlineAt !== undefined
        ? { hardDeadlineAt: hardDeadlineAt === '' ? undefined : new Date(hardDeadlineAt) }
        : {}),
    };
    const upload = resolveUpload(multipartFile, typeof file === 'string' ? file : undefined, fileName);
    return this.versionService.patchDraft(versionId, patch, upload, adminUserId(req));
  }

  @Delete('versions/:id')
  @ApiOperation({ summary: 'Delete a DRAFT version' })
  @ApiResponse({ status: 204, description: 'Deleted.' })
  @ApiErrorResponses({ 404: 'VERSION_NOT_FOUND', 409: 'VERSION_IMMUTABLE (not a DRAFT)' })
  @HttpCode(204)
  async deleteVersion(@Param('id') versionId: string) {
    await this.versionService.deleteDraft(versionId);
  }
}

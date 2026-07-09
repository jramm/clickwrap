/**
 * OpenAPI documentation models for the agreements admin endpoints. These classes mirror the
 * runtime interfaces (version.dto.ts, document.service.ts, publish.service.ts) — swagger needs
 * classes with decorators, while the runtime keeps plain interfaces + zod pipes (validation stays
 * with zod; these classes are documentation only).
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class VersionModel {
  @ApiProperty({ example: 'v-4f9f6a…' })
  id!: string;

  @ApiProperty({ example: 'doc-1c2d…' })
  documentId!: string;

  @ApiProperty({ example: 'June 2026 edition' })
  versionLabel!: string;

  @ApiProperty({ enum: ['DRAFT', 'PUBLISHED', 'RETIRED'] })
  status!: string;

  @ApiProperty({ enum: ['ACTIVE', 'PASSIVE'] })
  acceptanceMode!: string;

  @ApiProperty({ example: 'New sub-processor for e-mail delivery.' })
  changeSummary!: string;

  @ApiPropertyOptional({ description: 'Exact checkbox consent text (ACTIVE only).' })
  consentText?: string;

  @ApiPropertyOptional({ example: 14, description: 'PASSIVE only: objection period in days.' })
  objectionPeriodDays?: number;

  @ApiPropertyOptional({ example: 14, description: 'Deprecated: no longer drives ACTIVE blocking (legacy rows only).' })
  gracePeriodDays?: number;

  @ApiPropertyOptional({
    type: String,
    format: 'date-time',
    description: 'ACTIVE only: absolute acceptance deadline. Every customer must accept by then or is blocked, independent of access.',
  })
  hardDeadlineAt?: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  validFrom!: Date;

  @ApiPropertyOptional({ type: String, format: 'date-time' })
  publishedAt?: Date;

  @ApiProperty({ example: 'sha256:9c1e…', description: 'SHA-256 of the PDF content.' })
  contentHash!: string;

  @ApiProperty({ example: 'dpa-2026-06.pdf' })
  fileName!: string;

  @ApiProperty({ description: 'Presigned, time-limited PDF download/preview URL (15-minute TTL).' })
  pdfUrl!: string;
}

export class DocumentListEntryModel {
  @ApiProperty({ example: 'doc-1c2d…' })
  id!: string;

  @ApiProperty({ example: 'dpa', description: 'Document type key.' })
  type!: string;

  @ApiProperty({ example: 'customer', description: 'Audience key.' })
  audience!: string;

  @ApiProperty({ example: 'DPA — Customers' })
  name!: string;

  @ApiPropertyOptional({ type: VersionModel, nullable: true, description: 'Current PUBLISHED version or null.' })
  currentVersion!: VersionModel | null;

  @ApiProperty({
    type: [VersionModel],
    description:
      'ALL UPCOMING published versions (validFrom in the future, scheduled publish), ordered by ' +
      'validFrom ascending (the nearest flip first). Empty when none are scheduled. Several future ' +
      'versions may be scheduled simultaneously — every one is listed, not just the next. The ' +
      'current version stays the compliance baseline until the flip at the nearest one\'s validFrom.',
  })
  upcomingVersions!: VersionModel[];

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description:
      'Stable public URL (`${PUBLIC_BASE_URL}/documents/<type>/<audience>/latest.pdf`) that ' +
      'always 302-redirects to the currently effective published PDF — deterministic from the ' +
      'document keys, valid across future publishes (for rendering into offers). Null when no ' +
      'published version is in effect or PUBLIC_BASE_URL is unset.',
    example: 'https://clickwrap.example.org/documents/dpa/customer/latest.pdf',
  })
  latestPdfUrl!: string | null;
}

export class DocumentListResponseModel {
  @ApiProperty({ type: [DocumentListEntryModel] })
  items!: DocumentListEntryModel[];
}

export class VersionListResponseModel {
  @ApiProperty({ type: [VersionModel] })
  items!: VersionModel[];
}

export class DocumentModel {
  @ApiProperty({ example: 'doc-1c2d…' })
  id!: string;

  @ApiProperty({ example: 'dpa' })
  type!: string;

  @ApiProperty({ example: 'customer' })
  audience!: string;

  @ApiProperty({ example: 'DPA — Customers' })
  name!: string;
}

export class CreateDocumentBodyModel {
  @ApiProperty({ example: 'dpa', description: 'Document type key (must exist).' })
  type!: string;

  @ApiProperty({ example: 'customer', description: 'Audience key (must exist).' })
  audience!: string;

  @ApiProperty({ example: 'DPA — Customers' })
  name!: string;
}

/** Multipart (primary) or JSON with base64 `file` (fallback). */
export class CreateVersionBodyModel {
  @ApiProperty({ type: 'string', format: 'binary', description: 'PDF (multipart field) or base64 string (JSON fallback).' })
  file!: unknown;

  @ApiPropertyOptional({ description: 'Required with the base64 JSON fallback.' })
  fileName?: string;

  @ApiProperty({ example: 'June 2026 edition' })
  versionLabel!: string;

  @ApiProperty({ example: 'New sub-processor for e-mail delivery.' })
  changeSummary!: string;

  @ApiProperty({ enum: ['ACTIVE', 'PASSIVE'] })
  acceptanceMode!: string;

  @ApiPropertyOptional()
  consentText?: string;

  @ApiPropertyOptional({ example: 14, description: 'PASSIVE only: objection period in days.' })
  objectionPeriodDays?: number;

  @ApiPropertyOptional({ example: 14, description: 'Deprecated: no longer drives ACTIVE blocking (legacy rows only).' })
  gracePeriodDays?: number;

  @ApiPropertyOptional({
    example: '2026-08-01T00:00:00.000Z',
    description:
      'ACTIVE only: absolute acceptance deadline as a full ISO date-time. Required to publish an ' +
      'ACTIVE version and must be >= validFrom; every customer must accept by then or is blocked.',
  })
  hardDeadlineAt?: string;

  @ApiProperty({
    example: '2026-07-01',
    description:
      'ISO date from which the revision applies. May lie in the FUTURE (scheduled ' +
      'effectiveness): publishing rolls out immediately for advance acceptance, while the ' +
      'previous version stays the compliance baseline until this date.',
  })
  validFrom!: string;
}

export class PatchVersionBodyModel {
  @ApiPropertyOptional({ type: 'string', format: 'binary', description: 'Replacement PDF.' })
  file?: unknown;

  @ApiPropertyOptional()
  fileName?: string;

  @ApiPropertyOptional()
  versionLabel?: string;

  @ApiPropertyOptional()
  changeSummary?: string;

  @ApiPropertyOptional({ enum: ['ACTIVE', 'PASSIVE'] })
  acceptanceMode?: string;

  @ApiPropertyOptional()
  consentText?: string;

  @ApiPropertyOptional()
  objectionPeriodDays?: number;

  @ApiPropertyOptional()
  gracePeriodDays?: number;

  @ApiPropertyOptional({ example: '2026-08-01T00:00:00.000Z', description: 'ACTIVE only: absolute acceptance deadline (ISO date-time, >= validFrom).' })
  hardDeadlineAt?: string;

  @ApiPropertyOptional({ example: '2026-07-01' })
  validFrom?: string;
}

export class CreateVersionResponseModel {
  @ApiProperty({ example: 'v-4f9f6a…' })
  versionId!: string;

  @ApiProperty({ enum: ['DRAFT'] })
  status!: string;

  @ApiProperty({ example: 'sha256:9c1e…' })
  contentHash!: string;

  @ApiProperty({ example: 'dpa-2026-06.pdf' })
  fileName!: string;
}

export class PublishResponseModel {
  @ApiProperty({ example: 'v-4f9f6a…' })
  versionId!: string;

  @ApiProperty({ enum: ['PUBLISHED'] })
  status!: string;

  @ApiProperty({ example: 921, description: 'Number of customers the rollout targeted.' })
  rolloutCustomers!: number;

  @ApiProperty({ type: String, format: 'date-time' })
  publishedAt!: Date;
}

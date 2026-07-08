/**
 * OpenAPI documentation models for the compliance gate and the pending-agreements popup feed.
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

const ROLLOUT_STATES = [
  'PENDING_NOTIFICATION',
  'NOTIFIED',
  'ACCEPTED',
  'OBJECTED',
  'EXPIRED_BLOCKING',
  'SUPERSEDED',
] as const;

export class ComplianceDetailModel {
  @ApiProperty({ example: 'v-9' })
  requiredVersionId!: string;

  @ApiProperty({ example: 'June 2026 edition' })
  requiredVersionLabel!: string;

  @ApiPropertyOptional({ example: 'v-2' })
  acceptedVersionId?: string;

  @ApiPropertyOptional({ enum: ROLLOUT_STATES })
  state?: string;

  @ApiPropertyOptional({ enum: ['ACTIVE_CONSENT', 'TACIT', 'IMPORT'] })
  method?: string;

  @ApiPropertyOptional({ type: String, format: 'date-time' })
  deadlineAt?: Date;

  @ApiPropertyOptional({ enum: ['ACTIVE', 'PASSIVE'] })
  pendingMode?: string;
}

export class ComplianceResponseModel {
  @ApiProperty({ example: 'c-123' })
  customerId!: string;

  @ApiPropertyOptional({ example: 'customer', description: 'Audience key the query was restricted to.' })
  audience?: string;

  @ApiProperty({ type: [String], example: ['customer'] })
  roles!: string[];

  @ApiProperty({ description: 'false only for EXPIRED_BLOCKING or a not-yet-accepted carry-over state.' })
  compliant!: boolean;

  @ApiProperty({
    type: 'object',
    additionalProperties: { $ref: '#/components/schemas/ComplianceDetailModel' },
    description: 'One entry per TYPE_AUDIENCE detail key (e.g. DPA_CUSTOMER).',
  })
  details!: Record<string, ComplianceDetailModel>;
}

export class PendingAgreementItemModel {
  @ApiProperty({ example: 'v-9' })
  versionId!: string;

  @ApiProperty({ example: 'dpa', description: 'Document type key.' })
  documentType!: string;

  @ApiProperty({ example: 'customer', description: 'Audience key.' })
  audience!: string;

  @ApiProperty({ example: 'June 2026 edition' })
  versionLabel!: string;

  @ApiProperty({ example: 'New sub-processor for e-mail delivery.' })
  changeSummary!: string;

  @ApiProperty({ description: 'Presigned, time-limited PDF URL (15-minute TTL).' })
  pdfUrl!: string;

  @ApiProperty({ enum: ['ACTIVE', 'PASSIVE'] })
  mode!: string;

  @ApiPropertyOptional({ type: String, format: 'date-time' })
  deadlineAt?: Date;

  @ApiProperty({ description: 'true → the tool shows the block screen.' })
  blocking!: boolean;

  @ApiProperty({
    description:
      'true = published but not yet in effect (validFrom in the future). The current version ' +
      'stays required until the flip; accepting the upcoming one in advance is valid.',
  })
  upcoming!: boolean;

  @ApiProperty({ type: String, format: 'date-time', description: 'Date from which the revision applies.' })
  validFrom!: Date;
}

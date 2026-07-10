/**
 * OpenAPI documentation models for the portal consent endpoints. Validation stays with the zod
 * schemas in dto.ts — these classes are documentation only.
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class AcceptanceBodyModel {
  @ApiProperty({ example: 'v-9' })
  versionId!: string;

  @ApiPropertyOptional({
    example: 'I have read the new revision and agree.',
    description:
      'Cross-check only — the evidence uses the server-side versioned consentText. Required for ' +
      'ACTIVE versions; omitted for a PASSIVE early acceptance.',
  })
  displayedConsentText?: string;
}

export class IntegrationAcceptanceBodyModel {
  @ApiProperty({ example: 'v-9' })
  versionId!: string;

  @ApiPropertyOptional({
    example: 'Bob Portal',
    description:
      "The portal user's self-declared name. Recorded as the acceptance actor's name; falls back " +
      'to the `x-actor-name` header when omitted.',
  })
  signerName?: string;

  @ApiPropertyOptional({
    example: 'bob@operator.example',
    description:
      "The portal user's self-declared e-mail. Recorded as the acceptance actor's e-mail; falls " +
      'back to the `x-actor-email` header when omitted.',
  })
  signerEmail?: string;

  @ApiPropertyOptional({
    example: 'I have read the new revision and agree.',
    description:
      'Cross-check only — the evidence uses the server-side versioned consentText. Required for ' +
      'ACTIVE versions; omitted for a PASSIVE early acceptance.',
  })
  displayedConsentText?: string;
}

export class AcceptanceResponseModel {
  @ApiProperty({ example: 'a-991' })
  acceptanceId!: string;

  @ApiProperty({ enum: ['ACCEPTED'] })
  state!: string;
}

export class ObjectionBodyModel {
  @ApiProperty({ example: 'v-9' })
  versionId!: string;

  @ApiPropertyOptional({ example: 'Sub-processor XY is not accepted.' })
  reason?: string;
}

export class ObjectionResponseModel {
  @ApiProperty({ example: 'o-17' })
  objectionId!: string;

  @ApiProperty({ enum: ['OBJECTED'] })
  state!: string;
}

export class NotificationBodyModel {
  @ApiProperty({ example: 'v-9' })
  versionId!: string;

  @ApiProperty({ enum: ['PORTAL'] })
  channel!: string;

  @ApiPropertyOptional({
    type: String,
    format: 'date-time',
    description: 'Plausibility check only — notifiedAt is ALWAYS server time (no backdating).',
  })
  displayedAt?: string;
}

export class NotificationResponseModel {
  @ApiProperty({ enum: ['PENDING_NOTIFICATION', 'NOTIFIED', 'ACCEPTED', 'OBJECTED', 'EXPIRED_BLOCKING', 'SUPERSEDED'] })
  state!: string;

  @ApiPropertyOptional({ type: String, format: 'date-time' })
  notifiedAt?: Date;

  @ApiPropertyOptional({ type: String, format: 'date-time' })
  deadlineAt?: Date;
}

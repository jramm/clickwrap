/**
 * OpenAPI documentation models for the hosted acceptance page (integration spec) and the admin
 * link-minting endpoint (admin spec). Documentation only — runtime shapes live in the services.
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateAcceptanceLinkBodyModel {
  @ApiPropertyOptional({
    example: 'customer',
    description: 'Optional scope: restrict the hosted page to documents of this audience key.',
  })
  audienceKey?: string;

  @ApiPropertyOptional({ example: 30, description: 'Link validity in days (default 30, max 365).' })
  expiresInDays?: number;
}

export class CreateAcceptanceLinkResponseModel {
  @ApiProperty({ example: 'al-4f6e…' })
  linkId!: string;

  @ApiProperty({
    example: 'https://clickwrap.example.org/accept/3q2-…',
    description:
      'Shareable URL (`${PUBLIC_BASE_URL}/accept/<token>`). The raw token appears ONLY here — ' +
      'the server persists just its SHA-256.',
  })
  url!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  expiresAt!: Date;
}

export class LinkAcceptanceBodyModel {
  @ApiProperty({ example: 'v-9' })
  versionId!: string;

  @ApiPropertyOptional({
    example: 'I have read the new revision and agree.',
    description:
      'Exact consent text as displayed — cross-checked server-side (CONSENT_TEXT_MISMATCH). ' +
      'Required for ACTIVE versions; omitted for a PASSIVE early acceptance (no consent checkbox).',
  })
  displayedConsentText?: string;

  @ApiProperty({ example: 'Max Mustermann', description: 'Self-declared signer name (typed by the recipient).' })
  signerName!: string;

  @ApiProperty({ example: 'max@acme.example', description: 'Self-declared signer e-mail (basic format check).' })
  signerEmail!: string;
}

export class LinkAcceptanceResponseModel {
  @ApiProperty({ example: 'a-991' })
  acceptanceId!: string;

  @ApiProperty({ enum: ['ACCEPTED'] })
  state!: 'ACCEPTED';
}

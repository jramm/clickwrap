/**
 * OpenAPI documentation models for customer administration (admin API) and customer onboarding
 * (integration API). Runtime validation stays with zod (dto.ts); these classes are documentation.
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CustomerRowModel {
  @ApiProperty({ example: 'c-8a71…' })
  id!: string;

  @ApiProperty({ example: 'crm-4711', description: 'Unique external reference (CRM id).' })
  externalRef!: string;

  @ApiProperty({ example: 'Acme GmbH', description: "Company display name ('' when unknown)." })
  name!: string;

  @ApiProperty({ type: [String], example: ['customer'], description: 'Audience keys.' })
  roles!: string[];

  @ApiProperty({ type: [String], example: ['legal@acme.example'] })
  contactEmails!: string[];
}

export class CustomerListResponseModel {
  @ApiProperty({ type: [CustomerRowModel] })
  items!: CustomerRowModel[];

  @ApiProperty({ example: 173 })
  total!: number;
}

export class AcceptedVersionImportModel {
  @ApiProperty({ example: 'v-4f9f6a…' })
  versionId!: string;

  @ApiPropertyOptional({
    type: String,
    format: 'date-time',
    description: 'Signature date; backdating is allowed for IMPORT. Defaults to now.',
  })
  acceptedAt?: string;

  @ApiPropertyOptional({ example: 'HubSpot deal 12345 / signed offer', description: 'Evidence reference.' })
  reference?: string;
}

export class CreateCustomerBodyModel {
  @ApiProperty({ example: 'crm-4711' })
  externalRef!: string;

  @ApiPropertyOptional({ example: 'Acme GmbH' })
  name?: string;

  @ApiProperty({ type: [String], example: ['customer'], description: 'Audience keys (validated).' })
  roles!: string[];

  @ApiProperty({ type: [String], example: ['legal@acme.example'] })
  contactEmails!: string[];

  @ApiPropertyOptional({
    type: [AcceptedVersionImportModel],
    description: 'Versions already accepted out-of-band (signed offer) — recorded as IMPORT acceptances.',
  })
  acceptedVersions?: AcceptedVersionImportModel[];
}

export class UpdateCustomerBodyModel {
  @ApiPropertyOptional({ example: 'Acme GmbH' })
  name?: string;

  @ApiPropertyOptional({ type: [String], description: 'Takes effect on the next publish/rollout.' })
  roles?: string[];

  @ApiPropertyOptional({ type: [String] })
  contactEmails?: string[];
}

export class ImportedAcceptanceModel {
  @ApiProperty({ example: 'v-4f9f6a…' })
  versionId!: string;

  @ApiProperty({ example: 'a-991…' })
  acceptanceId!: string;
}

export class CreateCustomerResponseModel extends CustomerRowModel {
  @ApiProperty({ type: [ImportedAcceptanceModel] })
  importedAcceptances!: ImportedAcceptanceModel[];
}

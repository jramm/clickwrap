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

  @ApiProperty({ example: 'Jane', description: "Contact person's given name ('' when unknown)." })
  firstName!: string;

  @ApiProperty({ example: 'Doe', description: "Contact person's family name ('' when unknown)." })
  lastName!: string;

  @ApiPropertyOptional({
    example: 'Acme GmbH',
    description: 'Optional company/organisation name — preferred display label when set.',
  })
  companyName?: string;

  @ApiProperty({ type: [String], example: ['customer'], description: 'Audience keys.' })
  roles!: string[];

  @ApiProperty({ type: [String], example: ['legal@acme.example'] })
  contactEmails!: string[];

  @ApiPropertyOptional({
    type: String,
    format: 'date-time',
    example: '2026-07-09T14:12:03.000Z',
    description:
      'Set only on a customer that was soft-deleted by the customer sync (removed from the external ' +
      'source). The detail page badges it; such customers are excluded from the list and never blocking.',
  })
  deletedAt?: string;

  @ApiPropertyOptional({
    example: true,
    description:
      'Compliance gate (domain semantics: false = blocked). Present on list rows only; scoped by ' +
      'the audience/documentType query params (which also narrow the list to assigned/role-matching ' +
      'customers).',
  })
  compliant?: boolean;

  @ApiPropertyOptional({
    enum: ['compliant', 'pending', 'objected', 'blocked'],
    example: 'compliant',
    description: 'Compact per-row compliance status for the list chip. Present on list rows only.',
  })
  complianceStatus?: 'compliant' | 'pending' | 'objected' | 'blocked';
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

  @ApiPropertyOptional({ example: 'Jane', description: "Contact person's given name." })
  firstName?: string;

  @ApiPropertyOptional({ example: 'Doe', description: "Contact person's family name." })
  lastName?: string;

  @ApiPropertyOptional({ example: 'Acme GmbH', description: 'Optional company/organisation name.' })
  companyName?: string;

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
  @ApiPropertyOptional({ example: 'Jane', description: "Contact person's given name." })
  firstName?: string;

  @ApiPropertyOptional({ example: 'Doe', description: "Contact person's family name." })
  lastName?: string;

  @ApiPropertyOptional({ example: 'Acme GmbH', description: 'Optional company/organisation name.' })
  companyName?: string;

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

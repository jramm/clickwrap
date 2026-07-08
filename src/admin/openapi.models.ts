/**
 * OpenAPI documentation models for the admin operations endpoints (overview, history, manual
 * acceptance, states, audiences, document types). Documentation only — runtime shapes live in the
 * services.
 */
import { ApiExtraModels, ApiProperty, ApiPropertyOptional, getSchemaPath } from '@nestjs/swagger';

const ROLLOUT_STATES = [
  'PENDING_NOTIFICATION',
  'NOTIFIED',
  'ACCEPTED',
  'OBJECTED',
  'EXPIRED_BLOCKING',
  'SUPERSEDED',
] as const;
const METHODS = ['ACTIVE_CONSENT', 'TACIT', 'IMPORT'] as const;
const CHANNELS = ['PORTAL', 'ADMIN', 'SYSTEM', 'LINK'] as const;

export class OverviewCellModel {
  @ApiPropertyOptional({ example: 'April 2026 edition' })
  acceptedVersion?: string;

  @ApiPropertyOptional({ enum: METHODS })
  method?: string;

  @ApiPropertyOptional({ enum: ROLLOUT_STATES })
  state?: string;

  @ApiPropertyOptional({ example: 'June 2026 edition', description: 'Only set while the current version is not accepted.' })
  requiredVersion?: string;

  @ApiPropertyOptional({ type: String, format: 'date-time' })
  deadlineAt?: Date;

  @ApiProperty()
  blocking!: boolean;
}

// ApiExtraModels registers OverviewCellModel in the spec: it is only referenced via additionalProperties
// ($ref), which nestjs/swagger does not traverse — without this the ref would dangle (breaks codegen).
@ApiExtraModels(OverviewCellModel)
export class OverviewRowModel {
  @ApiProperty({ example: 'c-8a71…' })
  customerId!: string;

  @ApiProperty({
    example: 'Acme GmbH',
    description: "Derived display name: companyName if set, else the contact person's name ('' when unknown).",
  })
  customerName!: string;

  @ApiProperty({ type: [String], example: ['customer'] })
  roles!: string[];

  @ApiProperty({
    type: 'object',
    additionalProperties: { $ref: getSchemaPath(OverviewCellModel) },
    description: 'One cell per TYPE_AUDIENCE detail key (e.g. DPA_CUSTOMER).',
  })
  cells!: Record<string, OverviewCellModel>;
}

export class OverviewResponseModel {
  @ApiProperty({ type: [OverviewRowModel] })
  items!: OverviewRowModel[];

  @ApiProperty({ example: 921 })
  total!: number;
}

export class ActorModel {
  @ApiProperty({ example: 'u-42' })
  userId!: string;

  @ApiPropertyOptional({ example: 'Jane Doe' })
  name?: string;

  @ApiPropertyOptional({ example: 'jane@customer.example' })
  email?: string;

  @ApiPropertyOptional({ example: 'admin' })
  portalRole?: string;
}

export class HistoryEvidenceModel {
  @ApiPropertyOptional()
  ipAddress?: string;

  @ApiPropertyOptional()
  userAgent?: string;

  @ApiPropertyOptional()
  consentText?: string;

  @ApiPropertyOptional({ example: 'sha256:…' })
  consentTextHash?: string;

  @ApiPropertyOptional({ example: 'sha256:…' })
  contentHash?: string;

  @ApiPropertyOptional({ example: 'HubSpot deal 12345 / signed offer', description: 'IMPORT only.' })
  evidenceNote?: string;
}

export class HistoryAcceptanceModel {
  @ApiProperty()
  versionId!: string;

  @ApiPropertyOptional({ example: 'dpa' })
  documentType?: string;

  @ApiPropertyOptional({ example: 'June 2026 edition' })
  versionLabel?: string;

  @ApiProperty({ enum: METHODS })
  method!: string;

  @ApiProperty({ enum: CHANNELS })
  channel!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  acceptedAt!: Date;

  @ApiProperty({ type: ActorModel })
  actor!: ActorModel;

  @ApiProperty()
  isEffective!: boolean;

  @ApiProperty({ type: HistoryEvidenceModel })
  evidence!: HistoryEvidenceModel;
}

export class HistoryObjectionModel {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  customerId!: string;

  @ApiProperty()
  versionId!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  objectedAt!: Date;

  @ApiProperty({ type: ActorModel })
  actor!: ActorModel;

  @ApiPropertyOptional()
  reason?: string;

  @ApiProperty({ enum: CHANNELS })
  channel!: string;

  @ApiPropertyOptional({ enum: ['WITHDRAWN', 'RESOLVED_ACCEPTED', 'RESOLVED_TERMINATED'] })
  resolution?: string;

  @ApiPropertyOptional()
  resolvedBy?: string;

  @ApiPropertyOptional({ type: String, format: 'date-time' })
  resolvedAt?: Date;
}

export class HistoryNotificationModel {
  @ApiProperty()
  versionId!: string;

  @ApiProperty({ enum: ['EMAIL', 'PORTAL', 'LINK'] })
  channel!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  deliveredAt!: Date;
}

export class HistoryStateModel {
  @ApiProperty({ example: 'cvs-1' })
  id!: string;

  @ApiProperty()
  versionId!: string;

  @ApiPropertyOptional({ example: 'dpa' })
  documentType?: string;

  @ApiPropertyOptional({ example: 'June 2026 edition' })
  versionLabel?: string;

  @ApiProperty({ enum: ROLLOUT_STATES })
  state!: string;

  @ApiPropertyOptional({ type: String, format: 'date-time' })
  notifiedAt?: Date;

  @ApiPropertyOptional({ type: String, format: 'date-time' })
  deadlineAt?: Date;

  @ApiProperty({ example: 1 })
  remindersSent!: number;

  @ApiPropertyOptional()
  carryOverBlocking?: boolean;
}

export class HistorySignedDocumentModel {
  @ApiProperty({ example: 'sd-8a71…' })
  id!: string;

  @ApiProperty({ example: 'signed-offer' })
  documentTypeKey!: string;

  @ApiPropertyOptional({ example: 'customer' })
  audience?: string;

  @ApiProperty({ example: 'signed-offer.pdf' })
  fileName!: string;

  @ApiProperty({ example: 'sha256:…' })
  contentHash!: string;

  @ApiProperty({ example: 20480 })
  fileSize!: number;

  @ApiProperty({ type: String, format: 'date-time' })
  signedAt!: Date;

  @ApiPropertyOptional({ example: 'Jane Doe' })
  signerName?: string;

  @ApiPropertyOptional({ example: 'HubSpot deal 12345 / signed offer' })
  reference?: string;

  @ApiPropertyOptional()
  note?: string;

  @ApiProperty({ example: 'u-42' })
  uploadedBy!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  uploadedAt!: Date;
}

export class CustomerHistoryResponseModel {
  @ApiProperty({ type: [HistoryAcceptanceModel] })
  acceptances!: HistoryAcceptanceModel[];

  @ApiProperty({ type: [HistoryObjectionModel] })
  objections!: HistoryObjectionModel[];

  @ApiProperty({ type: [HistoryNotificationModel] })
  notifications!: HistoryNotificationModel[];

  @ApiProperty({ type: [HistoryStateModel] })
  states!: HistoryStateModel[];

  @ApiProperty({
    type: [HistorySignedDocumentModel],
    description: 'Externally-signed documents (evidence archive) — never part of the compliance gate.',
  })
  signedDocuments!: HistorySignedDocumentModel[];
}

export class ManualAcceptanceBodyModel {
  @ApiProperty()
  versionId!: string;

  @ApiProperty({ enum: ['ACTIVE_CONSENT', 'IMPORT'], description: 'TACIT is excluded (sweeper only).' })
  method!: string;

  @ApiProperty({ example: 'Consent received by letter on 2026-07-01' })
  reason!: string;

  @ApiProperty({ description: 'Evidence document as base64.' })
  evidenceDocument!: string;

  @ApiProperty({ example: 'letter.pdf' })
  evidenceFileName!: string;
}

export class ManualAcceptanceResponseModel {
  @ApiProperty({ example: 'a-991…' })
  acceptanceId!: string;

  @ApiProperty({ enum: ROLLOUT_STATES })
  state!: string;
}

export class PatchStateBodyModel {
  @ApiPropertyOptional({ type: String, format: 'date-time' })
  deadlineAt?: string;

  @ApiPropertyOptional({ description: 'true: EXPIRED_BLOCKING → NOTIFIED with a new deadlineAt (then required).' })
  suspendBlock?: boolean;

  @ApiProperty({ example: 'Customer in clarification with legal' })
  reason!: string;
}

export class CustomerVersionStateModel {
  @ApiProperty({ example: 'cvs-1' })
  id!: string;

  @ApiProperty()
  customerId!: string;

  @ApiProperty()
  versionId!: string;

  @ApiProperty({ enum: ROLLOUT_STATES })
  state!: string;

  @ApiPropertyOptional({ type: String, format: 'date-time' })
  notifiedAt?: Date;

  @ApiPropertyOptional({ type: String, format: 'date-time' })
  deadlineAt?: Date;

  @ApiProperty()
  remindersSent!: number;

  @ApiPropertyOptional()
  carryOverBlocking?: boolean;
}

export class NamedEntityModel {
  @ApiProperty({ example: 'aud-1' })
  id!: string;

  @ApiProperty({ example: 'customer', description: 'URL-safe slug, immutable after creation.' })
  key!: string;

  @ApiProperty({ example: 'Customers' })
  name!: string;
}

export class CreateNamedEntityBodyModel {
  @ApiProperty({ example: 'customer', description: 'URL-safe slug [a-z0-9-]{2,32}.' })
  key!: string;

  @ApiProperty({ example: 'Customers' })
  name!: string;
}

export class UpdateNamedEntityBodyModel {
  @ApiProperty({ example: 'End customers' })
  name!: string;
}

export class CreateDocumentTypeBodyModel {
  @ApiProperty({ example: 'signed-offer', description: 'URL-safe slug [a-z0-9-]{2,32}.' })
  key!: string;

  @ApiProperty({ example: 'Signed offer' })
  name!: string;

  @ApiPropertyOptional({
    example: false,
    description:
      'true = externally-signed document type (SignedDocument flow, no versions/publish/gate). ' +
      'Default false (clickwrap). Immutable after creation.',
  })
  external?: boolean;
}

const EMAIL_TEMPLATE_KINDS = ['VERSION_NOTIFICATION', 'REMINDER', 'ACCEPTANCE_CONFIRMATION'] as const;

export class DocumentTypeModel {
  @ApiProperty({ example: 'dt-1' })
  id!: string;

  @ApiProperty({ example: 'dpa', description: 'URL-safe slug, immutable after creation.' })
  key!: string;

  @ApiProperty({ example: 'Data Processing Agreement' })
  name!: string;

  @ApiProperty({
    example: false,
    description:
      'true = externally-signed document type (SignedDocument flow, no versions/publish/gate); ' +
      'false = clickwrap type. Set at creation only, immutable afterwards.',
  })
  external!: boolean;

  @ApiPropertyOptional({ example: 'tpl-1', description: 'Assigned VERSION_NOTIFICATION template id.' })
  notificationTemplateId?: string;

  @ApiPropertyOptional({ example: 'tpl-2', description: 'Assigned REMINDER template id.' })
  reminderTemplateId?: string;

  @ApiPropertyOptional({ example: 'tpl-3', description: 'Assigned ACCEPTANCE_CONFIRMATION template id.' })
  acceptanceConfirmationTemplateId?: string;
}

export class UpdateDocumentTypeBodyModel {
  @ApiPropertyOptional({ example: 'Data Processing Agreement' })
  name?: string;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description: 'VERSION_NOTIFICATION template id; null clears the assignment, omit to keep it.',
  })
  notificationTemplateId?: string | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description: 'REMINDER template id; null clears the assignment, omit to keep it.',
  })
  reminderTemplateId?: string | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description: 'ACCEPTANCE_CONFIRMATION template id; null clears the assignment, omit to keep it.',
  })
  acceptanceConfirmationTemplateId?: string | null;
}

export class EmailTemplateModel {
  @ApiProperty({ example: 'tpl-default-notification' })
  id!: string;

  @ApiProperty({ example: 'Default — version notification' })
  name!: string;

  @ApiProperty({ enum: EMAIL_TEMPLATE_KINDS })
  kind!: string;

  @ApiProperty({ example: '{{appName}}: new version of {{documentName}}' })
  subject!: string;

  @ApiProperty({ description: 'Unlayer design JSON (serialised).' })
  design!: string;

  @ApiProperty({ description: 'Exported e-mail HTML with {{placeholders}}.' })
  html!: string;

  @ApiProperty({ description: 'Built-in default row (editable but not deletable).' })
  isDefault!: boolean;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: Date;
}

export class CreateEmailTemplateBodyModel {
  @ApiProperty({ example: 'Welcome mail' })
  name!: string;

  @ApiProperty({ enum: EMAIL_TEMPLATE_KINDS })
  kind!: string;

  @ApiProperty({ example: 'Hi {{customerName}}' })
  subject!: string;

  @ApiProperty({ description: 'Unlayer design JSON (serialised).' })
  design!: string;

  @ApiProperty({ description: 'Exported e-mail HTML with {{placeholders}}.' })
  html!: string;
}

export class UpdateEmailTemplateBodyModel {
  @ApiPropertyOptional({ example: 'Welcome mail' })
  name?: string;

  @ApiPropertyOptional({ enum: EMAIL_TEMPLATE_KINDS })
  kind?: string;

  @ApiPropertyOptional({ example: 'Hi {{customerName}}' })
  subject?: string;

  @ApiPropertyOptional({ description: 'Unlayer design JSON (serialised).' })
  design?: string;

  @ApiPropertyOptional({ description: 'Exported e-mail HTML with {{placeholders}}.' })
  html?: string;
}

export class EmailTemplatePreviewBodyModel {
  @ApiPropertyOptional({ example: 'dpa', description: 'Scope the sample documentType value to this key.' })
  documentTypeKey?: string;
}

export class EmailTemplatePreviewResponseModel {
  @ApiProperty({ example: 'clickwrap-server: new version of DPA — Customers' })
  subject!: string;

  @ApiProperty({ description: 'Rendered, self-contained e-mail HTML.' })
  html!: string;

  @ApiProperty({ description: 'Plain-text part derived from the rendered HTML.' })
  text!: string;
}

const VERSION_STATUSES = ['DRAFT', 'PUBLISHED', 'RETIRED'] as const;

export class AcceptedByChannelModel {
  @ApiProperty({ example: 12 })
  PORTAL!: number;

  @ApiProperty({ example: 3 })
  LINK!: number;

  @ApiProperty({ example: 5 })
  ADMIN!: number;

  @ApiProperty({ example: 2 })
  SYSTEM!: number;
}

export class AcceptedByMethodModel {
  @ApiProperty({ example: 14 })
  ACTIVE_CONSENT!: number;

  @ApiProperty({ example: 6 })
  TACIT!: number;

  @ApiProperty({ example: 2 })
  IMPORT!: number;
}

export class VersionAcceptanceStatsModel {
  @ApiProperty({ example: 42, description: 'Relevant (non-SUPERSEDED) states of the version.' })
  totalCustomers!: number;

  @ApiProperty({ example: 22 })
  accepted!: number;

  @ApiProperty({ type: AcceptedByChannelModel })
  acceptedByChannel!: AcceptedByChannelModel;

  @ApiProperty({ type: AcceptedByMethodModel })
  acceptedByMethod!: AcceptedByMethodModel;

  @ApiProperty({ example: 12, description: 'PENDING_NOTIFICATION + NOTIFIED.' })
  pending!: number;

  @ApiProperty({ example: 5, description: 'EXPIRED_BLOCKING.' })
  blocked!: number;

  @ApiProperty({ example: 3, description: 'OBJECTED.' })
  objected!: number;

  @ApiProperty({ example: 0.5238, description: 'accepted / totalCustomers (0 when totalCustomers is 0).' })
  acceptanceRate!: number;
}

export class VersionStatsModel {
  @ApiProperty({ example: 'v-4f9f6a…' })
  versionId!: string;

  @ApiProperty({ example: 'DPA — Customers' })
  documentName!: string;

  @ApiProperty({ example: 'dpa' })
  documentType!: string;

  @ApiProperty({ example: 'customer' })
  audience!: string;

  @ApiProperty({ example: 'June 2026 edition' })
  versionLabel!: string;

  @ApiProperty({ enum: VERSION_STATUSES })
  status!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  validFrom!: Date;

  @ApiProperty({ example: false, description: 'Scheduled for the future (validFrom > now).' })
  upcoming!: boolean;

  @ApiProperty({ type: VersionAcceptanceStatsModel })
  stats!: VersionAcceptanceStatsModel;
}

export class DashboardResponseModel {
  @ApiProperty({
    type: [VersionStatsModel],
    description: 'One entry per current + upcoming published version of every document.',
  })
  items!: VersionStatsModel[];
}

export class VersionCustomerAcceptanceModel {
  @ApiProperty({ type: String, format: 'date-time' })
  acceptedAt!: Date;

  @ApiProperty({ enum: METHODS })
  method!: string;

  @ApiProperty({ enum: CHANNELS })
  channel!: string;

  @ApiPropertyOptional({ example: 'Jane Doe', description: 'Display name of the accepting actor.' })
  actorName?: string;
}

export class VersionCustomerRowModel {
  @ApiProperty({ example: 'c-8a71…' })
  customerId!: string;

  @ApiProperty({
    example: 'Acme GmbH',
    description: "Derived display name: companyName if set, else the contact person's name ('' when unknown).",
  })
  customerName!: string;

  @ApiProperty({ example: 'crm-4711' })
  externalRef!: string;

  @ApiProperty({ enum: ROLLOUT_STATES, description: 'The CustomerVersionState value for THIS version.' })
  state!: string;

  @ApiPropertyOptional({ type: String, format: 'date-time' })
  notifiedAt?: Date;

  @ApiPropertyOptional({ type: String, format: 'date-time' })
  deadlineAt?: Date;

  @ApiPropertyOptional()
  carryOverBlocking?: boolean;

  @ApiPropertyOptional({ type: VersionCustomerAcceptanceModel, description: 'The effective acceptance OF THIS VERSION only.' })
  acceptance?: VersionCustomerAcceptanceModel;
}

export class VersionCustomersResponseModel {
  @ApiProperty({ type: [VersionCustomerRowModel] })
  items!: VersionCustomerRowModel[];

  @ApiProperty({ example: 42 })
  total!: number;

  @ApiProperty({ type: VersionStatsModel, description: 'Reused per-version dashboard stats (header numbers match the card).' })
  stats!: VersionStatsModel;
}

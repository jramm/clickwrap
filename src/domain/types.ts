/**
 * Domain model of the agreement service.
 * Pure types/constants: no Nest/Prisma imports (CONVENTIONS: domain is pure).
 */
import type { Actor } from '../common/auth/actor.js';

/**
 * Dynamic document type ("terms", "dpa", ...). `key` is a URL-safe slug
 * (see src/domain/keys.ts) and is referenced by AgreementDocument.type.
 */
export interface DocumentTypeDef {
  id: string;
  key: string;
  /** Display label, e.g. "Terms of Service". */
  name: string;
  /**
   * Optional per-document-type e-mail template assignments. When set, rollout notification /
   * reminder / acceptance-confirmation mails for documents of this type use the referenced
   * {@link EmailTemplate}; when unset the built-in default template of the matching kind is used
   * (see src/domain/email-template.ts). Cleared explicitly with `null` via the admin API.
   */
  notificationTemplateId?: string;
  reminderTemplateId?: string;
  acceptanceConfirmationTemplateId?: string;
  /**
   * Splits the two document worlds this service supports (see {@link SignedDocument}):
   *  - `false` (default) → the CLICKWRAP flow: versions/publish/acceptance/compliance gate. The
   *    admin authors versioned PDFs, customers accept them, and non-acceptance can block.
   *  - `true` → EXTERNALLY-SIGNED documents: no versions, no publish, no gate. Signed PDFs (e.g.
   *    counter-signed offers) are uploaded per customer as immutable evidence
   *    ({@link SignedDocument}). Version/document creation is rejected for external types.
   *
   * SETTABLE AT CREATION ONLY — immutable afterwards (the PATCH admin endpoint never reads it).
   */
  external?: boolean;
}

/**
 * Externally-signed document uploaded per customer — the evidence archive of the "legal signed
 * document service". Only for a DocumentTypeDef with `external=true` (the counterpart of the
 * clickwrap version flow). Append-only and immutable: corrections are a fresh upload, never an
 * edit or delete. The PDF lives in the FileStorage plugin under `storageKey`; `contentHash`
 * (`sha256:<hex>`) is computed HOST-side over the buffer (never trusted from a plugin).
 *
 * NOT part of the compliance gate: signed documents never affect `compliant`, pending agreements,
 * deadlines or dashboards — they are a pure evidence store.
 */
export interface SignedDocument {
  id: string;
  customerId: string;
  /** DocumentTypeDef key (must reference an `external=true` type). */
  documentTypeKey: string;
  /** Optional audience key this document belongs to (must exist when given). */
  audience?: string;
  fileName: string;
  /** FileStorage plugin key — internal, never exposed on the API. */
  storageKey: string;
  /** `sha256:<hex>` over the PDF buffer — computed host-side, ties the evidence to the content. */
  contentHash: string;
  fileSize: number;
  /** When the document was signed. Backdatable (the signature predates the upload). */
  signedAt: Date;
  signerName?: string;
  /** Free-text reference, e.g. "HubSpot deal 12345 / signed offer". */
  reference?: string;
  note?: string;
  /** Actor who uploaded it — from the auth context, never the body. */
  uploadedBy: string;
  uploadedAt: Date;
}

/**
 * Which mail an {@link EmailTemplate} is written for.
 *  - VERSION_NOTIFICATION: rollout notice about a newly published version.
 *  - REMINDER: reminder before the acceptance deadline.
 *  - ACCEPTANCE_CONFIRMATION: sent on acceptance, with the accepted document attached as a PDF.
 */
export type EmailTemplateKind = 'VERSION_NOTIFICATION' | 'REMINDER' | 'ACCEPTANCE_CONFIRMATION';

/**
 * Admin-managed e-mail template for rollout notification / reminder mails, selectable per
 * document type (DocumentTypeDef.notificationTemplateId / reminderTemplateId).
 *
 * Authored in the admin UI with the Unlayer drag-and-drop editor (react-email-editor): `design`
 * is the Unlayer design JSON (serialised — used to re-open the template in the editor) and `html`
 * is the exported, self-contained e-mail HTML. Both `subject` and `html` support `{{placeholder}}`
 * substitution (see src/domain/email-template.ts): placeholder VALUES are HTML-escaped when
 * substituted into `html`, the surrounding authored markup is trusted. The plain-text part of a
 * mail is derived from the substituted HTML — no separate text body is stored.
 */
export interface EmailTemplate {
  id: string;
  /** Admin-facing display name. */
  name: string;
  kind: EmailTemplateKind;
  subject: string;
  /** Unlayer design JSON (serialised) — reopened in the editor for re-editing. */
  design: string;
  /** Exported, self-contained e-mail HTML with `{{placeholders}}`. */
  html: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Dynamic audience ("customer", "partner", ...). `key` is a URL-safe slug
 * (see src/domain/keys.ts) and is referenced by AgreementDocument.audience
 * and Customer.roles.
 */
export interface Audience {
  id: string;
  key: string;
  /** Display label, e.g. "Customers". */
  name: string;
}

/** Document bracket per audience — exactly one active document per (type, audience). */
export interface AgreementDocument {
  id: string;
  /** DocumentTypeDef key. */
  type: string;
  /** Audience key. */
  audience: string;
  name: string;
}

export type VersionStatus = 'DRAFT' | 'PUBLISHED' | 'RETIRED';
export type AcceptanceMode = 'ACTIVE' | 'PASSIVE';

/** Grace period from ACTIVE rollout until hard block — default 14 days, overridable per version. */
export const DEFAULT_GRACE_PERIOD_DAYS = 14;

/** One concrete revision (PDF + metadata); immutable once published. */
export interface AgreementVersion {
  id: string;
  documentId: string;
  versionLabel: string;
  status: VersionStatus;
  acceptanceMode: AcceptanceMode;
  /** PASSIVE only: objection period in days, starting at delivery. */
  objectionPeriodDays?: number;
  /**
   * @deprecated No longer drives ACTIVE blocking — kept for backward-compat with old rows.
   * Historically the ACTIVE grace period from delivery; ACTIVE deadlines are now the absolute
   * {@link hardDeadlineAt}, independent of access.
   */
  gracePeriodDays?: number;
  /**
   * ACTIVE only: absolute calendar deadline. Every customer of this version must have ACCEPTED by
   * then or is blocked (EXPIRED_BLOCKING) at that date, independent of access — including
   * never-accessed customers. Must be `>= validFrom`. Unset for PASSIVE versions.
   */
  hardDeadlineAt?: Date;
  /** Short description of the change — required (portal popup). */
  changeSummary: string;
  /** Exact consent text of the checkbox — required for ACTIVE, versioned server-side. */
  consentText?: string;
  /** PDF storage. */
  storageKey: string;
  fileName: string;
  /** SHA-256 of the PDF content — ties the acceptance evidence to the exact document content. */
  contentHash: string;
  fileSize: number;
  /** Date from which the revision applies. */
  validFrom: Date;
  publishedAt?: Date;
  publishedBy?: string;
}

/** Reference to master data (external company); roles are audience keys synced from the CRM. */
export interface Customer {
  id: string;
  externalRef: string;
  /**
   * Contact person's given name. Synced from the CRM and historically absent; defaults to '' in
   * persistence/fixtures when unknown. See {@link customerDisplayName} for the derived label.
   */
  firstName: string;
  /** Contact person's family name; defaults to '' when unknown (see {@link firstName}). */
  lastName: string;
  /**
   * Optional company / organisation name. When set it is the preferred display label (see
   * {@link customerDisplayName}); absent for individuals or when the CRM sync has not provided one.
   */
  companyName?: string;
  /** Audience keys the customer belongs to. */
  roles: string[];
  /**
   * All known contact e-mail addresses of the customer (active portal users + contract/legal
   * contact): rollout and reminder mails go to ALL of them; the first successful delivery to any
   * of them counts as delivery to the legal entity. Empty = no e-mail channel — the customer
   * shows up in the escalation report as "unreachable".
   */
  contactEmails: string[];
  /**
   * Provenance of the customer record. `'manual'` (the default) for admin-created customers;
   * otherwise the origin of the record as reported by the inbound integration API (e.g. the Main
   * Portal that pushed it, see CustomerAdminService.upsertByExternalRef).
   */
  source?: string;
  /**
   * Soft-delete marker (preserves the evidence chain). Set when the inbound integration API
   * deactivates a customer (deactivateByExternalRef). A soft-deleted customer is excluded from the
   * admin list, dashboards and compliance ("never blocking/pending"), but its detail/history stays
   * viewable. Cleared on reactivation (a subsequent upsert of the same external ref).
   */
  deletedAt?: Date;
}

export type CustomerVersionStateValue =
  | 'PENDING_NOTIFICATION'
  | 'NOTIFIED'
  | 'ACCEPTED'
  | 'OBJECTED'
  | 'EXPIRED_BLOCKING'
  | 'SUPERSEDED';

/** Rollout state per customer × published version. */
export interface CustomerVersionState {
  id: string;
  customerId: string;
  versionId: string;
  state: CustomerVersionStateValue;
  /** First provable delivery — starts the deadline; ALWAYS server time. */
  notifiedAt?: Date;
  /**
   * PASSIVE: notifiedAt + objectionPeriodDays (set at provable access). ACTIVE: the version's
   * absolute {@link AgreementVersion.hardDeadlineAt}, stamped at rollout before any access.
   */
  deadlineAt?: Date;
  remindersSent: number;
  /**
   * Block carry-over: the predecessor version was EXPIRED_BLOCKING → on delivery this state
   * starts blocking immediately (recordAccess receives this flag as predecessorWasBlocking).
   * Set by publish/rollout.
   */
  carryOverBlocking?: boolean;
}

export type AcceptanceMethod = 'ACTIVE_CONSENT' | 'TACIT' | 'IMPORT';
export type AcceptanceChannel = 'PORTAL' | 'ADMIN' | 'SYSTEM' | 'LINK';

/** Append-only evidence; exactly one effective acceptance per (customerId, versionId). */
export interface Acceptance {
  id: string;
  customerId: string;
  versionId: string;
  method: AcceptanceMethod;
  channel: AcceptanceChannel;
  acceptedAt: Date;
  /** Taken exclusively from the auth context — never from the request body. */
  actor: Actor;
  /** Corrections only via a new entry: the old entry becomes ineffective + points to its successor. */
  isEffective: boolean;
  supersededByAcceptanceId?: string;
  /** Evidence (for ACTIVE): copied server-side from AgreementVersion.consentText. */
  consentText?: string;
  consentTextHash?: string;
  /** contentHash of the accepted version. */
  contentHash?: string;
  ipAddress?: string;
  userAgent?: string;
  /**
   * Free-text evidence reference for out-of-band acceptances (method=IMPORT), e.g. the signed
   * offer / CRM deal that carried the customer's signature ("HubSpot deal 12345 / signed offer").
   */
  evidenceNote?: string;
}

export type ObjectionResolution = 'WITHDRAWN' | 'RESOLVED_ACCEPTED' | 'RESOLVED_TERMINATED';

/** Objection, append-only — only for PASSIVE versions. */
export interface Objection {
  id: string;
  customerId: string;
  versionId: string;
  objectedAt: Date;
  actor: Actor;
  reason?: string;
  channel: AcceptanceChannel;
  resolution?: ObjectionResolution;
  resolvedBy?: string;
  resolvedAt?: Date;
}

export type NotificationChannel = 'EMAIL' | 'PORTAL' | 'LINK';

/**
 * Hosted acceptance link (capability token): an admin mints a link and sends it directly to the
 * person who has to accept; opening `/accept/<token>` is authenticated by the token alone.
 * The raw URL token is NEVER persisted — only its SHA-256 (`tokenHash`). Signer identity on the
 * hosted page is SELF-DECLARED (typed name/e-mail) and recorded as such in the evidence.
 */
export type AcceptanceLinkKind = 'STANDARD' | 'PERMANENT';

export interface AcceptanceLink {
  id: string;
  /** sha256 hex of the raw URL token (see src/domain/acceptance-links.ts). */
  tokenHash: string;
  customerId: string;
  /**
   * STANDARD: admin-minted, time-limited (`expiresAt` set). PERMANENT: one lazily-created,
   * per-customer link injected into rollout/reminder mails — never expires (`expiresAt`
   * undefined), still revocable, same hashing/lookup (see src/domain/acceptance-links.ts).
   */
  kind: AcceptanceLinkKind;
  /** Optional scope: restrict the page to documents of this audience; undefined = all roles. */
  audienceKey?: string;
  /** Admin user who created the link (audit trail); 'system' for permanent links. */
  createdBy: string;
  createdAt: Date;
  /** Set for STANDARD links; undefined for PERMANENT links (they never expire). */
  expiresAt?: Date;
  /** Set when an admin revokes the link — a revoked link renders the uniform 404 page. */
  revokedAt?: Date;
  /** Last time the hosted page was opened with this link. */
  lastUsedAt?: Date;
}

/** Delivery evidence, append-only; occurredAt is a server-side timestamp. */
export interface NotificationEvent {
  id: string;
  customerVersionStateId: string;
  channel: NotificationChannel;
  /** User or e-mail address. */
  recipient: string;
  occurredAt: Date;
  /** Postmark MessageID — correlation key for webhook events. */
  providerRef?: string;
}

/**
 * The four broad buckets a {@link DomainEvent} falls into (used by the admin event-log category
 * filter/chip): COMMUNICATION (e-mail sent/delivered), ACCESS (hosted acceptance page opened),
 * CONSENT (acceptances + objections), ADMINISTRATION (all admin/system config + operations actions).
 */
export type EventCategory = 'COMMUNICATION' | 'ACCESS' | 'CONSENT' | 'ADMINISTRATION';

/** Who caused the event: an admin user, the customer (portal/link self-service), or the system. */
export type EventActorKind = 'ADMIN' | 'CUSTOMER' | 'SYSTEM';

/** Every specific event type the core records into the append-only Event table. */
export type EventType =
  | 'EMAIL_SENT'
  | 'EMAIL_DELIVERED'
  | 'EMAIL_BOUNCED'
  | 'PAGE_ACCESSED'
  | 'VERSION_ACCEPTED'
  | 'OBJECTION_RAISED'
  | 'VERSION_PUBLISHED'
  | 'VERSION_ACTIVATED'
  | 'VERSION_RETIRED'
  | 'DEADLINE_EXTENDED'
  | 'DEADLINE_EXPIRED'
  | 'BLOCK_SUSPENDED'
  | 'BLOCK_CARRIED_OVER'
  | 'OBLIGATION_ROLLED_OUT'
  | 'REMINDER_TRIGGERED'
  | 'MANUAL_ACCEPTANCE'
  | 'ACCEPTANCE_LINK_CREATED'
  | 'CUSTOMER_CREATED'
  | 'CUSTOMER_UPDATED'
  | 'CUSTOMER_DELETED'
  | 'DOCUMENT_CREATED'
  | 'VERSION_DRAFT_CREATED'
  | 'VERSION_UPDATED'
  | 'SIGNED_DOCUMENT_UPLOADED'
  | 'DOCUMENT_TYPE_CREATED'
  | 'DOCUMENT_TYPE_UPDATED'
  | 'DOCUMENT_TYPE_DELETED'
  | 'AUDIENCE_CREATED'
  | 'AUDIENCE_UPDATED'
  | 'AUDIENCE_DELETED'
  | 'EMAIL_TEMPLATE_CREATED'
  | 'EMAIL_TEMPLATE_UPDATED'
  | 'EMAIL_TEMPLATE_DELETED';

/**
 * One entry of the append-only, core-written activity log (the `Event` table). The core records a
 * DomainEvent via {@link EventRecorder} on each SUCCESSFUL domain action, ALONGSIDE the existing
 * evidence/audit stores (Acceptance/Objection/NotificationEvent/AdminAuditLog/OutboundEmail stay the
 * legally authoritative records — this is a parallel, denormalized read model for GET /admin/events).
 * Fields are stored denormalized (customerName, versionLabel, documentType, …) so the read side is a
 * trivial query and the row stays historically accurate even if the referenced entity later changes.
 */
export interface DomainEvent {
  id: string;
  type: EventType;
  category: EventCategory;
  /** When the recorded action happened — always server time (Clock), never a client value. */
  occurredAt: Date;
  actorKind: EventActorKind;
  /** Human-readable actor label (admin user id, customer name/e-mail, or "system"). */
  actorLabel: string;
  customerId?: string;
  /** Derived customer display name at record time (see {@link customerDisplayName}). */
  customerName?: string;
  versionId?: string;
  /** Document type key. */
  documentType?: string;
  /** Audience key. */
  audience?: string;
  versionLabel?: string;
  /** Delivery / acceptance channel of the underlying action. */
  channel?: string;
  /** E-mail recipient / accessing user id. */
  recipient?: string;
  summary: string;
  metadata?: Record<string, unknown>;
}

/** Page size of the admin event log. Filtering runs BEFORE pagination; `total` is the filtered count. */
export const EVENTS_PAGE_SIZE = 50;

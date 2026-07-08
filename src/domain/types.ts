/**
 * Domain model of the agreement service.
 * Pure types/constants: no Nest/Prisma imports (CONVENTIONS: domain is pure).
 */
import type { Actor } from '../common/auth/actor';

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
  /** ACTIVE only: grace period until hard block, starting at delivery — default DEFAULT_GRACE_PERIOD_DAYS. */
  gracePeriodDays?: number;
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
  /** = notifiedAt + objectionPeriodDays (PASSIVE) or + gracePeriodDays (ACTIVE). */
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

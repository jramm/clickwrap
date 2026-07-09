/**
 * Repository ports of the domain (aggregate-oriented, async).
 * Implementations: src/persistence/inmemory (tests) and src/persistence/prisma (runtime).
 * No Nest/Prisma imports (CONVENTIONS: domain is pure).
 */
import type {
  Acceptance,
  AcceptanceLink,
  AgreementDocument,
  AgreementVersion,
  Audience,
  Customer,
  CustomerVersionState,
  DocumentTypeDef,
  DomainEvent,
  EmailTemplate,
  EventCategory,
  NotificationEvent,
  Objection,
  ObjectionResolution,
  SignedDocument,
} from './types';

/**
 * Dynamic audiences ("customer", "partner", ...). `save` validates the key slug
 * (src/domain/keys.ts) and enforces key uniqueness; it upserts by id.
 */
export interface AudienceRepo {
  save(audience: Audience): Promise<Audience>;
  findByKey(key: string): Promise<Audience | undefined>;
  findAll(): Promise<Audience[]>;
  /**
   * Deletes the audience unless it is still referenced (AgreementDocument.audience or
   * Customer.roles). Returns true when an existing, unreferenced audience was deleted;
   * false when the key is unknown or still in use.
   */
  deleteIfUnused(key: string): Promise<boolean>;
}

/**
 * Dynamic document types ("terms", "dpa", ...). Same contract as AudienceRepo:
 * slug-validated unique keys, upsert by id.
 */
export interface DocumentTypeRepo {
  save(documentType: DocumentTypeDef): Promise<DocumentTypeDef>;
  findByKey(key: string): Promise<DocumentTypeDef | undefined>;
  findAll(): Promise<DocumentTypeDef[]>;
  /**
   * Deletes the document type unless it is still referenced (AgreementDocument.type).
   * Returns true when an existing, unreferenced document type was deleted; false when the
   * key is unknown or still in use.
   */
  deleteIfUnused(key: string): Promise<boolean>;
}

/**
 * Admin-managed e-mail templates (rollout notification / reminder). `save` upserts by id.
 * The two built-in default rows (fixed ids, see src/domain/email-template.ts) are seeded on boot
 * and are editable but never deletable.
 */
export interface EmailTemplateRepo {
  save(template: EmailTemplate): Promise<EmailTemplate>;
  findById(id: string): Promise<EmailTemplate | undefined>;
  findAll(): Promise<EmailTemplate[]>;
  /**
   * Deletes the template unless it is still assigned to a DocumentTypeDef
   * (notificationTemplateId / reminderTemplateId). Returns true when an existing, unassigned
   * template was deleted; false when the id is unknown or still assigned.
   */
  deleteIfUnused(id: string): Promise<boolean>;
}

export interface AgreementDocumentRepo {
  save(document: AgreementDocument): Promise<AgreementDocument>;
  findById(id: string): Promise<AgreementDocument | undefined>;
  /** Exactly one active document per (type key, audience key) — core invariant. */
  findByTypeAndAudience(typeKey: string, audienceKey: string): Promise<AgreementDocument | undefined>;
  findAll(): Promise<AgreementDocument[]>;
}

export interface AgreementVersionRepo {
  save(version: AgreementVersion): Promise<AgreementVersion>;
  findById(id: string): Promise<AgreementVersion | undefined>;
  findByDocument(documentId: string): Promise<AgreementVersion[]>;
  /**
   * The applicable revision per (type key, audience key) = newest PUBLISHED version with
   * validFrom <= now.
   */
  findCurrentPublished(typeKey: string, audienceKey: string, now: Date): Promise<AgreementVersion | undefined>;
  /**
   * ALL upcoming revisions per (type key, audience key) = every PUBLISHED version with
   * validFrom > now, ordered by validFrom ASC (the next one to become effective first; tie-break:
   * newest publishedAt — mirroring findCurrentPublished, which would pick it after the flip).
   * Scheduled effectiveness: published in advance, each becomes the compliance baseline at its
   * validFrom. Several future versions may be scheduled simultaneously — all are returned so the
   * dashboard, documents list and advance-acceptance surfaces show every one, not just the next.
   */
  findUpcomingPublishedList(typeKey: string, audienceKey: string, now: Date): Promise<AgreementVersion[]>;
  /** Only DRAFTs may be deleted. */
  delete(id: string): Promise<void>;
}

export interface CustomerRepo {
  save(customer: Customer): Promise<Customer>;
  findById(id: string): Promise<Customer | undefined>;
  /**
   * All customers carrying this external reference (CRM id). externalRef is NOT globally unique:
   * the external ID spaces of partners and customers are separate, so the same ref may legitimately
   * appear on entities with non-overlapping roles. The service enforces uniqueness only among
   * customers whose roles (audiences) overlap — see CustomerAdminService.
   */
  findAllByExternalRef(externalRef: string): Promise<Customer[]>;
  /** Rollout targets only customers with a matching role (audience key). */
  findByRole(audienceKey: string): Promise<Customer[]>;
  findAll(): Promise<Customer[]>;
}

/**
 * Conditional update for `CustomerVersionStateRepo.transition`: target state plus optional
 * companion fields (currently only remindersSent — the reminder counter is only advanced
 * while the state is still NOTIFIED).
 */
export type CustomerVersionStateTransition = Pick<CustomerVersionState, 'state'> &
  Partial<Pick<CustomerVersionState, 'remindersSent'>>;

export interface CustomerVersionStateRepo {
  save(state: CustomerVersionState): Promise<CustomerVersionState>;
  /**
   * Conditional transition (lost-update protection): writes `update` only if the STORED state
   * still equals `expectedState` (SQL: UPDATE … WHERE id = $1 AND state = $2).
   * Returns the new state on success, `null` when the precondition failed (the state was
   * changed by another path in the meantime) — the caller then decides (no-op for jobs,
   * DomainError for user actions). Unknown id → also `null`.
   */
  transition(
    id: string,
    expectedState: CustomerVersionState['state'],
    update: CustomerVersionStateTransition,
  ): Promise<CustomerVersionState | null>;
  findById(id: string): Promise<CustomerVersionState | undefined>;
  findByCustomerAndVersion(customerId: string, versionId: string): Promise<CustomerVersionState | undefined>;
  findByCustomer(customerId: string): Promise<CustomerVersionState[]>;
  /** Open (non-terminal) states of a version — for supersede when publishing the successor version. */
  findOpenByVersion(versionId: string): Promise<CustomerVersionState[]>;
  /**
   * ALL states of a version (any state value) — for the per-version acceptance dashboard, which
   * counts relevant states (non-SUPERSEDED) and buckets them (accepted/pending/blocked/objected).
   */
  findByVersion(versionId: string): Promise<CustomerVersionState[]>;
  /** Sweeper candidates: state=NOTIFIED and deadlineAt <= now. */
  findDueForSweep(now: Date): Promise<CustomerVersionState[]>;
  /**
   * Atomic delivery (SET notifiedAt=... WHERE notifiedAt IS NULL AND state='PENDING_NOTIFICATION'):
   * writes state/notifiedAt/deadlineAt only if notifiedAt is still empty AND the state is still
   * PENDING_NOTIFICATION — a state that became SUPERSEDED/ACCEPTED in the meantime is never
   * "revived" to NOTIFIED. Otherwise the stored state remains unchanged.
   * Returns the stored state in both cases (idempotent, no backdating).
   */
  setNotifiedAtomically(
    id: string,
    update: Pick<CustomerVersionState, 'state' | 'notifiedAt' | 'deadlineAt'>,
  ): Promise<CustomerVersionState>;
}

export interface AcceptanceRepo {
  /**
   * Append-only. Invariant: exactly one effective acceptance per (customerId, versionId) —
   * a second effective entry is rejected (DomainError ALREADY_ACCEPTED).
   */
  append(acceptance: Acceptance): Promise<Acceptance>;
  /** Correction: the old entry gets isEffective=false + supersededByAcceptanceId (never deleted). */
  supersede(acceptanceId: string, byAcceptanceId: string): Promise<Acceptance>;
  findById(id: string): Promise<Acceptance | undefined>;
  findEffective(customerId: string, versionId: string): Promise<Acceptance | undefined>;
  /** All EFFECTIVE acceptances of a version — for the dashboard's channel/method breakdown. */
  findEffectiveByVersion(versionId: string): Promise<Acceptance[]>;
  /** Complete history (including ineffective entries), chronological. */
  findByCustomer(customerId: string): Promise<Acceptance[]>;
  /**
   * ALL acceptances (every customer/version, including ineffective entries), in append order
   * (ascending by acceptedAt). Feeds the cross-source legal event log (src/events); in-memory
   * aggregation is acceptable for the MVP.
   */
  findAll(): Promise<Acceptance[]>;
}

export interface ObjectionRepo {
  append(objection: Objection): Promise<Objection>;
  findById(id: string): Promise<Objection | undefined>;
  findByCustomerAndVersion(customerId: string, versionId: string): Promise<Objection[]>;
  findByCustomer(customerId: string): Promise<Objection[]>;
  /**
   * ALL objections (every customer/version), in append order. Feeds the cross-source legal event
   * log (src/events).
   */
  findAll(): Promise<Objection[]>;
  /** Resolution (no dead-end state): late consent or admin decision. */
  resolve(id: string, resolution: ObjectionResolution, resolvedBy: string, resolvedAt: Date): Promise<Objection>;
}

/**
 * Hosted acceptance links (channel LINK). Lookup is exclusively by tokenHash — the raw URL
 * token is never persisted (src/domain/acceptance-links.ts).
 */
export interface AcceptanceLinkRepo {
  /** Duplicate id or tokenHash → DomainError INVALID_STATE (tokenHash is a unique capability). */
  create(link: AcceptanceLink): Promise<AcceptanceLink>;
  findByTokenHash(tokenHash: string): Promise<AcceptanceLink | undefined>;
  /** Records page usage; unknown id is a no-op (the page render must never fail on this). */
  touch(id: string, lastUsedAt: Date): Promise<void>;
  /** Idempotent: the first revocation wins (revokedAt is never overwritten). Unknown id → undefined. */
  revoke(id: string, revokedAt: Date): Promise<AcceptanceLink | undefined>;
  listByCustomer(customerId: string): Promise<AcceptanceLink[]>;
}

export interface NotificationEventRepo {
  append(event: NotificationEvent): Promise<NotificationEvent>;
  findByState(customerVersionStateId: string): Promise<NotificationEvent[]>;
  /**
   * ALL notification events (every customer-version state), in append order. Feeds the
   * cross-source legal event log (src/events); the customer/version is resolved there via the
   * CustomerVersionState the event points at.
   */
  findAll(): Promise<NotificationEvent[]>;
  /** Correlates Postmark webhook events via the MessageID. */
  findByProviderRef(providerRef: string): Promise<NotificationEvent | undefined>;
}

/**
 * Externally-signed documents (evidence archive). Append-only — corrections are a new upload,
 * never an update/delete (no such methods in the MVP, mirroring the append-only Acceptance store).
 */
export interface SignedDocumentRepo {
  append(document: SignedDocument): Promise<SignedDocument>;
  findById(id: string): Promise<SignedDocument | undefined>;
  /** All signed documents of a customer, NEWEST FIRST (by uploadedAt desc). */
  findByCustomer(customerId: string): Promise<SignedDocument[]>;
}

/** Filters for {@link EventRepo.query}. All optional; combined with AND; the date range is inclusive. */
export interface EventQueryFilters {
  customerId?: string;
  /** occurredAt >= from (inclusive). */
  from?: Date;
  /** occurredAt <= to (inclusive). */
  to?: Date;
  category?: EventCategory;
  documentType?: string;
  versionId?: string;
}

/**
 * Append-only activity log written by the core on each successful domain action (dual-write next to
 * the evidence stores). Backs GET /admin/events. `append` is a pure create; `query` filters BEFORE
 * paginating (50/page), sorts occurredAt DESC with a stable id tiebreak, and returns the FILTERED
 * total (not the page count).
 */
export interface EventRepo {
  append(event: DomainEvent): Promise<DomainEvent>;
  query(filters: EventQueryFilters, page?: number): Promise<{ items: DomainEvent[]; total: number }>;
}

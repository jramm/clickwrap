import { Inject, Injectable } from '@nestjs/common';
import { ADMIN_AUDIT_TOKEN, type AdminAuditAction, type AdminAuditLog, type AdminAuditRepo } from '../agreements/audit';
import type { Actor } from '../common/auth/actor';
import { customerDisplayName } from '../domain/customer';
import type {
  AcceptanceRepo,
  AgreementDocumentRepo,
  AgreementVersionRepo,
  CustomerRepo,
  CustomerVersionStateRepo,
  NotificationEventRepo,
  ObjectionRepo,
} from '../domain/ports';
import type { Acceptance, AgreementVersion, Customer, NotificationEvent, Objection } from '../domain/types';
import { TOKENS } from '../persistence/tokens';

export type EventCategory = 'COMMUNICATION' | 'ACCESS' | 'CONSENT' | 'ADMINISTRATION';
export type EventActorKind = 'ADMIN' | 'CUSTOMER' | 'SYSTEM';
export type EventType =
  | 'EMAIL_SENT'
  | 'PAGE_ACCESSED'
  | 'VERSION_ACCEPTED'
  | 'OBJECTION_RAISED'
  | 'VERSION_PUBLISHED'
  | 'DEADLINE_EXTENDED'
  | 'BLOCK_SUSPENDED'
  | 'REMINDER_TRIGGERED'
  | 'MANUAL_ACCEPTANCE'
  | 'ACCEPTANCE_LINK_CREATED'
  | 'CUSTOMER_CREATED'
  | 'CUSTOMER_UPDATED'
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

/** A single normalized, source-agnostic legal event as returned by GET /admin/events. */
export interface EventView {
  /** Source-prefixed stable id (`audit:`/`acc:`/`obj:`/`notif:`). */
  id: string;
  /** ISO-8601 date-time. */
  occurredAt: string;
  type: EventType;
  category: EventCategory;
  actorKind: EventActorKind;
  actorLabel: string;
  customerId?: string;
  customerName?: string;
  versionId?: string;
  documentType?: string;
  audience?: string;
  versionLabel?: string;
  channel?: string;
  recipient?: string;
  summary: string;
  metadata?: Record<string, unknown>;
}

export interface EventQuery {
  customerId?: string;
  /** ISO date-time or date-only (YYYY-MM-DD → start-of-day). occurredAt >= from. */
  from?: string;
  /** ISO date-time or date-only (YYYY-MM-DD → end-of-day). occurredAt <= to. */
  to?: string;
  category?: EventCategory;
  documentType?: string;
  versionId?: string;
  page?: number;
}

export interface EventListResult {
  items: EventView[];
  total: number;
}

/** Page size of the event log. Filtering runs BEFORE pagination; `total` is the filtered count. */
export const EVENTS_PAGE_SIZE = 50;

/** occurredAt held as an epoch millis alongside the ISO string so we can sort without re-parsing. */
interface NormalizedEvent extends EventView {
  occurredAtMs: number;
}

/** Version metadata resolved from the (document → versions) graph. */
interface VersionMeta {
  documentType?: string;
  audience?: string;
  versionLabel?: string;
}

/**
 * Aggregates the append-only evidence sources (admin audit log, acceptances, objections,
 * notification events) into ONE normalized, filterable, chronological (newest-first) event list
 * for legal tracing — for the whole system or a single customer. No new persistence: every source
 * already exists; this is a pure in-memory aggregation (acceptable for the MVP — the sources are
 * bounded by the admin/legal domain size). No source is truncated.
 */
@Injectable()
export class EventsService {
  constructor(
    @Inject(ADMIN_AUDIT_TOKEN) private readonly audit: AdminAuditRepo,
    @Inject(TOKENS.AcceptanceRepo) private readonly acceptances: AcceptanceRepo,
    @Inject(TOKENS.ObjectionRepo) private readonly objections: ObjectionRepo,
    @Inject(TOKENS.NotificationEventRepo) private readonly notifications: NotificationEventRepo,
    @Inject(TOKENS.CustomerRepo) private readonly customers: CustomerRepo,
    @Inject(TOKENS.CustomerVersionStateRepo) private readonly states: CustomerVersionStateRepo,
    @Inject(TOKENS.AgreementVersionRepo) private readonly versions: AgreementVersionRepo,
    @Inject(TOKENS.AgreementDocumentRepo) private readonly documents: AgreementDocumentRepo,
  ) {}

  async list(query: EventQuery = {}): Promise<EventListResult> {
    const customerList = await this.customers.findAll();
    const customerNames = new Map<string, string>(customerList.map((c) => [c.id, customerDisplayName(c)]));
    const versionMeta = await this.buildVersionMeta();
    const stateIndex = await this.buildStateIndex(customerList);

    const normalized: NormalizedEvent[] = [
      ...(await this.acceptances.findAll()).map((a) => this.fromAcceptance(a, customerNames, versionMeta)),
      ...(await this.objections.findAll()).map((o) => this.fromObjection(o, customerNames, versionMeta)),
      ...(await this.notifications.findAll())
        .map((n) => this.fromNotification(n, customerNames, versionMeta, stateIndex))
        // A notification event whose state cannot be resolved is dropped (nothing to attribute it to).
        .filter((e): e is NormalizedEvent => e !== undefined),
      ...(await this.audit.findAll()).map((l) => this.fromAudit(l, customerNames, versionMeta, stateIndex)),
    ];

    const filtered = normalized.filter((event) => this.matches(event, query));
    // Newest first; stable tiebreak by id so equal timestamps keep a deterministic order.
    filtered.sort((a, b) => b.occurredAtMs - a.occurredAtMs || a.id.localeCompare(b.id));

    const page = query.page && query.page > 0 ? query.page : 1;
    const start = (page - 1) * EVENTS_PAGE_SIZE;
    const items = filtered.slice(start, start + EVENTS_PAGE_SIZE).map(stripInternal);
    return { items, total: filtered.length };
  }

  private matches(event: NormalizedEvent, query: EventQuery): boolean {
    if (query.customerId !== undefined && event.customerId !== query.customerId) {
      return false;
    }
    if (query.category !== undefined && event.category !== query.category) {
      return false;
    }
    if (query.documentType !== undefined && event.documentType !== query.documentType) {
      return false;
    }
    if (query.versionId !== undefined && event.versionId !== query.versionId) {
      return false;
    }
    const from = parseFrom(query.from);
    if (from !== undefined && event.occurredAtMs < from) {
      return false;
    }
    const to = parseTo(query.to);
    if (to !== undefined && event.occurredAtMs > to) {
      return false;
    }
    return true;
  }

  /** version id → { documentType, audience, versionLabel }, resolved via document → versions. */
  private async buildVersionMeta(): Promise<Map<string, VersionMeta>> {
    const meta = new Map<string, VersionMeta>();
    for (const document of await this.documents.findAll()) {
      const versions = await this.versions.findByDocument(document.id);
      for (const version of versions) {
        meta.set(version.id, {
          documentType: document.type,
          audience: document.audience,
          versionLabel: version.versionLabel,
        });
      }
    }
    return meta;
  }

  /**
   * state id → { customerId, versionId } for resolving NotificationEvent + CustomerVersionState-
   * targeted audit entries. Every state belongs to a customer, so iterating customers covers all.
   */
  private async buildStateIndex(
    customerList: Customer[],
  ): Promise<Map<string, { customerId: string; versionId: string }>> {
    const index = new Map<string, { customerId: string; versionId: string }>();
    for (const customer of customerList) {
      for (const state of await this.states.findByCustomer(customer.id)) {
        index.set(state.id, { customerId: state.customerId, versionId: state.versionId });
      }
    }
    return index;
  }

  private fromAcceptance(
    acceptance: Acceptance,
    customerNames: Map<string, string>,
    versionMeta: Map<string, VersionMeta>,
  ): NormalizedEvent {
    const meta = versionMeta.get(acceptance.versionId);
    const { actorKind, actorLabel } = actorFromChannel(acceptance.channel, acceptance.actor);
    const label = meta?.versionLabel ?? acceptance.versionId;
    return this.build({
      id: `acc:${acceptance.id}`,
      occurredAt: acceptance.acceptedAt,
      type: 'VERSION_ACCEPTED',
      category: 'CONSENT',
      actorKind,
      actorLabel,
      customerId: acceptance.customerId,
      customerName: customerNames.get(acceptance.customerId),
      versionId: acceptance.versionId,
      documentType: meta?.documentType,
      audience: meta?.audience,
      versionLabel: meta?.versionLabel,
      channel: acceptance.channel,
      summary: `Version ${label} accepted (${acceptance.method}, ${acceptance.channel})`,
      metadata: {
        method: acceptance.method,
        isEffective: acceptance.isEffective,
        // A superseded (corrected) acceptance stays in the log, flagged here.
        ...(acceptance.supersededByAcceptanceId !== undefined
          ? { supersededByAcceptanceId: acceptance.supersededByAcceptanceId }
          : {}),
        ...(acceptance.evidenceNote !== undefined ? { evidenceNote: acceptance.evidenceNote } : {}),
      },
    });
  }

  private fromObjection(
    objection: Objection,
    customerNames: Map<string, string>,
    versionMeta: Map<string, VersionMeta>,
  ): NormalizedEvent {
    const meta = versionMeta.get(objection.versionId);
    const { actorKind, actorLabel } = actorFromChannel(objection.channel, objection.actor);
    const label = meta?.versionLabel ?? objection.versionId;
    return this.build({
      id: `obj:${objection.id}`,
      occurredAt: objection.objectedAt,
      type: 'OBJECTION_RAISED',
      category: 'CONSENT',
      actorKind,
      actorLabel,
      customerId: objection.customerId,
      customerName: customerNames.get(objection.customerId),
      versionId: objection.versionId,
      documentType: meta?.documentType,
      audience: meta?.audience,
      versionLabel: meta?.versionLabel,
      channel: objection.channel,
      summary: `Objection raised against version ${label}${objection.reason ? `: ${objection.reason}` : ''}`,
      metadata: {
        ...(objection.reason !== undefined ? { reason: objection.reason } : {}),
        ...(objection.resolution !== undefined ? { resolution: objection.resolution } : {}),
      },
    });
  }

  private fromNotification(
    event: NotificationEvent,
    customerNames: Map<string, string>,
    versionMeta: Map<string, VersionMeta>,
    stateIndex: Map<string, { customerId: string; versionId: string }>,
  ): NormalizedEvent | undefined {
    const resolved = stateIndex.get(event.customerVersionStateId);
    if (!resolved) {
      return undefined;
    }
    const meta = versionMeta.get(resolved.versionId);
    // channel EMAIL = a mail was sent/delivered (COMMUNICATION); channel LINK/PORTAL = the hosted
    // acceptance page was OPENED — provable access (ACCESS).
    const isEmail = event.channel === 'EMAIL';
    const label = meta?.versionLabel ?? resolved.versionId;
    return this.build({
      id: `notif:${event.id}`,
      occurredAt: event.occurredAt,
      type: isEmail ? 'EMAIL_SENT' : 'PAGE_ACCESSED',
      category: isEmail ? 'COMMUNICATION' : 'ACCESS',
      actorKind: isEmail ? 'SYSTEM' : 'CUSTOMER',
      actorLabel: isEmail ? 'system' : event.recipient,
      customerId: resolved.customerId,
      customerName: customerNames.get(resolved.customerId),
      versionId: resolved.versionId,
      documentType: meta?.documentType,
      audience: meta?.audience,
      versionLabel: meta?.versionLabel,
      channel: event.channel,
      recipient: event.recipient,
      summary: isEmail
        ? `E-mail sent to ${event.recipient} (version ${label})`
        : `Acceptance page opened via ${event.channel} (version ${label})`,
      ...(event.providerRef !== undefined ? { metadata: { providerRef: event.providerRef } } : {}),
    });
  }

  private fromAudit(
    log: AdminAuditLog,
    customerNames: Map<string, string>,
    versionMeta: Map<string, VersionMeta>,
    stateIndex: Map<string, { customerId: string; versionId: string }>,
  ): NormalizedEvent {
    const type = auditType(log);
    const { customerId, versionId } = resolveAuditTarget(log, stateIndex);
    const meta = versionId ? versionMeta.get(versionId) : undefined;
    const actorKind: EventActorKind = log.actor === 'system' ? 'SYSTEM' : 'ADMIN';
    return this.build({
      id: `audit:${log.id}`,
      occurredAt: log.createdAt,
      type,
      category: 'ADMINISTRATION',
      actorKind,
      actorLabel: log.actor,
      customerId,
      customerName: customerId ? customerNames.get(customerId) : undefined,
      versionId,
      documentType: meta?.documentType ?? metaString(log.metadata, 'documentTypeKey'),
      audience: meta?.audience,
      versionLabel: meta?.versionLabel,
      summary: auditSummary(type, log, meta?.versionLabel ?? versionId),
      metadata: {
        action: log.action,
        targetType: log.targetType,
        targetId: log.targetId,
        ...(log.reason !== undefined ? { reason: log.reason } : {}),
        ...(log.metadata ?? {}),
      },
    });
  }

  private build(view: Omit<EventView, 'occurredAt'> & { occurredAt: Date }): NormalizedEvent {
    return { ...view, occurredAt: view.occurredAt.toISOString(), occurredAtMs: view.occurredAt.getTime() };
  }
}

const stripInternal = (event: NormalizedEvent): EventView => {
  const { occurredAtMs: _occurredAtMs, ...rest } = event;
  return rest;
};

/** Acceptance/Objection channel → actor kind + label (see the port-level channel semantics). */
const actorFromChannel = (
  channel: Acceptance['channel'],
  actor: Actor,
): { actorKind: EventActorKind; actorLabel: string } => {
  if (channel === 'ADMIN') {
    return { actorKind: 'ADMIN', actorLabel: actor.userId };
  }
  if (channel === 'SYSTEM') {
    return { actorKind: 'SYSTEM', actorLabel: actor.userId };
  }
  // PORTAL / LINK: the customer acted; the identity is self-declared on the hosted page.
  return { actorKind: 'CUSTOMER', actorLabel: actor.name ?? actor.email ?? 'customer' };
};

const auditType = (log: AdminAuditLog): EventType => {
  switch (log.action) {
    case 'PUBLISH':
      return 'VERSION_PUBLISHED';
    case 'MANUAL_ACCEPTANCE':
      return 'MANUAL_ACCEPTANCE';
    case 'CUSTOMER_VERSION_STATE_PATCH':
      // suspendBlock=true → a block was suspended; otherwise a deadline was extended.
      return log.metadata?.suspendBlock === true ? 'BLOCK_SUSPENDED' : 'DEADLINE_EXTENDED';
    case 'REMIND':
      return 'REMINDER_TRIGGERED';
    case 'CUSTOMER_CREATE':
      return 'CUSTOMER_CREATED';
    case 'CUSTOMER_UPDATE':
      return 'CUSTOMER_UPDATED';
    case 'ACCEPTANCE_LINK_CREATE':
      return 'ACCEPTANCE_LINK_CREATED';
    case 'SIGNED_DOCUMENT_UPLOAD':
      return 'SIGNED_DOCUMENT_UPLOADED';
    default:
      return CRUD_TYPES[log.action];
  }
};

/** The remaining CRUD audit actions map 1:1 (…_CREATE → …_CREATED etc.). */
const CRUD_TYPES: Record<
  Extract<
    AdminAuditAction,
    | 'DOCUMENT_TYPE_CREATE'
    | 'DOCUMENT_TYPE_UPDATE'
    | 'DOCUMENT_TYPE_DELETE'
    | 'AUDIENCE_CREATE'
    | 'AUDIENCE_UPDATE'
    | 'AUDIENCE_DELETE'
    | 'EMAIL_TEMPLATE_CREATE'
    | 'EMAIL_TEMPLATE_UPDATE'
    | 'EMAIL_TEMPLATE_DELETE'
  >,
  EventType
> = {
  DOCUMENT_TYPE_CREATE: 'DOCUMENT_TYPE_CREATED',
  DOCUMENT_TYPE_UPDATE: 'DOCUMENT_TYPE_UPDATED',
  DOCUMENT_TYPE_DELETE: 'DOCUMENT_TYPE_DELETED',
  AUDIENCE_CREATE: 'AUDIENCE_CREATED',
  AUDIENCE_UPDATE: 'AUDIENCE_UPDATED',
  AUDIENCE_DELETE: 'AUDIENCE_DELETED',
  EMAIL_TEMPLATE_CREATE: 'EMAIL_TEMPLATE_CREATED',
  EMAIL_TEMPLATE_UPDATE: 'EMAIL_TEMPLATE_UPDATED',
  EMAIL_TEMPLATE_DELETE: 'EMAIL_TEMPLATE_DELETED',
};

/** Resolve the affected customer/version from an audit entry's target + metadata. */
const resolveAuditTarget = (
  log: AdminAuditLog,
  stateIndex: Map<string, { customerId: string; versionId: string }>,
): { customerId?: string; versionId?: string } => {
  if (log.targetType === 'Customer') {
    return { customerId: log.targetId };
  }
  if (log.targetType === 'AgreementVersion') {
    return { versionId: log.targetId };
  }
  if (log.targetType === 'CustomerVersionState') {
    const resolved = stateIndex.get(log.targetId);
    return { customerId: resolved?.customerId, versionId: resolved?.versionId };
  }
  // MANUAL_ACCEPTANCE / ACCEPTANCE_LINK_CREATE / SIGNED_DOCUMENT_UPLOAD carry the ids in metadata.
  return {
    customerId: metaString(log.metadata, 'customerId'),
    versionId: metaString(log.metadata, 'versionId'),
  };
};

const metaString = (metadata: Record<string, unknown> | undefined, key: string): string | undefined => {
  const value = metadata?.[key];
  return typeof value === 'string' ? value : undefined;
};

const auditSummary = (type: EventType, log: AdminAuditLog, versionLabel: string | undefined): string => {
  const reason = log.reason ? ` — ${log.reason}` : '';
  const version = versionLabel ?? log.targetId;
  switch (type) {
    case 'VERSION_PUBLISHED':
      return `Version ${version} published`;
    case 'MANUAL_ACCEPTANCE':
      return `Manual acceptance recorded for version ${version}${reason}`;
    case 'DEADLINE_EXTENDED':
      return `Deadline extended${reason}`;
    case 'BLOCK_SUSPENDED':
      return `Block suspended${reason}`;
    case 'REMINDER_TRIGGERED':
      return 'Reminder e-mail re-sent';
    case 'ACCEPTANCE_LINK_CREATED':
      return 'Acceptance link created';
    case 'SIGNED_DOCUMENT_UPLOADED':
      return 'Signed document uploaded';
    case 'CUSTOMER_CREATED':
      return 'Customer created';
    case 'CUSTOMER_UPDATED':
      return 'Customer updated';
    case 'DOCUMENT_TYPE_CREATED':
      return 'Document type created';
    case 'DOCUMENT_TYPE_UPDATED':
      return 'Document type updated';
    case 'DOCUMENT_TYPE_DELETED':
      return 'Document type deleted';
    case 'AUDIENCE_CREATED':
      return 'Audience created';
    case 'AUDIENCE_UPDATED':
      return 'Audience updated';
    case 'AUDIENCE_DELETED':
      return 'Audience deleted';
    case 'EMAIL_TEMPLATE_CREATED':
      return 'E-mail template created';
    case 'EMAIL_TEMPLATE_UPDATED':
      return 'E-mail template updated';
    case 'EMAIL_TEMPLATE_DELETED':
      return 'E-mail template deleted';
    default:
      return log.action;
  }
};

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** occurredAt >= from. A date-only `from` is the start of that (UTC) day. */
const parseFrom = (value: string | undefined): number | undefined => {
  if (!value) {
    return undefined;
  }
  const iso = DATE_ONLY.test(value) ? `${value}T00:00:00.000Z` : value;
  const ms = new Date(iso).getTime();
  return Number.isNaN(ms) ? undefined : ms;
};

/** occurredAt <= to. A date-only `to` is the END of that (UTC) day so a single-day range works. */
const parseTo = (value: string | undefined): number | undefined => {
  if (!value) {
    return undefined;
  }
  const iso = DATE_ONLY.test(value) ? `${value}T23:59:59.999Z` : value;
  const ms = new Date(iso).getTime();
  return Number.isNaN(ms) ? undefined : ms;
};

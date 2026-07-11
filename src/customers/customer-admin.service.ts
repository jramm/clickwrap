import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ADMIN_AUDIT_TOKEN, type AdminAuditRepo } from '../agreements/audit.js';
import { newId } from '../agreements/ids.js';
import { AGREEMENTS_TOKENS, type RolloutNotifier } from '../agreements/ports.js';
import { EventRecorder } from '../events/event-recorder.js';
import type { Actor } from '../common/auth/actor.js';
import { DomainError } from '../common/errors.js';
import type { Clock } from '../domain/clock.js';
import { computeCompliance, type ComplianceResult, type CurrentVersionEntry } from '../domain/compliance.js';
import { customerDisplayName } from '../domain/customer.js';
import { rolloutDeadlineFor } from '../domain/state-machine.js';
import type {
  AcceptanceRepo,
  AgreementDocumentRepo,
  AgreementVersionRepo,
  AudienceRepo,
  CustomerRepo,
  CustomerVersionStateRepo,
} from '../domain/ports.js';
import type {
  AgreementDocument,
  AgreementVersion,
  Customer,
  CustomerVersionStateValue,
  EventActorKind,
} from '../domain/types.js';
import { TOKENS } from '../persistence/tokens.js';
import { matchesCustomerSearch } from './customer-search.js';

/** A version the customer accepted out-of-band (e.g. by signing an offer in the CRM). */
export interface AcceptedVersionImport {
  versionId: string;
  /** Signature date — backdating is explicitly allowed for IMPORT; defaults to now. */
  acceptedAt?: string | Date;
  /** Evidence reference (e.g. "HubSpot deal 12345 / signed offer"). */
  reference?: string;
}

export interface CreateCustomerInput {
  externalRef: string;
  /** Contact person's given name — defaults to '' when omitted. */
  firstName?: string;
  /** Contact person's family name — defaults to '' when omitted. */
  lastName?: string;
  /** Optional company/organisation name (preferred display label when set). */
  companyName?: string;
  roles: string[];
  contactEmails: string[];
  /** Optional: versions already accepted out-of-band, recorded as IMPORT acceptances. */
  acceptedVersions?: AcceptedVersionImport[];
  /**
   * Optional (#29): accept documents by TYPE at a contract signing date. For each listed document
   * type, across the audiences the customer's roles cover, the version effective at `effectiveDate`
   * is recorded as an IMPORT acceptance (dated `effectiveDate`).
   */
  signedDocuments?: {
    effectiveDate: string | Date;
    documentTypes: string[];
    reference?: string;
  };
  /**
   * Provenance of the record (see {@link Customer.source}). Defaults to `'manual'` — the customer
   * sync passes its source key so the reconcile engine can later find/update/soft-delete it.
   */
  source?: string;
}

/**
 * Default provenance tag for customers PUSHED in through the inbound integration API
 * ({@link CustomerAdminService.upsertByExternalRef}) when the caller omits `source`. `source` is
 * the caller's own system namespace — e.g. a CRM passes `'crm'` — and is
 * stored purely as a provenance label ON CREATE. It is NOT the resolution key: an inbound record is
 * resolved by (`externalRef`, `audience`), because in clickwrap an `externalRef` is only unique in
 * combination with an audience (overlap-aware uniqueness — see
 * {@link CustomerAdminService.assertExternalRefUniqueForRoles}).
 */
export const DEFAULT_INBOUND_SOURCE = 'external';

/**
 * Inbound push of a customer from an upstream system (see {@link CustomerAdminService.upsertByExternalRef}).
 * The resolution key is (`externalRef`, `audience`): among the customers carrying `externalRef`, the
 * one whose `roles` OVERLAP the pushed `roles` is the target (at most one by the overlap-aware
 * uniqueness rule). `source` is a create-only provenance tag, never part of the lookup. This is a
 * full representation of the identity fields — omitted optional fields are normalised to their
 * defaults (firstName/lastName → '', companyName → unset), exactly like the create path and the
 * customer sync's reconcile.
 */
export interface UpsertByExternalRefInput {
  externalRef: string;
  firstName?: string;
  lastName?: string;
  companyName?: string;
  contactEmails: string[];
  roles: string[];
  /** Caller's system namespace; defaults to {@link DEFAULT_INBOUND_SOURCE}. */
  source?: string;
}

/**
 * Any subset. ADDING a role immediately creates PENDING_NOTIFICATION states for the current
 * published versions of that audience (onboarding rollout); removing a role only takes effect
 * on the next publish (open states of removed roles are left untouched).
 */
export interface UpdateCustomerInput {
  firstName?: string;
  lastName?: string;
  companyName?: string;
  roles?: string[];
  contactEmails?: string[];
}

/**
 * Compliance filter of the customer list — reuses the states the domain already knows. Mirrors the
 * old global overview status filter plus the per-version customer view vocabulary:
 * `non_compliant` = the domain compliance gate is closed (blocking, incl. block carry-over);
 * `pending` = an outstanding PENDING_NOTIFICATION/NOTIFIED state; `blocked` = a hard
 * EXPIRED_BLOCKING state; `objected` = an OBJECTED state; `compliant` = nothing outstanding
 * (all relevant documents accepted or not yet rolled out — the gate is open and clean).
 */
export type ComplianceFilter = 'compliant' | 'non_compliant' | 'pending' | 'blocked' | 'objected';

/** Compact per-row status shown as a chip; the worst outstanding status wins. */
export type CustomerComplianceStatus = 'compliant' | 'pending' | 'objected' | 'blocked';

/**
 * Optional filters for the customer list. `audience`/`documentType` do TWO things: they NARROW the
 * returned rows to customers who actually have a matching document/role assigned (see
 * {@link CustomerAdminService.matchesAssignment}) AND they scope the per-row compliance evaluation
 * (and thus the indicator) to that audience's documents / that type. An unknown key matches no
 * document/role, so the list is empty (lenient — no error). `compliance` additionally filters the
 * (narrowed) rows to customers matching that status.
 */
export interface CustomerListFilters {
  audience?: string;
  documentType?: string;
  compliance?: ComplianceFilter;
}

export interface CustomerRow {
  id: string;
  externalRef: string;
  firstName: string;
  lastName: string;
  companyName?: string;
  roles: string[];
  contactEmails: string[];
  /** Set only on a soft-deleted (sync-removed) customer — the detail page badges it. */
  deletedAt?: Date;
  /** Compliance gate (domain semantics: false = blocked). Present only on list rows. */
  compliant?: boolean;
  /** Compact status for the list chip. Present only on list rows. */
  complianceStatus?: CustomerComplianceStatus;
}

export interface CustomerListResult {
  items: CustomerRow[];
  total: number;
}

const OUTSTANDING_PENDING: readonly CustomerVersionStateValue[] = ['PENDING_NOTIFICATION', 'NOTIFIED'];

export interface ImportedAcceptance {
  versionId: string;
  acceptanceId: string;
}

export interface CreateCustomerResult extends CustomerRow {
  importedAcceptances: ImportedAcceptance[];
}

/** Who created the customer — recorded on the CUSTOMER_CREATE audit entry. */
export type CustomerCreateSource = 'admin' | 'integration';

const PAGE_SIZE = 50;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface ValidatedImport {
  version: AgreementVersion;
  acceptedAt: Date;
  reference?: string;
}

/**
 * Customer administration shared by the admin API (AdminController) and the integration API
 * (CustomerOnboardingController). All dependencies come from the global RepositoryModule, so the
 * service is provider-only (CustomerServiceModule) and free of module-local wiring.
 *
 * Roles are validated against the AudienceRepo. Creating a customer (and adding a role via
 * update) runs an ONBOARDING ROLLOUT: PENDING_NOTIFICATION states are created for every current
 * published version covered by the roles — without them the customer would never appear in
 * pending-agreements (popup/hosted page) until the next publish. Like publish, every rolled-out
 * version triggers an acceptance-notification e-mail through the shared RolloutNotifier port;
 * versions covered by an `acceptedVersions` import are already ACCEPTED and get no mail.
 * Deadlines still start with the first provable access, never with the plain send. Removing a
 * role takes effect on the next publish only.
 */
@Injectable()
export class CustomerAdminService {
  private readonly logger = new Logger(CustomerAdminService.name);

  constructor(
    @Inject(TOKENS.CustomerRepo) private readonly customers: CustomerRepo,
    @Inject(TOKENS.AudienceRepo) private readonly audiences: AudienceRepo,
    @Inject(TOKENS.AgreementVersionRepo) private readonly versions: AgreementVersionRepo,
    @Inject(TOKENS.AgreementDocumentRepo) private readonly documents: AgreementDocumentRepo,
    @Inject(TOKENS.CustomerVersionStateRepo) private readonly states: CustomerVersionStateRepo,
    @Inject(TOKENS.AcceptanceRepo) private readonly acceptances: AcceptanceRepo,
    @Inject(AGREEMENTS_TOKENS.RolloutNotifier) private readonly notifier: RolloutNotifier,
    @Inject(ADMIN_AUDIT_TOKEN) private readonly audit: AdminAuditRepo,
    @Inject(TOKENS.Clock) private readonly clock: Clock,
    @Optional() private readonly recorder?: EventRecorder,
  ) {}

  /**
   * Paginated customer list (50/page), sorted by name then externalRef. An optional `search` term
   * is applied FIRST (case-insensitive substring on name / externalRef / contactEmails — see
   * {@link matchesCustomerSearch}). Every row carries a compliance indicator (computed via the pure
   * domain {@link computeCompliance} over the customer's states + the current published versions,
   * optionally scoped by `filters.documentType`/`filters.audience`). When `filters.compliance` is
   * set the rows are additionally filtered to customers matching that status. In all cases the
   * search + row narrowing + compliance filter run BEFORE pagination, so `total` reflects the
   * filtered count.
   */
  async list(page?: number, search?: string, filters: CustomerListFilters = {}): Promise<CustomerListResult> {
    // The admin LIST excludes soft-deleted customers (sync-removed): they must not reappear as
    // active rows. The detail page (get) and history still show them (deletedAt set).
    const all = (await this.customers.findAll()).filter((c) => c.deletedAt === undefined);
    const searched = search ? all.filter((c) => matchesCustomerSearch(c, search)) : all;
    searched.sort((a, b) => {
      const byName = customerDisplayName(a).localeCompare(customerDisplayName(b));
      return byName !== 0 ? byName : a.externalRef.localeCompare(b.externalRef);
    });

    // Fetch documents ONCE and reuse them for both the row-narrowing predicate and the scoped
    // current-version lookup (compliance chip) to avoid a double findAll().
    const documents = await this.documents.findAll();
    // Row narrowing by audience/documentType — applied to the searched set BEFORE the compliance
    // filter and pagination, so `total` reflects the narrowed count.
    const narrowed = searched.filter((c) => matchesAssignment(c, documents, filters));

    const scopedEntries = await this.scopedCurrentVersions(documents, filters.documentType);
    const p = page && page > 0 ? page : 1;

    if (filters.compliance) {
      // Filter-first: compute compliance for the whole narrowed set, keep the matching rows, then
      // paginate — `total` must reflect the compliance-filtered count.
      const matched: CustomerRow[] = [];
      for (const customer of narrowed) {
        const compliance = await this.evaluateCompliance(customer, scopedEntries, filters.audience);
        if (this.matchesCompliance(filters.compliance, compliance)) {
          matched.push(toRow(customer, compliance));
        }
      }
      return { items: matched.slice((p - 1) * PAGE_SIZE, p * PAGE_SIZE), total: matched.length };
    }

    // No compliance filter: paginate first, then attach the indicator only to the page rows.
    const total = narrowed.length;
    const pageCustomers = narrowed.slice((p - 1) * PAGE_SIZE, p * PAGE_SIZE);
    const items: CustomerRow[] = [];
    for (const customer of pageCustomers) {
      const compliance = await this.evaluateCompliance(customer, scopedEntries, filters.audience);
      items.push(toRow(customer, compliance));
    }
    return { items, total };
  }

  /** Current published version per document, optionally narrowed to a single document type. */
  private async scopedCurrentVersions(
    documents: AgreementDocument[],
    documentType?: string,
  ): Promise<CurrentVersionEntry[]> {
    const now = this.clock.now();
    const entries: CurrentVersionEntry[] = [];
    for (const document of documents) {
      if (documentType && document.type !== documentType) {
        continue;
      }
      const version = await this.versions.findCurrentPublished(document.type, document.audience, now);
      if (version) {
        entries.push({ document, version });
      }
    }
    return entries;
  }

  private async evaluateCompliance(
    customer: Customer,
    scopedEntries: CurrentVersionEntry[],
    audience?: string,
  ): Promise<ComplianceResult> {
    const states = await this.states.findByCustomer(customer.id);
    return computeCompliance(customer, scopedEntries, states, audience);
  }

  private matchesCompliance(filter: ComplianceFilter, compliance: ComplianceResult): boolean {
    const details = Object.values(compliance.details);
    switch (filter) {
      case 'non_compliant':
        return !compliance.compliant;
      case 'blocked':
        return details.some((d) => d.state === 'EXPIRED_BLOCKING');
      case 'objected':
        return details.some((d) => d.state === 'OBJECTED');
      case 'pending':
        return details.some((d) => d.state !== undefined && OUTSTANDING_PENDING.includes(d.state));
      case 'compliant':
        // "Clean": the gate is open AND nothing is outstanding (all relevant docs accepted / none).
        return compliance.compliant && details.every((d) => d.state === undefined || d.state === 'ACCEPTED');
    }
  }

  /** Single customer by id (for the detail page header). Unknown id → CUSTOMER_NOT_FOUND. */
  async get(id: string): Promise<CustomerRow> {
    const customer = await this.customers.findById(id);
    if (!customer) {
      throw new DomainError('CUSTOMER_NOT_FOUND', `Customer ${id} not found`);
    }
    return toRow(customer);
  }

  async create(input: CreateCustomerInput, actor: Actor, source: CustomerCreateSource = 'admin'): Promise<CreateCustomerResult> {
    if (!input.externalRef || input.externalRef.trim() === '') {
      throw new DomainError('INVALID_STATE', 'externalRef is required');
    }
    await this.assertRolesKnown(input.roles);
    this.assertEmailsValid(input.contactEmails);
    await this.assertExternalRefUniqueForRoles(input.externalRef, input.roles);
    // Validate ALL imports before persisting anything (atomicity: no half-created customer).
    const validated = await this.validateImports(input.acceptedVersions ?? [], input.roles);
    // #29: resolve documents accepted by type at the signing date, then merge (deduping by
    // versionId against the explicit imports so a version is never imported twice).
    const fromSigned = await this.resolveSignedDocuments(input.signedDocuments, input.roles);
    const seenVersionIds = new Set(validated.map((item) => item.version.id));
    for (const item of fromSigned) {
      if (!seenVersionIds.has(item.version.id)) {
        seenVersionIds.add(item.version.id);
        validated.push(item);
      }
    }

    const saved = await this.customers.save({
      id: newId('c'),
      externalRef: input.externalRef,
      firstName: input.firstName ?? '',
      lastName: input.lastName ?? '',
      companyName: input.companyName?.trim() ? input.companyName : undefined,
      roles: input.roles,
      contactEmails: input.contactEmails,
      source: input.source?.trim() ? input.source : 'manual',
    });

    const importedAcceptances: ImportedAcceptance[] = [];
    for (const item of validated) {
      importedAcceptances.push(await this.importAcceptance(saved.id, item, actor));
    }

    // Onboarding rollout AFTER the imports: an imported acceptance of the CURRENT version keeps
    // its ACCEPTED state (and gets no notification); an import of an OLD (retired) version leaves
    // the current version without a state, so it becomes PENDING_NOTIFICATION here and the
    // customer is immediately asked (state + notification mail) to accept the current revision.
    // Integration-triggered onboarding is a SYSTEM action; admin-triggered is ADMIN.
    const rolloutStates = await this.rolloutCurrentVersions(saved, saved.roles, {
      actorKind: source === 'integration' ? 'SYSTEM' : 'ADMIN',
      actorLabel: actor.userId,
    });

    await this.audit.append({
      id: newId('audit'),
      action: 'CUSTOMER_CREATE',
      actor: actor.userId,
      targetType: 'Customer',
      targetId: saved.id,
      metadata: {
        source,
        externalRef: saved.externalRef,
        importedAcceptances: importedAcceptances.length,
        rolloutStates,
      },
      createdAt: this.clock.now(),
    });

    await this.recorder?.record({
      type: 'CUSTOMER_CREATED',
      category: 'ADMINISTRATION',
      // Integration-triggered onboarding (incl. the customer sync) is a SYSTEM action; admin is ADMIN.
      actorKind: source === 'integration' ? 'SYSTEM' : 'ADMIN',
      actorLabel: actor.userId,
      customerId: saved.id,
      customerName: customerDisplayName(saved),
      summary: `Customer ${customerDisplayName(saved)} created`,
      metadata: { source, externalRef: saved.externalRef, roles: saved.roles },
    });

    return { ...toRow(saved), importedAcceptances };
  }

  async update(
    id: string,
    input: UpdateCustomerInput,
    actor: Actor,
    source: CustomerCreateSource = 'admin',
  ): Promise<CustomerRow> {
    const existing = await this.customers.findById(id);
    if (!existing) {
      throw new DomainError('CUSTOMER_NOT_FOUND', `Customer ${id} not found`);
    }
    // A soft-deleted customer must never silently reappear in the active list via a normal edit.
    // Reactivation is exclusively the inbound integration API's job (a subsequent upsert of the
    // same external ref) — see reactivateByExternalRef.
    if (existing.deletedAt !== undefined) {
      throw new DomainError('INVALID_STATE', `Customer ${id} is deleted and cannot be modified`);
    }
    if (input.roles !== undefined) {
      await this.assertRolesKnown(input.roles);
      // Changing roles may create an overlapping duplicate with another customer that shares this
      // externalRef (e.g. adding role "customer" to a partner record while a customer record with
      // the same externalRef exists).
      await this.assertExternalRefUniqueForRoles(existing.externalRef, input.roles, existing.id);
    }
    if (input.contactEmails !== undefined) {
      this.assertEmailsValid(input.contactEmails);
    }
    const updated = await this.customers.save({
      ...existing,
      ...(input.firstName !== undefined ? { firstName: input.firstName } : {}),
      ...(input.lastName !== undefined ? { lastName: input.lastName } : {}),
      ...(input.companyName !== undefined
        ? { companyName: input.companyName.trim() ? input.companyName : undefined }
        : {}),
      ...(input.roles !== undefined ? { roles: input.roles } : {}),
      ...(input.contactEmails !== undefined ? { contactEmails: input.contactEmails } : {}),
    });

    // Onboarding rollout for ADDED roles: the customer is asked to accept the current published
    // versions of the new audience right away (pending-agreements/hosted page pick them up, and a
    // notification mail per newly rolled-out version is sent — versions of the existing roles
    // already had their rollout and are NOT re-notified).
    const addedRoles = input.roles !== undefined ? input.roles.filter((role) => !existing.roles.includes(role)) : [];
    const rolloutStates =
      addedRoles.length > 0
        ? await this.rolloutCurrentVersions(updated, addedRoles, { actorKind: 'ADMIN', actorLabel: actor.userId })
        : 0;

    await this.audit.append({
      id: newId('audit'),
      action: 'CUSTOMER_UPDATE',
      actor: actor.userId,
      targetType: 'Customer',
      targetId: id,
      metadata: {
        firstName: updated.firstName,
        lastName: updated.lastName,
        companyName: updated.companyName ?? '',
        roles: updated.roles,
        contactEmails: updated.contactEmails,
        rolloutStates,
      },
      createdAt: this.clock.now(),
    });

    await this.recorder?.record({
      type: 'CUSTOMER_UPDATED',
      category: 'ADMINISTRATION',
      actorKind: source === 'integration' ? 'SYSTEM' : 'ADMIN',
      actorLabel: actor.userId,
      customerId: updated.id,
      customerName: customerDisplayName(updated),
      summary: `Customer ${customerDisplayName(updated)} updated`,
      metadata: { roles: updated.roles },
    });
    return toRow(updated);
  }

  /**
   * Idempotent inbound upsert keyed by (`externalRef`, `audience`) — the write side of the inbound
   * integration API through which an upstream system PUSHES its
   * customers into clickwrap (clickwrap never pulls). An `externalRef` is only unique
   * in combination with an audience, so the target is resolved by ROLE OVERLAP, never by `source`:
   *  - no overlapping match (INCLUDING soft-deleted) → CREATE (source-tagged) via {@link create} → CUSTOMER_CREATED
   *  - overlapping match, soft-deleted → REACTIVATE (clear deletedAt) + apply the identity fields → CUSTOMER_UPDATED
   *  - overlapping match, active, something changed → UPDATE the changed fields via {@link update} → CUSTOMER_UPDATED
   *  - overlapping match, active, nothing changed → NO write, NO event (idempotent)
   *
   * All writes are SYSTEM-attributed (`source: 'integration'`), like the sync. Roles are validated
   * against the known audiences and contact e-mails against the e-mail pattern. `source` is stored
   * as a provenance tag on create only. Returns the customer row in every case.
   */
  async upsertByExternalRef(input: UpsertByExternalRefInput, actor: Actor): Promise<CustomerRow> {
    if (!input.externalRef || input.externalRef.trim() === '') {
      throw new DomainError('INVALID_STATE', 'externalRef is required');
    }
    await this.assertRolesKnown(input.roles);
    this.assertEmailsValid(input.contactEmails);
    const source = input.source?.trim() ? input.source : DEFAULT_INBOUND_SOURCE;

    // Resolve by (externalRef, audience): among all customers carrying this externalRef (INCLUDING
    // soft-deleted, so a merged-away record is reactivated rather than duplicated), the one whose
    // roles overlap the pushed roles. By overlap-aware uniqueness there is at most one.
    const existing = await this.resolveByExternalRefAndRoles(input.externalRef, input.roles);

    if (existing === undefined) {
      const created = await this.create(
        {
          externalRef: input.externalRef,
          firstName: input.firstName,
          lastName: input.lastName,
          companyName: input.companyName,
          roles: input.roles,
          contactEmails: input.contactEmails,
          source,
        },
        actor,
        'integration',
      );
      // Drop the create-only importedAcceptances field — the upsert contract returns a plain row.
      const { importedAcceptances: _ignored, ...row } = created;
      return row;
    }

    if (existing.deletedAt !== undefined) {
      return this.reactivateByExternalRef(existing, input, actor);
    }

    const changes = this.diffInbound(existing, input);
    if (Object.keys(changes).length === 0) {
      return toRow(existing); // idempotent: nothing changed → no write, no event
    }
    return this.update(existing.id, changes, actor, 'integration');
  }

  /**
   * Idempotent inbound deactivate keyed by (`externalRef`, `audience`) — used when an upstream
   * account is merged away. Resolves the ACTIVE customer carrying `externalRef` whose roles
   * include `audience`, then soft-deletes it (preserving its evidence chain) → CUSTOMER_DELETED.
   * A different-audience customer sharing the same
   * `externalRef` is left untouched. Not found (unknown externalRef/audience) or already
   * soft-deleted → idempotent no-op (no write, no event).
   */
  async deactivateByExternalRef(externalRef: string, audience: string, actor: Actor): Promise<void> {
    const matches = await this.customers.findAllByExternalRef(externalRef);
    const existing = matches.find((c) => c.deletedAt === undefined && c.roles.includes(audience));
    if (existing === undefined) {
      return; // idempotent no-op
    }
    await this.customers.softDelete(existing.id, this.clock.now());
    await this.recorder?.record({
      type: 'CUSTOMER_DELETED',
      category: 'ADMINISTRATION',
      actorKind: 'SYSTEM',
      actorLabel: actor.userId,
      customerId: existing.id,
      customerName: customerDisplayName(existing),
      summary: `Customer ${customerDisplayName(existing)} deactivated (removed for audience ${audience})`,
      metadata: { audience, externalRef: existing.externalRef },
    });
  }

  /**
   * Resolves the inbound target by (`externalRef`, `audience`): the customer carrying `externalRef`
   * whose roles OVERLAP `roles` (INCLUDING soft-deleted). The overlap-aware uniqueness rule
   * guarantees at most one such record. Returns undefined when none overlaps (a fresh create) — or
   * when `roles` is empty, which cannot overlap anything.
   */
  private async resolveByExternalRefAndRoles(externalRef: string, roles: string[]): Promise<Customer | undefined> {
    const roleSet = new Set(roles);
    const matches = await this.customers.findAllByExternalRef(externalRef);
    return matches.find((c) => c.roles.some((role) => roleSet.has(role)));
  }

  /**
   * Reactivates a soft-deleted inbound customer: clears deletedAt and applies the pushed identity
   * fields in one save (open states persisted before the soft-delete are untouched), then records
   * CUSTOMER_UPDATED. A role change is validated for
   * overlap-aware uniqueness first, exactly like {@link update}.
   */
  private async reactivateByExternalRef(
    existing: Customer,
    input: UpsertByExternalRefInput,
    actor: Actor,
  ): Promise<CustomerRow> {
    await this.assertExternalRefUniqueForRoles(existing.externalRef, input.roles, existing.id);
    const reactivated = await this.customers.save({
      ...existing,
      deletedAt: undefined,
      firstName: input.firstName ?? '',
      lastName: input.lastName ?? '',
      companyName: input.companyName?.trim() ? input.companyName : undefined,
      contactEmails: input.contactEmails,
      roles: input.roles,
    });
    await this.recorder?.record({
      type: 'CUSTOMER_UPDATED',
      category: 'ADMINISTRATION',
      actorKind: 'SYSTEM',
      actorLabel: actor.userId,
      customerId: reactivated.id,
      customerName: customerDisplayName(reactivated),
      summary: `Customer ${customerDisplayName(reactivated)} reactivated (re-pushed to source ${reactivated.source})`,
      metadata: { source: reactivated.source, externalRef: reactivated.externalRef, reactivated: true },
    });
    return toRow(reactivated);
  }

  /**
   * Diff the five inbound-owned identity fields against the stored customer. A PUT is a full
   * representation: omitted optional fields are normalised to their defaults, so re-sending the
   * same payload produces an empty diff (idempotency). Roles and e-mails are compared
   * order-insensitively so a mere reordering never triggers a spurious update.
   */
  private diffInbound(existing: Customer, input: UpsertByExternalRefInput): UpdateCustomerInput {
    const changes: UpdateCustomerInput = {};
    const firstName = input.firstName ?? '';
    const lastName = input.lastName ?? '';
    const companyName = input.companyName?.trim() ? input.companyName : undefined;
    if (firstName !== existing.firstName) changes.firstName = firstName;
    if (lastName !== existing.lastName) changes.lastName = lastName;
    if (companyName !== existing.companyName) changes.companyName = companyName ?? '';
    if (!sameStringSet(input.contactEmails, existing.contactEmails)) changes.contactEmails = input.contactEmails;
    if (!sameStringSet(input.roles, existing.roles)) changes.roles = input.roles;
    return changes;
  }

  /**
   * Onboarding rollout — the per-customer counterpart of PublishService.publish step 5+6: one
   * PENDING_NOTIFICATION state per current published version whose audience is covered by
   * `roles` — plus one per UPCOMING published version (validFrom in the future; all of them, not
   * just the next), so the new customer can accept every scheduled revision in advance exactly
   * like existing customers.
   * Versions that already have a state (e.g. just-imported ACCEPTED ones) are skipped — no state,
   * no mail. Every created state triggers an acceptance-notification e-mail through the same
   * RolloutNotifier publish uses (template per document type, permanent acceptance link).
   * carryOverBlocking is irrelevant here (no predecessor state for this customer); the deadline
   * still starts with the first provable access, never with the plain send.
   * Returns the number of created states (audit metadata).
   */
  private async rolloutCurrentVersions(
    customer: Customer,
    roles: string[],
    trigger: { actorKind: EventActorKind; actorLabel: string },
  ): Promise<number> {
    const now = this.clock.now();
    const rolledOut: AgreementVersion[] = [];
    for (const document of await this.documents.findAll()) {
      if (!roles.includes(document.audience)) {
        continue;
      }
      const rolloutVersions = [
        await this.versions.findCurrentPublished(document.type, document.audience, now),
        ...(await this.versions.findUpcomingPublishedList(document.type, document.audience, now)),
      ];
      for (const version of rolloutVersions) {
        if (!version || (await this.states.findByCustomerAndVersion(customer.id, version.id))) {
          continue;
        }
        await this.states.save({
          id: newId('cvs'),
          customerId: customer.id,
          versionId: version.id,
          state: 'PENDING_NOTIFICATION',
          // ACTIVE: absolute hard deadline stamped at rollout; PASSIVE: undefined (starts at access).
          deadlineAt: rolloutDeadlineFor(version),
          remindersSent: 0,
        });
        // Authoritative "customer put under obligation" record — one per created state. Crucial
        // for customers with NO contact e-mail (no EMAIL_SENT fires for them below).
        await this.recorder?.record({
          type: 'OBLIGATION_ROLLED_OUT',
          category: 'CONSENT',
          actorKind: trigger.actorKind,
          actorLabel: trigger.actorLabel,
          customerId: customer.id,
          customerName: customerDisplayName(customer),
          versionId: version.id,
          documentType: document.type,
          audience: document.audience,
          versionLabel: version.versionLabel,
          summary: `Customer put under obligation for version ${version.versionLabel}`,
        });
        rolledOut.push(version);
      }
    }
    await this.notifyRolledOut(customer, rolledOut);
    return rolledOut.length;
  }

  /**
   * Acceptance notifications for the onboarding rollout. A customer without contact e-mails is
   * skipped with a single warn log — the states stay PENDING_NOTIFICATION and the customer shows
   * up in the escalation report as unreachable. A notifier failure must never fail the customer
   * create/update (customer + states are already persisted), so every version is attempted
   * independently and failures are only logged.
   */
  private async notifyRolledOut(customer: Customer, versions: AgreementVersion[]): Promise<void> {
    if (versions.length === 0) {
      return;
    }
    if (customer.contactEmails.length === 0) {
      this.logger.warn(
        `Customer ${customer.id} has no contact e-mails — skipping ${versions.length} onboarding rollout ` +
          'notification(s); the customer appears in the escalation report as unreachable',
      );
      return;
    }
    for (const version of versions) {
      try {
        await this.notifier.notifyVersionPublished(customer, version);
      } catch (err) {
        this.logger.error(
          `Onboarding rollout notification failed for customer ${customer.id}, version ${version.id}`,
          err instanceof Error ? err.stack : String(err),
        );
      }
    }
  }

  /**
   * externalRef uniqueness is OVERLAP-AWARE, not global: the external ID spaces of partners and
   * customers are separate, so the same externalRef may legitimately appear on entities with
   * disjoint roles (e.g. a partner record and a customer record). We reject only if another
   * customer already carries this externalRef AND shares at least one audience key (role) with the
   * given `roles` — that would be an ambiguous duplicate within a single audience space.
   *
   * `excludeId` skips the customer being updated (self) on PATCH. This is an app-level check: a
   * Postgres unique index cannot express "unique per overlapping array element", so a concurrent
   * create/update could in theory race it. Acceptable — customer onboarding is a low-frequency
   * admin/integration operation (same reasoning as AudienceRepo.deleteIfUnused, see PERSISTENCE.md).
   */
  private async assertExternalRefUniqueForRoles(externalRef: string, roles: string[], excludeId?: string): Promise<void> {
    const roleSet = new Set(roles);
    const matches = await this.customers.findAllByExternalRef(externalRef);
    const conflict = matches.find((c) => c.id !== excludeId && c.roles.some((role) => roleSet.has(role)));
    if (conflict) {
      throw new DomainError(
        'INVALID_STATE',
        `A customer with externalRef "${externalRef}" and an overlapping role already exists`,
      );
    }
  }

  private async assertRolesKnown(roles: string[]): Promise<void> {
    for (const role of roles) {
      if (!(await this.audiences.findByKey(role))) {
        throw new DomainError('UNKNOWN_AUDIENCE', `Unknown audience: ${role}`);
      }
    }
  }

  private assertEmailsValid(emails: string[]): void {
    for (const email of emails) {
      if (!EMAIL_PATTERN.test(email)) {
        throw new DomainError('INVALID_STATE', `Invalid contact e-mail: ${email}`);
      }
    }
  }

  private async validateImports(imports: AcceptedVersionImport[], roles: string[]): Promise<ValidatedImport[]> {
    const seen = new Set<string>();
    const validated: ValidatedImport[] = [];
    for (const entry of imports) {
      if (seen.has(entry.versionId)) {
        throw new DomainError('INVALID_STATE', `Duplicate versionId in acceptedVersions: ${entry.versionId}`);
      }
      seen.add(entry.versionId);
      const version = await this.versions.findById(entry.versionId);
      if (!version) {
        throw new DomainError('VERSION_NOT_FOUND');
      }
      if (version.status !== 'PUBLISHED' && version.status !== 'RETIRED') {
        throw new DomainError('INVALID_STATE', `Version ${version.id} is ${version.status} — only PUBLISHED/RETIRED can be imported`);
      }
      const document = await this.documents.findById(version.documentId);
      if (!document) {
        throw new DomainError('INVALID_STATE', `Document ${version.documentId} does not exist`);
      }
      if (!roles.includes(document.audience)) {
        throw new DomainError('ROLE_MISMATCH', `Customer roles do not cover audience ${document.audience}`);
      }
      validated.push({
        version,
        acceptedAt: entry.acceptedAt ? new Date(entry.acceptedAt) : this.clock.now(),
        reference: entry.reference,
      });
    }
    return validated;
  }

  /**
   * #29: turn a `signedDocuments` block (signing date + document types) into ValidatedImports. For
   * each requested type, across the audiences the customer's roles cover, resolve the version that
   * was effective at the signing date. A type that resolves to no version for ANY of the roles is a
   * caller error (UNKNOWN_DOCUMENT_TYPE / nothing effective yet) → surfaced, not silently skipped.
   */
  private async resolveSignedDocuments(
    signed: CreateCustomerInput['signedDocuments'],
    roles: string[],
  ): Promise<ValidatedImport[]> {
    if (!signed) {
      return [];
    }
    const effectiveDate = new Date(signed.effectiveDate);
    if (Number.isNaN(effectiveDate.getTime())) {
      throw new DomainError('INVALID_STATE', `Invalid signedDocuments.effectiveDate: ${String(signed.effectiveDate)}`);
    }
    const resolved: ValidatedImport[] = [];
    const seen = new Set<string>();
    for (const rawType of signed.documentTypes) {
      const type = rawType.trim();
      let matchedAnyDocument = false;
      let acceptedForType = false;
      for (const audience of roles) {
        const version = await this.resolveEffectiveVersionAt(type, audience, effectiveDate);
        if (version === undefined) {
          continue;
        }
        matchedAnyDocument = true;
        if (version === null) {
          continue; // document exists for this audience, but nothing was effective at the date
        }
        if (!seen.has(version.id)) {
          seen.add(version.id);
          resolved.push({ version, acceptedAt: effectiveDate, reference: signed.reference });
        }
        acceptedForType = true;
      }
      if (!matchedAnyDocument) {
        throw new DomainError(
          'UNKNOWN_DOCUMENT_TYPE',
          `No document of type "${type}" exists for the customer's roles (${roles.join(', ')})`,
        );
      }
      if (!acceptedForType) {
        throw new DomainError(
          'INVALID_STATE',
          `No version of document type "${type}" was effective at ${effectiveDate.toISOString()} for the customer's roles`,
        );
      }
    }
    return resolved;
  }

  /**
   * The version of (type, audience) that was in force at `date`: the newest PUBLISHED/RETIRED
   * version whose validFrom AND publishedAt are <= date. Unlike AgreementVersionRepo.findCurrentPublished
   * this also considers now-RETIRED versions, so a backdated signing date resolves to the revision
   * that was actually current then. Returns `undefined` when no such document exists for the
   * audience, `null` when the document exists but nothing was effective yet at `date`.
   */
  private async resolveEffectiveVersionAt(
    type: string,
    audience: string,
    date: Date,
  ): Promise<AgreementVersion | null | undefined> {
    const document = await this.documents.findByTypeAndAudience(type, audience);
    if (!document) {
      return undefined;
    }
    const versions = await this.versions.findByDocument(document.id);
    const eligible = versions.filter(
      (v) =>
        (v.status === 'PUBLISHED' || v.status === 'RETIRED') &&
        v.publishedAt !== undefined &&
        v.publishedAt.getTime() <= date.getTime() &&
        v.validFrom.getTime() <= date.getTime(),
    );
    if (eligible.length === 0) {
      return null;
    }
    // In force = greatest validFrom (tie-break: greatest publishedAt).
    eligible.sort(
      (a, b) =>
        b.validFrom.getTime() - a.validFrom.getTime() ||
        (b.publishedAt as Date).getTime() - (a.publishedAt as Date).getTime(),
    );
    return eligible[0];
  }

  private async importAcceptance(customerId: string, item: ValidatedImport, actor: Actor): Promise<ImportedAcceptance> {
    // Signed offer = immediate ACCEPTED; no notification/deadline needed.
    await this.states.save({
      id: newId('cvs'),
      customerId,
      versionId: item.version.id,
      state: 'ACCEPTED',
      remindersSent: 0,
    });
    const saved = await this.acceptances.append({
      id: newId('a'),
      customerId,
      versionId: item.version.id,
      method: 'IMPORT',
      channel: 'ADMIN',
      acceptedAt: item.acceptedAt,
      actor,
      isEffective: true,
      contentHash: item.version.contentHash,
      evidenceNote: item.reference,
    });

    // Out-of-band import: SYSTEM actor kind (bulk onboarding), CONSENT category, method in metadata.
    await this.recorder?.record({
      type: 'VERSION_ACCEPTED',
      category: 'CONSENT',
      actorKind: 'SYSTEM',
      actorLabel: actor.userId,
      customerId,
      versionId: item.version.id,
      versionLabel: item.version.versionLabel,
      channel: 'ADMIN',
      summary: `Version ${item.version.versionLabel} accepted (IMPORT, ADMIN)`,
      metadata: {
        method: 'IMPORT',
        ...(item.reference !== undefined ? { evidenceNote: item.reference } : {}),
      },
    });
    return { versionId: item.version.id, acceptanceId: saved.id };
  }
}

/**
 * Row-narrowing predicate for the customer list. "Assigned" means the customer's role matches a
 * document's audience (a document is `{type, audience, name}`; a customer's `roles` are audience
 * keys — see `computeCompliance`). Applied BEFORE the compliance filter and pagination.
 *
 * - Neither `audience` nor `documentType` set → no narrowing (keep the customer).
 * - `audience=A` → keep only customers whose `roles` include `A` (role-based; a document need NOT
 *   exist for that audience — the admin's explicit choice).
 * - `documentType=T` → keep only customers who have a document of type `T` assigned: ∃ document `D`
 *   with `D.type === T` and `D.audience ∈ roles`.
 * - Both → intersection: role `A` present AND ∃ type-`T` document whose audience is `A`.
 *
 * An unknown documentType/audience matches no document/role, so the customer is dropped (lenient).
 */
const matchesAssignment = (
  customer: Customer,
  documents: readonly AgreementDocument[],
  { audience, documentType }: CustomerListFilters,
): boolean => {
  if (audience && !customer.roles.includes(audience)) {
    return false;
  }
  if (documentType) {
    const hasAssignedDoc = documents.some(
      (d) =>
        d.type === documentType &&
        customer.roles.includes(d.audience) &&
        (!audience || d.audience === audience),
    );
    if (!hasAssignedDoc) {
      return false;
    }
  }
  return true;
};

const toRow = (customer: Customer, compliance?: ComplianceResult): CustomerRow => ({
  id: customer.id,
  externalRef: customer.externalRef,
  firstName: customer.firstName ?? '',
  lastName: customer.lastName ?? '',
  companyName: customer.companyName?.trim() ? customer.companyName : undefined,
  roles: [...customer.roles],
  contactEmails: [...customer.contactEmails],
  // Only present on a soft-deleted (sync-removed) customer — surfaced on the detail page so the UI
  // can badge it. Active customers carry no deletedAt key.
  ...(customer.deletedAt ? { deletedAt: customer.deletedAt } : {}),
  ...(compliance
    ? { compliant: compliance.compliant, complianceStatus: summarizeCompliance(compliance) }
    : {}),
});

/** Order-insensitive comparison of two string collections (roles / e-mails) so reordering is a no-op. */
const sameStringSet = (a: readonly string[], b: readonly string[]): boolean => {
  if (a.length !== b.length) return false;
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  return sortedA.every((value, index) => value === sortedB[index]);
};

/** Worst outstanding status wins: blocked (gate closed) > objected > pending > compliant. */
const summarizeCompliance = (compliance: ComplianceResult): CustomerComplianceStatus => {
  const details = Object.values(compliance.details);
  if (!compliance.compliant) {
    return 'blocked';
  }
  if (details.some((d) => d.state === 'OBJECTED')) {
    return 'objected';
  }
  if (details.some((d) => d.state !== undefined && OUTSTANDING_PENDING.includes(d.state))) {
    return 'pending';
  }
  return 'compliant';
};

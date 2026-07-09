import { Inject, Injectable, Logger } from '@nestjs/common';
import { ADMIN_AUDIT_TOKEN, type AdminAuditRepo } from '../agreements/audit';
import { newId } from '../agreements/ids';
import { AGREEMENTS_TOKENS, type RolloutNotifier } from '../agreements/ports';
import type { Actor } from '../common/auth/actor';
import { DomainError } from '../common/errors';
import type { Clock } from '../domain/clock';
import { computeCompliance, type ComplianceResult, type CurrentVersionEntry } from '../domain/compliance';
import { customerDisplayName } from '../domain/customer';
import type {
  AcceptanceRepo,
  AgreementDocumentRepo,
  AgreementVersionRepo,
  AudienceRepo,
  CustomerRepo,
  CustomerVersionStateRepo,
} from '../domain/ports';
import type { AgreementVersion, Customer, CustomerVersionStateValue } from '../domain/types';
import { TOKENS } from '../persistence/tokens';
import { matchesCustomerSearch } from './customer-search';

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
 * Optional compliance-scoping filters for the customer list. `audience`/`documentType` restrict the
 * compliance evaluation (and thus the per-row indicator) to that audience's documents / that type;
 * an unknown key simply narrows the evaluation to nothing (→ `compliant`, no outstanding docs).
 * `compliance` additionally filters the rows to customers matching that status.
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
  ) {}

  /**
   * Paginated customer list (50/page), sorted by name then externalRef. An optional `search` term
   * is applied FIRST (case-insensitive substring on name / externalRef / contactEmails — see
   * {@link matchesCustomerSearch}). Every row carries a compliance indicator (computed via the pure
   * domain {@link computeCompliance} over the customer's states + the current published versions,
   * optionally scoped by `filters.documentType`/`filters.audience`). When `filters.compliance` is
   * set the rows are additionally filtered to customers matching that status. In all cases the
   * search + compliance filter run BEFORE pagination, so `total` reflects the filtered count.
   */
  async list(page?: number, search?: string, filters: CustomerListFilters = {}): Promise<CustomerListResult> {
    const all = await this.customers.findAll();
    const searched = search ? all.filter((c) => matchesCustomerSearch(c, search)) : all;
    searched.sort((a, b) => {
      const byName = customerDisplayName(a).localeCompare(customerDisplayName(b));
      return byName !== 0 ? byName : a.externalRef.localeCompare(b.externalRef);
    });

    const scopedEntries = await this.scopedCurrentVersions(filters.documentType);
    const p = page && page > 0 ? page : 1;

    if (filters.compliance) {
      // Filter-first: compute compliance for the whole searched set, keep the matching rows, then
      // paginate — `total` must reflect the compliance-filtered count.
      const matched: CustomerRow[] = [];
      for (const customer of searched) {
        const compliance = await this.evaluateCompliance(customer, scopedEntries, filters.audience);
        if (this.matchesCompliance(filters.compliance, compliance)) {
          matched.push(toRow(customer, compliance));
        }
      }
      return { items: matched.slice((p - 1) * PAGE_SIZE, p * PAGE_SIZE), total: matched.length };
    }

    // No compliance filter: paginate first, then attach the indicator only to the page rows.
    const total = searched.length;
    const pageCustomers = searched.slice((p - 1) * PAGE_SIZE, p * PAGE_SIZE);
    const items: CustomerRow[] = [];
    for (const customer of pageCustomers) {
      const compliance = await this.evaluateCompliance(customer, scopedEntries, filters.audience);
      items.push(toRow(customer, compliance));
    }
    return { items, total };
  }

  /** Current published version per document, optionally narrowed to a single document type. */
  private async scopedCurrentVersions(documentType?: string): Promise<CurrentVersionEntry[]> {
    const now = this.clock.now();
    const entries: CurrentVersionEntry[] = [];
    for (const document of await this.documents.findAll()) {
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

    const saved = await this.customers.save({
      id: newId('c'),
      externalRef: input.externalRef,
      firstName: input.firstName ?? '',
      lastName: input.lastName ?? '',
      companyName: input.companyName?.trim() ? input.companyName : undefined,
      roles: input.roles,
      contactEmails: input.contactEmails,
    });

    const importedAcceptances: ImportedAcceptance[] = [];
    for (const item of validated) {
      importedAcceptances.push(await this.importAcceptance(saved.id, item, actor));
    }

    // Onboarding rollout AFTER the imports: an imported acceptance of the CURRENT version keeps
    // its ACCEPTED state (and gets no notification); an import of an OLD (retired) version leaves
    // the current version without a state, so it becomes PENDING_NOTIFICATION here and the
    // customer is immediately asked (state + notification mail) to accept the current revision.
    const rolloutStates = await this.rolloutCurrentVersions(saved, saved.roles);

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

    return { ...toRow(saved), importedAcceptances };
  }

  async update(id: string, input: UpdateCustomerInput, actor: Actor): Promise<CustomerRow> {
    const existing = await this.customers.findById(id);
    if (!existing) {
      throw new DomainError('CUSTOMER_NOT_FOUND', `Customer ${id} not found`);
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
    const rolloutStates = addedRoles.length > 0 ? await this.rolloutCurrentVersions(updated, addedRoles) : 0;

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
    return toRow(updated);
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
  private async rolloutCurrentVersions(customer: Customer, roles: string[]): Promise<number> {
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
          remindersSent: 0,
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
    return { versionId: item.version.id, acceptanceId: saved.id };
  }
}

const toRow = (customer: Customer, compliance?: ComplianceResult): CustomerRow => ({
  id: customer.id,
  externalRef: customer.externalRef,
  firstName: customer.firstName ?? '',
  lastName: customer.lastName ?? '',
  companyName: customer.companyName?.trim() ? customer.companyName : undefined,
  roles: [...customer.roles],
  contactEmails: [...customer.contactEmails],
  ...(compliance
    ? { compliant: compliance.compliant, complianceStatus: summarizeCompliance(compliance) }
    : {}),
});

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

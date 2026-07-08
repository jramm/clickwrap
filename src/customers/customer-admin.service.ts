import { Inject, Injectable } from '@nestjs/common';
import { ADMIN_AUDIT_TOKEN, type AdminAuditRepo } from '../agreements/audit';
import { newId } from '../agreements/ids';
import type { Actor } from '../common/auth/actor';
import { DomainError } from '../common/errors';
import type { Clock } from '../domain/clock';
import type {
  AcceptanceRepo,
  AgreementDocumentRepo,
  AgreementVersionRepo,
  AudienceRepo,
  CustomerRepo,
  CustomerVersionStateRepo,
} from '../domain/ports';
import type { AgreementVersion, Customer } from '../domain/types';
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
  name?: string;
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
  name?: string;
  roles?: string[];
  contactEmails?: string[];
}

export interface CustomerRow {
  id: string;
  externalRef: string;
  name: string;
  roles: string[];
  contactEmails: string[];
}

export interface CustomerListResult {
  items: CustomerRow[];
  total: number;
}

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
 * pending-agreements (popup/hosted page) until the next publish. Unlike publish, no rollout
 * e-mails are sent here (onboarding imports must not trigger mails); deadlines start with the
 * first provable access as usual. Removing a role takes effect on the next publish only.
 */
@Injectable()
export class CustomerAdminService {
  constructor(
    @Inject(TOKENS.CustomerRepo) private readonly customers: CustomerRepo,
    @Inject(TOKENS.AudienceRepo) private readonly audiences: AudienceRepo,
    @Inject(TOKENS.AgreementVersionRepo) private readonly versions: AgreementVersionRepo,
    @Inject(TOKENS.AgreementDocumentRepo) private readonly documents: AgreementDocumentRepo,
    @Inject(TOKENS.CustomerVersionStateRepo) private readonly states: CustomerVersionStateRepo,
    @Inject(TOKENS.AcceptanceRepo) private readonly acceptances: AcceptanceRepo,
    @Inject(ADMIN_AUDIT_TOKEN) private readonly audit: AdminAuditRepo,
    @Inject(TOKENS.Clock) private readonly clock: Clock,
  ) {}

  /**
   * Paginated customer list (50/page), sorted by name then externalRef. An optional `search` term
   * is applied FIRST (case-insensitive substring on name / externalRef / contactEmails — see
   * {@link matchesCustomerSearch}); `total` reflects the filtered count, and pagination runs over
   * the filtered set.
   */
  async list(page?: number, search?: string): Promise<CustomerListResult> {
    const all = await this.customers.findAll();
    const filtered = search ? all.filter((c) => matchesCustomerSearch(c, search)) : all;
    filtered.sort((a, b) => {
      const byName = (a.name ?? '').localeCompare(b.name ?? '');
      return byName !== 0 ? byName : a.externalRef.localeCompare(b.externalRef);
    });
    const total = filtered.length;
    const p = page && page > 0 ? page : 1;
    const items = filtered.slice((p - 1) * PAGE_SIZE, p * PAGE_SIZE).map(toRow);
    return { items, total };
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
      name: input.name ?? '',
      roles: input.roles,
      contactEmails: input.contactEmails,
    });

    const importedAcceptances: ImportedAcceptance[] = [];
    for (const item of validated) {
      importedAcceptances.push(await this.importAcceptance(saved.id, item, actor));
    }

    // Onboarding rollout AFTER the imports: an imported acceptance of the CURRENT version keeps
    // its ACCEPTED state; an import of an OLD (retired) version leaves the current version
    // without a state, so it becomes PENDING_NOTIFICATION here — the customer is immediately
    // asked to accept the current revision.
    const rolloutStates = await this.rolloutCurrentVersions(saved.id, saved.roles);

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
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.roles !== undefined ? { roles: input.roles } : {}),
      ...(input.contactEmails !== undefined ? { contactEmails: input.contactEmails } : {}),
    });

    // Onboarding rollout for ADDED roles: the customer is asked to accept the current published
    // versions of the new audience right away (pending-agreements/hosted page pick them up).
    const addedRoles = input.roles !== undefined ? input.roles.filter((role) => !existing.roles.includes(role)) : [];
    const rolloutStates = addedRoles.length > 0 ? await this.rolloutCurrentVersions(id, addedRoles) : 0;

    await this.audit.append({
      id: newId('audit'),
      action: 'CUSTOMER_UPDATE',
      actor: actor.userId,
      targetType: 'Customer',
      targetId: id,
      metadata: { name: updated.name, roles: updated.roles, contactEmails: updated.contactEmails, rolloutStates },
      createdAt: this.clock.now(),
    });
    return toRow(updated);
  }

  /**
   * Onboarding rollout — the state-creation half of PublishService.publish step 5: one
   * PENDING_NOTIFICATION state per current published version whose audience is covered by
   * `roles` — plus one per UPCOMING published version (validFrom in the future), so the new
   * customer can accept a scheduled revision in advance exactly like existing customers.
   * Versions that already have a state (e.g. just-imported ACCEPTED ones) are skipped.
   * carryOverBlocking is irrelevant here (no predecessor state for this customer) and, unlike
   * publish, no rollout e-mails are sent — the deadline starts with the first provable access.
   * Returns the number of created states (audit metadata).
   */
  private async rolloutCurrentVersions(customerId: string, roles: string[]): Promise<number> {
    const now = this.clock.now();
    let created = 0;
    for (const document of await this.documents.findAll()) {
      if (!roles.includes(document.audience)) {
        continue;
      }
      const rolloutVersions = [
        await this.versions.findCurrentPublished(document.type, document.audience, now),
        await this.versions.findUpcomingPublished(document.type, document.audience, now),
      ];
      for (const version of rolloutVersions) {
        if (!version || (await this.states.findByCustomerAndVersion(customerId, version.id))) {
          continue;
        }
        await this.states.save({
          id: newId('cvs'),
          customerId,
          versionId: version.id,
          state: 'PENDING_NOTIFICATION',
          remindersSent: 0,
        });
        created++;
      }
    }
    return created;
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

const toRow = (customer: Customer): CustomerRow => ({
  id: customer.id,
  externalRef: customer.externalRef,
  name: customer.name ?? '',
  roles: [...customer.roles],
  contactEmails: [...customer.contactEmails],
});

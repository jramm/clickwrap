import { Inject, Injectable, Logger } from '@nestjs/common';
import { customerDisplayName } from '../domain/customer';
import type { Clock } from '../domain/clock';
import type { CustomerRepo } from '../domain/ports';
import type { Customer } from '../domain/types';
import { CustomerAdminService, type UpdateCustomerInput } from '../customers/customer-admin.service';
import { EventRecorder } from '../events/event-recorder';
import type { CustomerSource, ExternalCustomer } from '../plugin-sdk';
import { TOKENS } from '../persistence/tokens';
import { CUSTOMER_SYNC_SYSTEM_ACTOR, CUSTOMER_SYNC_TOKENS, type CustomerSyncConfig } from './ports';

/** Per-run counters — logged and returned for the cron/tests to assert idempotency. */
export interface CustomerSyncResult {
  created: number;
  updated: number;
  reactivated: number;
  deleted: number;
  /** Records that failed and were skipped (per-record isolation) — the run itself still succeeds. */
  errors: number;
}

const ZERO: CustomerSyncResult = { created: 0, updated: 0, reactivated: 0, deleted: 0, errors: 0 };

/**
 * The API-independent reconcile engine of the customer sync.
 *
 * `sync()` fetches the full current snapshot from the active {@link CustomerSource} and reconciles it
 * into clickwrap, scoped strictly to source-managed customers (those tagged with THIS source key —
 * `'manual'` customers are never touched):
 *  - a source customer with no local match  → CREATE (source-tagged, default roles) → CUSTOMER_CREATED
 *  - a source customer matching a soft-deleted local one → REACTIVATE (clear deletedAt + fields) → CUSTOMER_UPDATED
 *  - a source customer matching an active local one → UPDATE only the changed identity fields → CUSTOMER_UPDATED
 *    (no change → no write, no event: idempotent)
 *  - a local source-managed customer absent from the snapshot (or listed in deletedExternalRefs) and
 *    not already soft-deleted → SOFT-DELETE (preserve evidence) → CUSTOMER_DELETED
 *
 * Per-record error isolation (like the deadline sweeper): one bad record is logged and skipped, the
 * run continues. Roles are never touched on update — the sync only owns the identity fields.
 */
@Injectable()
export class CustomerSyncService {
  private readonly logger = new Logger(CustomerSyncService.name);

  constructor(
    @Inject(CUSTOMER_SYNC_TOKENS.CustomerSource) private readonly source: CustomerSource,
    @Inject(CUSTOMER_SYNC_TOKENS.Config) private readonly config: CustomerSyncConfig,
    @Inject(TOKENS.CustomerRepo) private readonly customers: CustomerRepo,
    @Inject(TOKENS.Clock) private readonly clock: Clock,
    private readonly customerAdmin: CustomerAdminService,
    private readonly recorder: EventRecorder,
  ) {}

  async sync(): Promise<CustomerSyncResult> {
    // Safety net: the 'none' source owns nothing, so there is nothing to reconcile (the cron also
    // gates on this). Guarding here keeps a manual/test invocation a no-op too.
    if (this.config.sourceKey === 'none') {
      return { ...ZERO };
    }

    const snapshot = await this.source.fetchAll();
    const local = await this.customers.findBySource(this.config.sourceKey);
    const localByRef = new Map(local.map((c) => [c.externalRef, c]));

    const explicitDeletes = new Set(snapshot.deletedExternalRefs ?? []);
    // Explicit deletion wins over presence in `customers`.
    const active = snapshot.customers.filter((e) => !explicitDeletes.has(e.externalRef));
    const activeRefs = new Set(active.map((e) => e.externalRef));

    const result: CustomerSyncResult = { ...ZERO };

    for (const external of active) {
      try {
        const existing = localByRef.get(external.externalRef);
        if (existing === undefined) {
          await this.createFromSource(external);
          result.created++;
        } else if (existing.deletedAt !== undefined) {
          await this.reactivate(existing, external);
          result.reactivated++;
        } else if (await this.updateChanged(existing, external)) {
          result.updated++;
        }
      } catch (err) {
        result.errors++;
        this.logger.error(
          `Sync failed for source customer "${external.externalRef}"`,
          err instanceof Error ? err.stack : String(err),
        );
      }
    }

    for (const customer of local) {
      if (activeRefs.has(customer.externalRef) || customer.deletedAt !== undefined) {
        continue;
      }
      try {
        await this.softDelete(customer);
        result.deleted++;
      } catch (err) {
        result.errors++;
        this.logger.error(
          `Soft-delete failed for source customer "${customer.externalRef}" (${customer.id})`,
          err instanceof Error ? err.stack : String(err),
        );
      }
    }

    this.logger.log(
      `Customer sync (${this.config.sourceKey}): +${result.created} ~${result.updated} ` +
        `↺${result.reactivated} -${result.deleted} (errors: ${result.errors})`,
    );
    return result;
  }

  private async createFromSource(external: ExternalCustomer): Promise<void> {
    await this.customerAdmin.create(
      {
        externalRef: external.externalRef,
        firstName: external.firstName,
        lastName: external.lastName,
        companyName: external.companyName,
        contactEmails: external.contactEmails,
        roles: this.config.defaultRoles,
        source: this.config.sourceKey,
      },
      CUSTOMER_SYNC_SYSTEM_ACTOR,
      'integration',
    );
  }

  /** Returns true when an update was performed (and a CUSTOMER_UPDATED event emitted). */
  private async updateChanged(existing: Customer, external: ExternalCustomer): Promise<boolean> {
    const changes = this.diffIdentity(existing, external);
    if (Object.keys(changes).length === 0) {
      return false; // idempotent: nothing changed → no write, no event
    }
    await this.customerAdmin.update(existing.id, changes, CUSTOMER_SYNC_SYSTEM_ACTOR, 'integration');
    return true;
  }

  /** Only the four sync-owned identity fields — roles are never touched. */
  private diffIdentity(existing: Customer, external: ExternalCustomer): UpdateCustomerInput {
    const changes: UpdateCustomerInput = {};
    const firstName = external.firstName ?? '';
    const lastName = external.lastName ?? '';
    const companyName = external.companyName?.trim() ? external.companyName : undefined;
    if (firstName !== existing.firstName) changes.firstName = firstName;
    if (lastName !== existing.lastName) changes.lastName = lastName;
    if (companyName !== existing.companyName) changes.companyName = companyName ?? '';
    if (!sameEmails(external.contactEmails, existing.contactEmails)) {
      changes.contactEmails = external.contactEmails;
    }
    return changes;
  }

  private async reactivate(existing: Customer, external: ExternalCustomer): Promise<void> {
    const companyName = external.companyName?.trim() ? external.companyName : undefined;
    const reactivated = await this.customers.save({
      ...existing,
      deletedAt: undefined,
      firstName: external.firstName ?? '',
      lastName: external.lastName ?? '',
      companyName,
      contactEmails: external.contactEmails,
    });
    await this.recorder.record({
      type: 'CUSTOMER_UPDATED',
      category: 'ADMINISTRATION',
      actorKind: 'SYSTEM',
      actorLabel: CUSTOMER_SYNC_SYSTEM_ACTOR.userId,
      customerId: reactivated.id,
      customerName: customerDisplayName(reactivated),
      summary: `Customer ${customerDisplayName(reactivated)} reactivated (reappeared in source ${this.config.sourceKey})`,
      metadata: { source: this.config.sourceKey, externalRef: reactivated.externalRef, reactivated: true },
    });
  }

  private async softDelete(customer: Customer): Promise<void> {
    await this.customers.softDelete(customer.id, this.clock.now());
    await this.recorder.record({
      type: 'CUSTOMER_DELETED',
      category: 'ADMINISTRATION',
      actorKind: 'SYSTEM',
      actorLabel: CUSTOMER_SYNC_SYSTEM_ACTOR.userId,
      customerId: customer.id,
      customerName: customerDisplayName(customer),
      summary: `Customer ${customerDisplayName(customer)} deleted (removed from source ${this.config.sourceKey})`,
      metadata: { source: this.config.sourceKey, externalRef: customer.externalRef },
    });
  }
}

/** Order-insensitive e-mail comparison so a mere reordering never triggers a spurious update. */
const sameEmails = (a: readonly string[], b: readonly string[]): boolean => {
  if (a.length !== b.length) return false;
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  return sortedA.every((value, index) => value === sortedB[index]);
};

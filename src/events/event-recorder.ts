import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { newId } from '../agreements/ids.js';
import type { Clock } from '../domain/clock.js';
import { customerDisplayName } from '../domain/customer.js';
import type { AgreementDocumentRepo, AgreementVersionRepo, CustomerRepo, EventRepo } from '../domain/ports.js';
import type { DomainEvent } from '../domain/types.js';
import { TOKENS } from '../persistence/tokens.js';

/**
 * The caller-supplied part of a {@link DomainEvent}: everything except `id` and `occurredAt`, which
 * the recorder stamps itself (`id = newId('evt')`, `occurredAt = clock.now()` — always server time).
 */
export type RecordEventInput = Omit<DomainEvent, 'id' | 'occurredAt'>;

/**
 * Application service every core service injects to append ONE entry to the core-written, append-only
 * Event table AFTER a successful domain write (dual-write alongside the unchanged evidence/audit
 * stores; see {@link DomainEvent}). Provided globally by the RepositoryModule (both drivers), mirroring
 * how ADMIN_AUDIT_TOKEN is shared — so agreements/consent/admin/plugin modules inject it without a
 * dependency cycle.
 *
 * A recorder failure must NEVER break the business action (which has already succeeded): the append is
 * wrapped so any error is logged (warn) and swallowed — analogous to how the onboarding rollout
 * tolerates notifier failures. Services therefore call {@link record} unconditionally after the write.
 */
@Injectable()
export class EventRecorder {
  private readonly logger = new Logger(EventRecorder.name);

  constructor(
    @Inject(TOKENS.EventRepo) private readonly events: EventRepo,
    @Inject(TOKENS.Clock) private readonly clock: Clock,
    // Optional resolution repos (globally provided by the RepositoryModule): used to centrally
    // denormalize documentType/audience/versionLabel from versionId and customerName from
    // customerId when a caller did not supply them. Optional so the many direct-instantiation
    // unit tests (`new EventRecorder(eventRepo, clock)`) keep working; the resolution simply
    // becomes a no-op when a repo is absent.
    @Optional() @Inject(TOKENS.AgreementVersionRepo) private readonly versions?: AgreementVersionRepo,
    @Optional() @Inject(TOKENS.AgreementDocumentRepo) private readonly documents?: AgreementDocumentRepo,
    @Optional() @Inject(TOKENS.CustomerRepo) private readonly customers?: CustomerRepo,
  ) {}

  async record(input: RecordEventInput): Promise<void> {
    const event: DomainEvent = { ...input, id: newId('evt'), occurredAt: this.clock.now() };
    try {
      // Resolve denormalized fields INSIDE the swallow-guard — a lookup failure must never break
      // the business action (which has already succeeded), exactly like an append failure.
      await this.resolveDenormalized(event);
      await this.events.append(event);
    } catch (err) {
      this.logger.warn(
        `Failed to record ${input.type} event (business action already succeeded): ` +
          (err instanceof Error ? err.message : String(err)),
      );
    }
  }

  /**
   * Fills documentType/audience/versionLabel (from the version + its document) and customerName
   * (from the customer) when the caller supplied the id but not the denormalized value — so every
   * event consistently carries the document type (fixing e.g. EMAIL_SENT, which historically only
   * knew the version). Never overwrites a value the caller already provided.
   */
  private async resolveDenormalized(event: DomainEvent): Promise<void> {
    if (
      event.versionId !== undefined &&
      this.versions !== undefined &&
      (event.documentType === undefined || event.audience === undefined || event.versionLabel === undefined)
    ) {
      const version = await this.versions.findById(event.versionId);
      if (version) {
        event.versionLabel ??= version.versionLabel;
        if ((event.documentType === undefined || event.audience === undefined) && this.documents !== undefined) {
          const document = await this.documents.findById(version.documentId);
          if (document) {
            event.documentType ??= document.type;
            event.audience ??= document.audience;
          }
        }
      }
    }
    if (event.customerId !== undefined && event.customerName === undefined && this.customers !== undefined) {
      const customer = await this.customers.findById(event.customerId);
      if (customer) {
        event.customerName = customerDisplayName(customer);
      }
    }
  }
}

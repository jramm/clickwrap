import { FixedClock } from '../../../domain/clock.js';
import type { AgreementVersionRepo } from '../../../domain/ports.js';
import { aState, aVersion } from '../../../domain/testing/fixtures.js';
import type { AgreementVersion } from '../../../domain/types.js';
import { InMemoryEscalationLog } from '../../../common/escalation/escalation-log.inmemory.js';
import { InMemoryCustomerVersionStateRepo } from '../../../persistence/inmemory/customer-version-state.repo.js';
import { InMemoryNotificationEventRepo } from '../../../persistence/inmemory/notification-event.repo.js';
import { InMemoryEventRepo } from '../../../persistence/inmemory/index.js';
import { EventRecorder } from '../../../events/event-recorder.js';
import { DeliveryEventService } from './delivery-event.service.js';
import type { DeliveryStatus, EmailDeliveryProvider } from './email-delivery-provider.js';
import type { OutboundEmail } from './outbound-email.js';
import { InMemoryOutboundEmailRepo } from './outbound-email.repo.inmemory.js';

/** Minimal fake: DeliveryEventService only needs findById. */
class FakeAgreementVersionRepo implements AgreementVersionRepo {
  private readonly versions = new Map<string, AgreementVersion>();

  seed(version: AgreementVersion): void {
    this.versions.set(version.id, version);
  }

  async findById(id: string) {
    return this.versions.get(id);
  }

  async save(): Promise<AgreementVersion> {
    throw new Error('not implemented');
  }

  async findByDocument(): Promise<AgreementVersion[]> {
    throw new Error('not implemented');
  }

  async findCurrentPublished(): Promise<AgreementVersion | undefined> {
    throw new Error('not implemented');
  }

  async findUpcomingPublishedList(): Promise<AgreementVersion[]> {
    throw new Error('not implemented');
  }

  async delete(): Promise<void> {
    throw new Error('not implemented');
  }
}

/** Fake provider that only supports the polling capability (fetchDeliveryStatus). */
class FakePollingProvider implements EmailDeliveryProvider {
  public readonly checkedRefs: string[] = [];
  private readonly statusByRef = new Map<string, DeliveryStatus>();

  setStatus(providerRef: string, status: DeliveryStatus): void {
    this.statusByRef.set(providerRef, status);
  }

  async send(): Promise<{ providerRef: string }> {
    throw new Error('not implemented');
  }

  async fetchDeliveryStatus(providerRef: string): Promise<DeliveryStatus> {
    this.checkedRefs.push(providerRef);
    return this.statusByRef.get(providerRef) ?? { kind: 'pending' };
  }
}

const T0 = new Date('2026-07-07T09:00:00Z');

const anOutboundEmail = (overrides: Partial<OutboundEmail> = {}): OutboundEmail => ({
  providerRef: 'ref-1',
  customerId: 'c-123',
  versionId: 'v-1',
  recipient: 'max@customer.example',
  sentAt: new Date('2026-07-07T08:00:00Z'),
  ...overrides,
});

describe('DeliveryEventService', () => {
  let outboundEmails: InMemoryOutboundEmailRepo;
  let notificationEvents: InMemoryNotificationEventRepo;
  let states: InMemoryCustomerVersionStateRepo;
  let versions: FakeAgreementVersionRepo;
  let escalationLog: InMemoryEscalationLog;
  let provider: FakePollingProvider;
  let clock: FixedClock;
  let eventRepo: InMemoryEventRepo;
  let service: DeliveryEventService;

  beforeEach(() => {
    outboundEmails = new InMemoryOutboundEmailRepo();
    notificationEvents = new InMemoryNotificationEventRepo();
    states = new InMemoryCustomerVersionStateRepo();
    versions = new FakeAgreementVersionRepo();
    escalationLog = new InMemoryEscalationLog();
    provider = new FakePollingProvider();
    clock = new FixedClock(T0);
    eventRepo = new InMemoryEventRepo();
    service = new DeliveryEventService(
      outboundEmails,
      notificationEvents,
      states,
      versions,
      escalationLog,
      provider,
      clock,
      new EventRecorder(eventRepo, clock),
    );
  });

  describe('DELIVERED event', () => {
    it('known providerRef: records NotificationEvent + sets notifiedAt/deadlineAt atomically', async () => {
      const version = aVersion({ id: 'v-1', objectionPeriodDays: 14 });
      versions.seed(version);
      await outboundEmails.save(anOutboundEmail());
      await states.save(aState({ id: 'cvs-1', customerId: 'c-123', versionId: 'v-1', state: 'PENDING_NOTIFICATION' }));

      await service.handle({ kind: 'DELIVERED', providerRef: 'ref-1', recipient: 'max@customer.example' });

      const events = await notificationEvents.findByState('cvs-1');
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        channel: 'EMAIL',
        recipient: 'max@customer.example',
        providerRef: 'ref-1',
      });
      expect(events[0].occurredAt.toISOString()).toBe(T0.toISOString());

      const state = await states.findById('cvs-1');
      expect(state?.state).toBe('NOTIFIED');
      expect(state?.notifiedAt?.toISOString()).toBe(T0.toISOString());
      expect(state?.deadlineAt?.toISOString()).toBe('2026-07-21T09:00:00.000Z');

      const outboundEmail = await outboundEmails.findByProviderRef('ref-1');
      expect(outboundEmail?.deliveredAt?.toISOString()).toBe(T0.toISOString());
    });

    it('records an EMAIL_DELIVERED event on the first delivery', async () => {
      const version = aVersion({ id: 'v-1', objectionPeriodDays: 14 });
      versions.seed(version);
      await outboundEmails.save(anOutboundEmail());
      await states.save(aState({ id: 'cvs-1', customerId: 'c-123', versionId: 'v-1', state: 'PENDING_NOTIFICATION' }));

      await service.handle({ kind: 'DELIVERED', providerRef: 'ref-1', recipient: 'max@customer.example' });

      const events = await eventRepo.query({});
      expect(events.items[0]).toMatchObject({
        type: 'EMAIL_DELIVERED',
        category: 'COMMUNICATION',
        actorKind: 'SYSTEM',
      });
    });

    it('respects block carry-over (PASSIVE): deadlineAt = notifiedAt when carryOverBlocking is set', async () => {
      const version = aVersion({ id: 'v-1', objectionPeriodDays: 14 });
      versions.seed(version);
      await outboundEmails.save(anOutboundEmail());
      await states.save(
        aState({
          id: 'cvs-1',
          customerId: 'c-123',
          versionId: 'v-1',
          state: 'PENDING_NOTIFICATION',
          carryOverBlocking: true,
        }),
      );

      await service.handle({ kind: 'DELIVERED', providerRef: 'ref-1', recipient: 'max@customer.example' });

      const state = await states.findById('cvs-1');
      expect(state?.deadlineAt?.toISOString()).toBe(T0.toISOString());
    });

    it('unknown providerRef: no-op (review environments may share one provider account)', async () => {
      await expect(
        service.handle({ kind: 'DELIVERED', providerRef: 'unknown-ref', recipient: 'x@customer.example' }),
      ).resolves.toBeUndefined();
      expect(await notificationEvents.findByState('cvs-1')).toHaveLength(0);
    });

    it('delivery on a SUPERSEDED state: no-op — no resurrection to NOTIFIED, no event', async () => {
      const version = aVersion({ id: 'v-1', objectionPeriodDays: 14 });
      versions.seed(version);
      await outboundEmails.save(anOutboundEmail());
      // SUPERSEDED out of PENDING (notifiedAt empty) — exactly the resurrection candidate.
      await states.save(aState({ id: 'cvs-1', customerId: 'c-123', versionId: 'v-1', state: 'SUPERSEDED' }));

      await service.handle({ kind: 'DELIVERED', providerRef: 'ref-1', recipient: 'max@customer.example' });

      const state = await states.findById('cvs-1');
      expect(state?.state).toBe('SUPERSEDED');
      expect(state?.notifiedAt).toBeUndefined();
      expect(await notificationEvents.findByState('cvs-1')).toHaveLength(0);
    });

    it('is idempotent on double delivery — records only one NotificationEvent', async () => {
      const version = aVersion({ id: 'v-1', objectionPeriodDays: 14 });
      versions.seed(version);
      await outboundEmails.save(anOutboundEmail());
      await states.save(aState({ id: 'cvs-1', customerId: 'c-123', versionId: 'v-1', state: 'PENDING_NOTIFICATION' }));

      await service.handle({ kind: 'DELIVERED', providerRef: 'ref-1', recipient: 'max@customer.example' });
      clock.advanceDays(1);
      await service.handle({ kind: 'DELIVERED', providerRef: 'ref-1', recipient: 'max@customer.example' });

      const events = await notificationEvents.findByState('cvs-1');
      expect(events).toHaveLength(1);

      const state = await states.findById('cvs-1');
      expect(state?.notifiedAt?.toISOString()).toBe(T0.toISOString());
      expect(state?.deadlineAt?.toISOString()).toBe('2026-07-21T09:00:00.000Z');
    });
  });

  describe('BOUNCED event', () => {
    it('records an escalation but does not start a deadline', async () => {
      const version = aVersion({ id: 'v-1', objectionPeriodDays: 14 });
      versions.seed(version);
      await outboundEmails.save(anOutboundEmail());
      await states.save(aState({ id: 'cvs-1', customerId: 'c-123', versionId: 'v-1', state: 'PENDING_NOTIFICATION' }));

      await service.handle({
        kind: 'BOUNCED',
        providerRef: 'ref-1',
        recipient: 'max@customer.example',
        meta: { inactivatedRecipient: true },
      });

      const entries = await escalationLog.findAll();
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({
        customerId: 'c-123',
        versionId: 'v-1',
        recipient: 'max@customer.example',
        inactivatedEmail: true,
      });

      const state = await states.findById('cvs-1');
      expect(state?.state).toBe('PENDING_NOTIFICATION');
      expect(state?.notifiedAt).toBeUndefined();
      expect(await notificationEvents.findByState('cvs-1')).toHaveLength(0);
    });

    it('records an EMAIL_BOUNCED event (COMMUNICATION, SYSTEM) with inactivatedEmail metadata', async () => {
      const version = aVersion({ id: 'v-1', objectionPeriodDays: 14 });
      versions.seed(version);
      await outboundEmails.save(anOutboundEmail());
      await states.save(aState({ id: 'cvs-1', customerId: 'c-123', versionId: 'v-1', state: 'PENDING_NOTIFICATION' }));

      await service.handle({
        kind: 'BOUNCED',
        providerRef: 'ref-1',
        recipient: 'max@customer.example',
        meta: { inactivatedRecipient: true },
      });

      const events = await eventRepo.query({});
      expect(events.items).toHaveLength(1);
      expect(events.items[0]).toMatchObject({
        type: 'EMAIL_BOUNCED',
        category: 'COMMUNICATION',
        actorKind: 'SYSTEM',
        customerId: 'c-123',
        versionId: 'v-1',
        recipient: 'max@customer.example',
        summary: 'E-mail bounced (recipient unreachable)',
        metadata: { inactivatedEmail: true },
      });
    });

    it('unknown providerRef: no bounce event (and no escalation)', async () => {
      await service.handle({
        kind: 'BOUNCED',
        providerRef: 'foreign-ref',
        recipient: 'unknown@customer.example',
        meta: { inactivatedRecipient: false },
      });

      expect((await eventRepo.query({})).items).toHaveLength(0);
    });

    it('unknown providerRef: no-op without escalation entry — like the delivery path', async () => {
      // Review environments may share one provider account: foreign bounces must not create orphan
      // escalation entries (symmetry with the delivery path).
      await service.handle({
        kind: 'BOUNCED',
        providerRef: 'foreign-ref',
        recipient: 'unknown@customer.example',
        meta: { inactivatedRecipient: false },
      });

      expect(await escalationLog.findAll()).toHaveLength(0);
    });

    it('empty providerRef: also a no-op (no correlation possible)', async () => {
      await service.handle({ kind: 'BOUNCED', providerRef: '', recipient: 'unknown@customer.example' });

      expect(await escalationLog.findAll()).toHaveLength(0);
    });
  });

  describe('pollPendingDeliveries', () => {
    it('processes delivered, open sends exactly like the delivery webhook', async () => {
      const version = aVersion({ id: 'v-1', objectionPeriodDays: 14 });
      versions.seed(version);
      await outboundEmails.save(anOutboundEmail({ sentAt: new Date('2026-07-06T00:00:00Z') }));
      await states.save(aState({ id: 'cvs-1', customerId: 'c-123', versionId: 'v-1', state: 'PENDING_NOTIFICATION' }));
      provider.setStatus('ref-1', { kind: 'delivered' });

      await service.pollPendingDeliveries(new Date('2026-07-07T00:00:00Z'));

      expect(provider.checkedRefs).toEqual(['ref-1']);
      const state = await states.findById('cvs-1');
      expect(state?.state).toBe('NOTIFIED');
    });

    it('leaves not-yet-delivered sends unchanged', async () => {
      const version = aVersion({ id: 'v-1', objectionPeriodDays: 14 });
      versions.seed(version);
      await outboundEmails.save(anOutboundEmail({ sentAt: new Date('2026-07-06T00:00:00Z') }));
      await states.save(aState({ id: 'cvs-1', customerId: 'c-123', versionId: 'v-1', state: 'PENDING_NOTIFICATION' }));
      provider.setStatus('ref-1', { kind: 'pending' });

      await service.pollPendingDeliveries(new Date('2026-07-07T00:00:00Z'));

      const state = await states.findById('cvs-1');
      expect(state?.state).toBe('PENDING_NOTIFICATION');
    });

    it('ignores sends younger than the cutoff', async () => {
      await outboundEmails.save(anOutboundEmail({ sentAt: new Date('2026-07-07T08:59:00Z') }));

      await service.pollPendingDeliveries(new Date('2026-07-07T00:00:00Z'));

      expect(provider.checkedRefs).toEqual([]);
    });

    it('is a no-op when the provider has no delivery tracking (no fetchDeliveryStatus)', async () => {
      const version = aVersion({ id: 'v-1', objectionPeriodDays: 14 });
      versions.seed(version);
      await outboundEmails.save(anOutboundEmail({ sentAt: new Date('2026-07-06T00:00:00Z') }));
      await states.save(aState({ id: 'cvs-1', customerId: 'c-123', versionId: 'v-1', state: 'PENDING_NOTIFICATION' }));
      const sendOnly: EmailDeliveryProvider = { send: async () => ({ providerRef: 'x' }) };
      const serviceNoTracking = new DeliveryEventService(
        outboundEmails,
        notificationEvents,
        states,
        versions,
        escalationLog,
        sendOnly,
        clock,
      );

      await serviceNoTracking.pollPendingDeliveries(new Date('2026-07-07T00:00:00Z'));

      const state = await states.findById('cvs-1');
      expect(state?.state).toBe('PENDING_NOTIFICATION');
    });
  });
});

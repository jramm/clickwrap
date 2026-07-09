import { FixedClock } from '../domain/clock';
import { defaultEmailTemplates } from '../domain/email-template';
import type { CustomerVersionStateRepo } from '../domain/ports';
import { aCustomer, aDocument, aState, aVersion } from '../domain/testing/fixtures';
import type { AgreementVersion, Customer, CustomerVersionState } from '../domain/types';
import { InMemoryCustomerVersionStateRepo } from '../persistence/inmemory/customer-version-state.repo';
import {
  InMemoryAcceptanceLinkRepo,
  InMemoryAgreementDocumentRepo,
  InMemoryAudienceRepo,
  InMemoryCustomerRepo,
  InMemoryDocumentTypeRepo,
  InMemoryEmailTemplateRepo,
  InMemoryEventRepo,
} from '../persistence/inmemory';
import { EventRecorder } from '../events/event-recorder';
import { AgreementEmailService } from '../plugins/email/core/agreement-email.service';
import { EmailContentService } from '../plugins/email/core/email-content.service';
import type { EmailDeliveryProvider, NotificationConfig, OutboundMail } from '../plugins/email/core/email-delivery-provider';
import { InMemoryOutboundEmailRepo } from '../plugins/email/core/outbound-email.repo.inmemory';
import { PermanentAcceptanceLinkService } from '../plugins/email/core/permanent-acceptance-link.service';
import type { ReminderCandidate, ReminderCandidateRepo, ReminderMailer } from './ports';
import { ReminderService } from './reminder.service';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const T0 = new Date('2026-07-07T09:00:00Z');
const CUSTOMER = aCustomer();
const VERSION = aVersion({ id: 'v-1' });
const RECIPIENT = 'max@customer.example';

/** Fake: reads the state live from the CustomerVersionStateRepo — reflects that a reminder run sees
 * the effect of the previous run (remindersSent) immediately (idempotency across runs). */
class FakeReminderCandidateRepo implements ReminderCandidateRepo {
  constructor(
    private readonly stateRepo: CustomerVersionStateRepo,
    private readonly stateId: string,
    private readonly customer: Customer,
    private readonly version: AgreementVersion,
    private readonly recipient: string,
  ) {}

  async findDue(before: Date): Promise<ReminderCandidate[]> {
    const state = await this.stateRepo.findById(this.stateId);
    if (
      !state ||
      (state.state !== 'NOTIFIED' && state.state !== 'PENDING_NOTIFICATION') ||
      state.deadlineAt === undefined
    ) {
      return [];
    }
    if (state.deadlineAt.getTime() > before.getTime()) {
      return [];
    }
    return [{ state, customer: this.customer, version: this.version, recipient: this.recipient }];
  }
}

class FakeReminderMailer implements ReminderMailer {
  public readonly calls: Array<{ recipient: string; deadlineAt: Date }> = [];

  async sendReminder(_customer: Customer, recipient: string, _version: AgreementVersion, deadlineAt: Date) {
    this.calls.push({ recipient, deadlineAt });
    return { providerRef: `reminder-${this.calls.length}` };
  }
}

const buildService = (stateRepo: CustomerVersionStateRepo, stateId: string, mailer: FakeReminderMailer, now: Date) => {
  const candidateRepo = new FakeReminderCandidateRepo(stateRepo, stateId, CUSTOMER, VERSION, RECIPIENT);
  return new ReminderService(candidateRepo, mailer, stateRepo, new FixedClock(now));
};

describe('ReminderService', () => {
  it('sends the 7-day reminder when the deadline is exactly 7 days away', async () => {
    const stateRepo = new InMemoryCustomerVersionStateRepo();
    const deadlineAt = new Date(T0.getTime() + 7 * MS_PER_DAY);
    await stateRepo.save(aState({ id: 'cvs-1', state: 'NOTIFIED', deadlineAt, remindersSent: 0 }));
    const mailer = new FakeReminderMailer();
    const service = buildService(stateRepo, 'cvs-1', mailer, T0);

    await service.run();

    expect(mailer.calls).toHaveLength(1);
    const state = await stateRepo.findById('cvs-1');
    expect(state?.remindersSent).toBe(1);
  });

  it('sends the 2-day reminder when the 7-day threshold is already used up', async () => {
    const stateRepo = new InMemoryCustomerVersionStateRepo();
    const deadlineAt = new Date(T0.getTime() + 2 * MS_PER_DAY);
    await stateRepo.save(aState({ id: 'cvs-1', state: 'NOTIFIED', deadlineAt, remindersSent: 1 }));
    const mailer = new FakeReminderMailer();
    const service = buildService(stateRepo, 'cvs-1', mailer, T0);

    await service.run();

    expect(mailer.calls).toHaveLength(1);
    const state = await stateRepo.findById('cvs-1');
    expect(state?.remindersSent).toBe(2);
  });

  it('sends no further reminder when both thresholds have already been sent', async () => {
    const stateRepo = new InMemoryCustomerVersionStateRepo();
    const deadlineAt = new Date(T0.getTime() + 1 * MS_PER_DAY);
    await stateRepo.save(aState({ id: 'cvs-1', state: 'NOTIFIED', deadlineAt, remindersSent: 2 }));
    const mailer = new FakeReminderMailer();
    const service = buildService(stateRepo, 'cvs-1', mailer, T0);

    await service.run();

    expect(mailer.calls).toHaveLength(0);
    const state = await stateRepo.findById('cvs-1');
    expect(state?.remindersSent).toBe(2);
  });

  it('catches up missed thresholds in a single run (both reminders at once)', async () => {
    const stateRepo = new InMemoryCustomerVersionStateRepo();
    const deadlineAt = new Date(T0.getTime() + 1 * MS_PER_DAY);
    await stateRepo.save(aState({ id: 'cvs-1', state: 'NOTIFIED', deadlineAt, remindersSent: 0 }));
    const mailer = new FakeReminderMailer();
    const service = buildService(stateRepo, 'cvs-1', mailer, T0);

    await service.run();

    expect(mailer.calls).toHaveLength(2);
    const state = await stateRepo.findById('cvs-1');
    expect(state?.remindersSent).toBe(2);
  });

  it('is idempotent per threshold across multiple runs (same time → no double send)', async () => {
    const stateRepo = new InMemoryCustomerVersionStateRepo();
    const deadlineAt = new Date(T0.getTime() + 7 * MS_PER_DAY);
    await stateRepo.save(aState({ id: 'cvs-1', state: 'NOTIFIED', deadlineAt, remindersSent: 0 }));
    const mailer = new FakeReminderMailer();
    const service = buildService(stateRepo, 'cvs-1', mailer, T0);

    await service.run();
    await service.run();

    expect(mailer.calls).toHaveLength(1);
  });

  it('sends nothing when the deadline is still outside the 7-day threshold', async () => {
    const stateRepo = new InMemoryCustomerVersionStateRepo();
    const deadlineAt = new Date(T0.getTime() + 8 * MS_PER_DAY);
    await stateRepo.save(aState({ id: 'cvs-1', state: 'NOTIFIED', deadlineAt, remindersSent: 0 }));
    const mailer = new FakeReminderMailer();
    const service = buildService(stateRepo, 'cvs-1', mailer, T0);

    await service.run();

    expect(mailer.calls).toHaveLength(0);
  });

  it('automatic reminder emits EMAIL_SENT (SWEEPER ReminderMailer = AgreementEmailService, already instrumented)', async () => {
    // Mirrors the production wiring SWEEPER_TOKENS.ReminderMailer = { useExisting: AgreementEmailService }:
    // sendReminder → sendAndRecord is already instrumented, so no new wiring is needed — just assert it.
    const config: NotificationConfig = {
      appName: 'Clickwrap',
      publicBaseUrl: 'https://clickwrap.example.org',
      acceptanceLinkSecret: 'test-secret',
    };
    const clock = new FixedClock(T0);
    const provider: EmailDeliveryProvider = {
      async send(_mail: OutboundMail) {
        return { providerRef: 'reminder-ref-1' };
      },
    };
    const documents = new InMemoryAgreementDocumentRepo();
    const documentTypes = new InMemoryDocumentTypeRepo(documents);
    const customers = new InMemoryCustomerRepo();
    const audiences = new InMemoryAudienceRepo(documents, customers);
    const templates = new InMemoryEmailTemplateRepo(documentTypes);
    const permanentLinks = new PermanentAcceptanceLinkService(new InMemoryAcceptanceLinkRepo(), clock, config);
    await documents.save(aDocument());
    await documentTypes.save({ id: 'dt-dpa', key: 'dpa', name: 'Data Processing Agreement' });
    await audiences.save({ id: 'aud-customer', key: 'customer', name: 'Customers' });
    for (const t of defaultEmailTemplates(clock)) {
      await templates.save(t);
    }
    const content = new EmailContentService(documents, documentTypes, audiences, templates, clock, config, permanentLinks);
    const events = new InMemoryEventRepo();
    const mailer = new AgreementEmailService(
      provider,
      new InMemoryOutboundEmailRepo(),
      clock,
      content,
      new EventRecorder(events, clock),
    );

    const stateRepo = new InMemoryCustomerVersionStateRepo();
    const deadlineAt = new Date(T0.getTime() + 7 * MS_PER_DAY);
    await stateRepo.save(aState({ id: 'cvs-1', state: 'NOTIFIED', deadlineAt, remindersSent: 0 }));
    const candidateRepo = new FakeReminderCandidateRepo(stateRepo, 'cvs-1', CUSTOMER, VERSION, RECIPIENT);
    const service = new ReminderService(candidateRepo, mailer, stateRepo, clock);

    await service.run();

    const { items } = await events.query({});
    expect(items.filter((e) => e.type === 'EMAIL_SENT')).toHaveLength(1);
    expect(items[0]).toMatchObject({ type: 'EMAIL_SENT', category: 'COMMUNICATION', recipient: RECIPIENT });
  });

  it('race condition: acceptance happens during the mail send → remindersSent update does not reset ACCEPTED', async () => {
    const stateRepo = new InMemoryCustomerVersionStateRepo();
    const deadlineAt = new Date(T0.getTime() + 7 * MS_PER_DAY);
    await stateRepo.save(aState({ id: 'cvs-1', state: 'NOTIFIED', notifiedAt: T0, deadlineAt, remindersSent: 0 }));
    // Mailer that slips an active acceptance in during the send (state → ACCEPTED).
    const mailer = new (class extends FakeReminderMailer {
      override async sendReminder(customer: Customer, recipient: string, version: AgreementVersion, due: Date) {
        const current = await stateRepo.findById('cvs-1');
        await stateRepo.save({ ...(current as CustomerVersionState), state: 'ACCEPTED' });
        return super.sendReminder(customer, recipient, version, due);
      }
    })();
    const service = buildService(stateRepo, 'cvs-1', mailer, T0);

    await service.run();

    const state = await stateRepo.findById('cvs-1');
    expect(state?.state).toBe('ACCEPTED'); // never back to NOTIFIED
  });

  it('reminds a never-accessed PENDING_NOTIFICATION ACTIVE state (hard deadline 7 days out); state stays PENDING, notifiedAt undefined', async () => {
    const stateRepo = new InMemoryCustomerVersionStateRepo();
    const deadlineAt = new Date(T0.getTime() + 7 * MS_PER_DAY);
    await stateRepo.save(aState({ id: 'cvs-1', state: 'PENDING_NOTIFICATION', deadlineAt, remindersSent: 0 }));
    const mailer = new FakeReminderMailer();
    const service = buildService(stateRepo, 'cvs-1', mailer, T0);

    await service.run();

    expect(mailer.calls).toHaveLength(1);
    const state = await stateRepo.findById('cvs-1');
    expect(state?.state).toBe('PENDING_NOTIFICATION'); // reminder is NOT provable access
    expect(state?.notifiedAt).toBeUndefined();
    expect(state?.remindersSent).toBe(1);
  });

  it('reminds a PENDING_NOTIFICATION state at the 2-day threshold once the 7-day one is used up', async () => {
    const stateRepo = new InMemoryCustomerVersionStateRepo();
    const deadlineAt = new Date(T0.getTime() + 2 * MS_PER_DAY);
    await stateRepo.save(aState({ id: 'cvs-1', state: 'PENDING_NOTIFICATION', deadlineAt, remindersSent: 1 }));
    const mailer = new FakeReminderMailer();
    const service = buildService(stateRepo, 'cvs-1', mailer, T0);

    await service.run();

    expect(mailer.calls).toHaveLength(1);
    const state = await stateRepo.findById('cvs-1');
    expect(state?.state).toBe('PENDING_NOTIFICATION');
    expect(state?.notifiedAt).toBeUndefined();
    expect(state?.remindersSent).toBe(2);
  });

  it('catch-up: a short-notice PENDING hard deadline (< 7 days) fires both due thresholds in one pass', async () => {
    const stateRepo = new InMemoryCustomerVersionStateRepo();
    const deadlineAt = new Date(T0.getTime() + 1 * MS_PER_DAY);
    await stateRepo.save(aState({ id: 'cvs-1', state: 'PENDING_NOTIFICATION', deadlineAt, remindersSent: 0 }));
    const mailer = new FakeReminderMailer();
    const service = buildService(stateRepo, 'cvs-1', mailer, T0);

    await service.run();

    expect(mailer.calls).toHaveLength(2);
    const state = await stateRepo.findById('cvs-1');
    expect(state?.state).toBe('PENDING_NOTIFICATION');
    expect(state?.notifiedAt).toBeUndefined();
    expect(state?.remindersSent).toBe(2);
  });

  it('does NOT remind a PASSIVE never-accessed PENDING state (no deadlineAt → nothing to remind toward)', async () => {
    const stateRepo = new InMemoryCustomerVersionStateRepo();
    await stateRepo.save(aState({ id: 'cvs-1', state: 'PENDING_NOTIFICATION', deadlineAt: undefined, remindersSent: 0 }));
    const mailer = new FakeReminderMailer();
    const service = buildService(stateRepo, 'cvs-1', mailer, T0);

    await service.run();

    expect(mailer.calls).toHaveLength(0);
    const state = await stateRepo.findById('cvs-1');
    expect(state?.remindersSent).toBe(0);
  });

  it('concurrency guard: a PENDING candidate that flips to ACCEPTED during the send is not reset, and its counter write no-ops', async () => {
    const stateRepo = new InMemoryCustomerVersionStateRepo();
    const deadlineAt = new Date(T0.getTime() + 7 * MS_PER_DAY);
    await stateRepo.save(aState({ id: 'cvs-1', state: 'PENDING_NOTIFICATION', deadlineAt, remindersSent: 0 }));
    const mailer = new (class extends FakeReminderMailer {
      override async sendReminder(customer: Customer, recipient: string, version: AgreementVersion, due: Date) {
        const current = await stateRepo.findById('cvs-1');
        await stateRepo.save({ ...(current as CustomerVersionState), state: 'ACCEPTED' });
        return super.sendReminder(customer, recipient, version, due);
      }
    })();
    const service = buildService(stateRepo, 'cvs-1', mailer, T0);

    await service.run();

    const state = await stateRepo.findById('cvs-1');
    expect(state?.state).toBe('ACCEPTED'); // never reverted to PENDING_NOTIFICATION
    expect(state?.remindersSent).toBe(0); // conditional write precondition (state=PENDING) not met → no-op
  });

  it('automatic reminder to a never-accessed PENDING ACTIVE customer emits EMAIL_SENT (traceability before the hard deadline)', async () => {
    const config: NotificationConfig = {
      appName: 'Clickwrap',
      publicBaseUrl: 'https://clickwrap.example.org',
      acceptanceLinkSecret: 'test-secret',
    };
    const clock = new FixedClock(T0);
    const provider: EmailDeliveryProvider = {
      async send(_mail: OutboundMail) {
        return { providerRef: 'reminder-ref-pending-1' };
      },
    };
    const documents = new InMemoryAgreementDocumentRepo();
    const documentTypes = new InMemoryDocumentTypeRepo(documents);
    const customers = new InMemoryCustomerRepo();
    const audiences = new InMemoryAudienceRepo(documents, customers);
    const templates = new InMemoryEmailTemplateRepo(documentTypes);
    const permanentLinks = new PermanentAcceptanceLinkService(new InMemoryAcceptanceLinkRepo(), clock, config);
    await documents.save(aDocument());
    await documentTypes.save({ id: 'dt-dpa', key: 'dpa', name: 'Data Processing Agreement' });
    await audiences.save({ id: 'aud-customer', key: 'customer', name: 'Customers' });
    for (const t of defaultEmailTemplates(clock)) {
      await templates.save(t);
    }
    const content = new EmailContentService(documents, documentTypes, audiences, templates, clock, config, permanentLinks);
    const events = new InMemoryEventRepo();
    const mailer = new AgreementEmailService(
      provider,
      new InMemoryOutboundEmailRepo(),
      clock,
      content,
      new EventRecorder(events, clock),
    );

    const stateRepo = new InMemoryCustomerVersionStateRepo();
    const deadlineAt = new Date(T0.getTime() + 7 * MS_PER_DAY);
    await stateRepo.save(aState({ id: 'cvs-1', state: 'PENDING_NOTIFICATION', deadlineAt, remindersSent: 0 }));
    const candidateRepo = new FakeReminderCandidateRepo(stateRepo, 'cvs-1', CUSTOMER, VERSION, RECIPIENT);
    const service = new ReminderService(candidateRepo, mailer, stateRepo, clock);

    await service.run();

    const { items } = await events.query({});
    expect(items.filter((e) => e.type === 'EMAIL_SENT')).toHaveLength(1);
    expect(items[0]).toMatchObject({ type: 'EMAIL_SENT', category: 'COMMUNICATION', recipient: RECIPIENT });
    const state = await stateRepo.findById('cvs-1');
    expect(state?.state).toBe('PENDING_NOTIFICATION');
    expect(state?.notifiedAt).toBeUndefined();
  });
});

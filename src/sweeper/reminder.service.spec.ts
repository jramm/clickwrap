import { FixedClock } from '../domain/clock';
import type { CustomerVersionStateRepo } from '../domain/ports';
import { aCustomer, aState, aVersion } from '../domain/testing/fixtures';
import type { AgreementVersion, Customer, CustomerVersionState } from '../domain/types';
import { InMemoryCustomerVersionStateRepo } from '../persistence/inmemory/customer-version-state.repo';
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
    if (!state || state.state !== 'NOTIFIED' || state.deadlineAt === undefined) {
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
});

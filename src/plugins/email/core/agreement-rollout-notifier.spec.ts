import { aCustomer, aState, aVersion } from '../../../domain/testing/fixtures';
import type { AgreementVersion, Customer } from '../../../domain/types';
import type { AgreementEmailService } from './agreement-email.service';
import { AgreementRolloutNotifier } from './agreement-rollout-notifier';

const T0 = new Date('2026-07-07T09:00:00Z');
const DEADLINE_AT = new Date('2026-07-21T09:00:00Z');

interface RecordedSend {
  method: 'notification' | 'reminder';
  recipient: string;
  deadlineAt?: Date;
}

/**
 * Fake of AgreementEmailService: the adapter's job is only the recipient/method fan-out — the
 * rendered content (templates, placeholders) is covered by AgreementEmailService/EmailContentService
 * specs, so here we assert the fan-out, not the copy.
 */
class FakeMailer {
  public readonly sends: RecordedSend[] = [];
  private nextRef = 1;

  async sendVersionNotification(_customer: Customer, recipient: string, _version: AgreementVersion) {
    this.sends.push({ method: 'notification', recipient });
    return { providerRef: `ref-${this.nextRef++}` };
  }

  async sendReminder(_customer: Customer, recipient: string, _version: AgreementVersion, deadlineAt: Date) {
    this.sends.push({ method: 'reminder', recipient, deadlineAt });
    return { providerRef: `ref-${this.nextRef++}` };
  }
}

describe('AgreementRolloutNotifier (adapter RolloutNotifier → AgreementEmailService)', () => {
  let mailer: FakeMailer;
  let notifier: AgreementRolloutNotifier;

  beforeEach(() => {
    mailer = new FakeMailer();
    notifier = new AgreementRolloutNotifier(mailer as unknown as AgreementEmailService);
  });

  it('notifyVersionPublished: one notification per stored contact (recipient logic)', async () => {
    const customer = aCustomer({ contactEmails: ['max@customer.example', 'legal@customer.example'] });

    await notifier.notifyVersionPublished(customer, aVersion());

    expect(mailer.sends).toEqual([
      { method: 'notification', recipient: 'max@customer.example' },
      { method: 'notification', recipient: 'legal@customer.example' },
    ]);
  });

  it('notifyVersionPublished: customer without contacts → no send (escalation-report case)', async () => {
    await notifier.notifyVersionPublished(aCustomer({ contactEmails: [] }), aVersion());
    expect(mailer.sends).toHaveLength(0);
  });

  it('remind with a running deadline: reminder with the deadline to all contacts', async () => {
    const customer = aCustomer({ contactEmails: ['max@customer.example', 'legal@customer.example'] });
    const state = aState({ state: 'NOTIFIED', notifiedAt: T0, deadlineAt: DEADLINE_AT });

    await notifier.remind(customer, state, aVersion());

    expect(mailer.sends).toEqual([
      { method: 'reminder', recipient: 'max@customer.example', deadlineAt: DEADLINE_AT },
      { method: 'reminder', recipient: 'legal@customer.example', deadlineAt: DEADLINE_AT },
    ]);
  });

  it('remind without a deadline (no access): re-sends the rollout notification', async () => {
    const customer = aCustomer({ contactEmails: ['max@customer.example'] });
    const state = aState({ state: 'PENDING_NOTIFICATION' });

    await notifier.remind(customer, state, aVersion());

    expect(mailer.sends).toEqual([{ method: 'notification', recipient: 'max@customer.example' }]);
  });
});

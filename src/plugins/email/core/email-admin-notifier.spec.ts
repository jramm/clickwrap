import type { AdminNotification, EmailDeliveryProvider, OutboundMail } from '../../../plugin-sdk/index.js';
import { EmailAdminNotifier } from './email-admin-notifier.js';

const notification = (): AdminNotification => ({
  event: 'OBJECTION_RAISED',
  title: 'Objection raised against June 2026 edition',
  body: 'Customer: c-1\nReason: sub-processor XY',
  customerId: 'c-1',
  versionId: 'v-1',
  versionLabel: 'June 2026 edition',
  occurredAt: '2026-07-08T00:00:00.000Z',
});

describe('EmailAdminNotifier', () => {
  it('sends the notification to the configured recipient via the host provider', async () => {
    let sent: OutboundMail | undefined;
    const provider = {
      send: async (mail: OutboundMail) => {
        sent = mail;
        return { providerRef: 'p-1' };
      },
    } as EmailDeliveryProvider;
    const warn = jest.fn();

    await new EmailAdminNotifier(provider, 'ops@example.com', { warn }).notify(notification());

    expect(sent).toMatchObject({ to: 'ops@example.com', subject: 'Objection raised against June 2026 edition' });
    expect(sent?.text).toContain('Reason: sub-processor XY');
    expect(sent?.html).toContain('Reason: sub-processor XY');
    expect(warn).not.toHaveBeenCalled();
  });

  it('is best-effort: a provider error is swallowed and logged, notify() still resolves', async () => {
    const provider = {
      send: async () => {
        throw new Error('smtp down');
      },
    } as unknown as EmailDeliveryProvider;
    const warn = jest.fn();

    await expect(new EmailAdminNotifier(provider, 'ops@example.com', { warn }).notify(notification())).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

import type { AdminNotification, AdminNotifier, EmailDeliveryProvider } from '../../../plugin-sdk/index.js';
import { AdminNotificationService, createSelectedAdminNotifiers } from './admin-notification.service.js';

const notification = (): AdminNotification => ({
  event: 'OBJECTION_RAISED',
  title: 'Objection raised',
  body: 'details',
  customerId: 'c-1',
  versionId: 'v-1',
  occurredAt: '2026-07-08T00:00:00.000Z',
});

describe('AdminNotificationService', () => {
  it('fans a notification out to every active notifier', async () => {
    const a = { notify: jest.fn().mockResolvedValue(undefined) };
    const b = { notify: jest.fn().mockResolvedValue(undefined) };

    await new AdminNotificationService([a, b] as unknown as AdminNotifier[]).notify(notification());

    expect(a.notify).toHaveBeenCalledTimes(1);
    expect(b.notify).toHaveBeenCalledTimes(1);
  });

  it('isolates a failing notifier — the others still run and notify() resolves', async () => {
    const boom = { notify: jest.fn().mockRejectedValue(new Error('slack 500')) };
    const ok = { notify: jest.fn().mockResolvedValue(undefined) };

    await expect(
      new AdminNotificationService([boom, ok] as unknown as AdminNotifier[]).notify(notification()),
    ).resolves.toBeUndefined();
    expect(ok.notify).toHaveBeenCalledTimes(1);
  });
});

describe('createSelectedAdminNotifiers', () => {
  const original = { ...process.env };
  const provider = { send: async () => ({ providerRef: 'x' }) } as EmailDeliveryProvider;

  afterEach(() => {
    process.env = { ...original };
  });

  it('includes the email notifier when ADMIN_NOTIFICATION_EMAIL is set', () => {
    process.env.ADMIN_NOTIFICATIONS = 'email';
    process.env.ADMIN_NOTIFICATION_EMAIL = 'ops@example.com';

    expect(createSelectedAdminNotifiers(provider)).toHaveLength(1);
  });

  it('skips the email notifier (no boot error) when ADMIN_NOTIFICATION_EMAIL is unset', () => {
    process.env.ADMIN_NOTIFICATIONS = 'email';
    delete process.env.ADMIN_NOTIFICATION_EMAIL;

    expect(createSelectedAdminNotifiers(provider)).toHaveLength(0);
  });
});

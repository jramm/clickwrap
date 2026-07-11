import type { AdminNotification, PluginLogger } from '../../plugin-sdk/index.js';
import { SlackAdminNotifier } from './slack-admin-notifier.js';

const notification = (): AdminNotification => ({
  event: 'OBJECTION_RAISED',
  title: 'Objection raised against June 2026',
  body: 'Customer: c-1\nReason: sub-processor XY',
  customerId: 'c-1',
  versionId: 'v-1',
  occurredAt: '2026-07-08T00:00:00.000Z',
});

const logger = (): PluginLogger & { warn: jest.Mock } => ({ log: jest.fn(), warn: jest.fn(), error: jest.fn() });

describe('SlackAdminNotifier', () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('POSTs the notification to the incoming webhook', async () => {
    let calledUrl: string | undefined;
    let calledInit: RequestInit | undefined;
    globalThis.fetch = jest.fn(async (url: unknown, init: unknown) => {
      calledUrl = url as string;
      calledInit = init as RequestInit;
      return { ok: true, status: 200 } as Response;
    }) as unknown as typeof fetch;
    const log = logger();

    await new SlackAdminNotifier('https://hooks.slack.test/T/B/x', log).notify(notification());

    expect(calledUrl).toBe('https://hooks.slack.test/T/B/x');
    const body = JSON.parse(calledInit?.body as string) as { text: string };
    expect(body.text).toContain('Objection raised against June 2026');
    expect(body.text).toContain('sub-processor XY');
    expect(log.warn).not.toHaveBeenCalled();
  });

  it('logs a warning on a non-2xx response (best-effort, never throws)', async () => {
    globalThis.fetch = jest.fn(async () => ({ ok: false, status: 500 }) as Response) as unknown as typeof fetch;
    const log = logger();

    await expect(new SlackAdminNotifier('https://hooks.slack.test/x', log).notify(notification())).resolves.toBeUndefined();
    expect(log.warn).toHaveBeenCalledTimes(1);
  });

  it('swallows a network error', async () => {
    globalThis.fetch = jest.fn(async () => {
      throw new Error('network down');
    }) as unknown as typeof fetch;
    const log = logger();

    await expect(new SlackAdminNotifier('https://hooks.slack.test/x', log).notify(notification())).resolves.toBeUndefined();
    expect(log.warn).toHaveBeenCalledTimes(1);
  });
});

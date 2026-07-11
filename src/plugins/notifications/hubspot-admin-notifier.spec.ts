import type { AdminNotification, PluginLogger } from '../../plugin-sdk/index.js';
import { HubSpotAdminNotifier } from './hubspot-admin-notifier.js';

const notification = (): AdminNotification => ({
  event: 'OBJECTION_RAISED',
  title: 'Objection raised against June 2026',
  body: 'Customer: c-1\nReason: sub-processor XY',
  customerId: 'c-1',
  versionId: 'v-1',
  occurredAt: '2026-07-08T00:00:00.000Z',
});

const logger = (): PluginLogger & { warn: jest.Mock } => ({ log: jest.fn(), warn: jest.fn(), error: jest.fn() });

describe('HubSpotAdminNotifier', () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('creates a ticket via the CRM API with the bearer token and pipeline/stage', async () => {
    let calledUrl: string | undefined;
    let calledInit: RequestInit | undefined;
    globalThis.fetch = jest.fn(async (url: unknown, init: unknown) => {
      calledUrl = url as string;
      calledInit = init as RequestInit;
      return { ok: true, status: 201 } as Response;
    }) as unknown as typeof fetch;
    const log = logger();

    await new HubSpotAdminNotifier('tok-1', 'pipe-1', 'stage-1', log).notify(notification());

    expect(calledUrl).toBe('https://api.hubapi.com/crm/v3/objects/tickets');
    expect((calledInit?.headers as Record<string, string>).authorization).toBe('Bearer tok-1');
    const body = JSON.parse(calledInit?.body as string) as { properties: Record<string, string> };
    expect(body.properties).toMatchObject({
      subject: 'Objection raised against June 2026',
      hs_pipeline: 'pipe-1',
      hs_pipeline_stage: 'stage-1',
    });
    expect(body.properties.content).toContain('sub-processor XY');
    expect(log.warn).not.toHaveBeenCalled();
  });

  it('honours a custom base URL', async () => {
    let calledUrl: string | undefined;
    globalThis.fetch = jest.fn(async (url: unknown) => {
      calledUrl = url as string;
      return { ok: true, status: 201 } as Response;
    }) as unknown as typeof fetch;

    await new HubSpotAdminNotifier('tok', 'p', 's', logger(), 'https://hs.test').notify(notification());
    expect(calledUrl).toBe('https://hs.test/crm/v3/objects/tickets');
  });

  it('logs a warning on a non-2xx response and never throws', async () => {
    globalThis.fetch = jest.fn(async () => ({ ok: false, status: 403 }) as Response) as unknown as typeof fetch;
    const log = logger();

    await expect(new HubSpotAdminNotifier('tok', 'p', 's', log).notify(notification())).resolves.toBeUndefined();
    expect(log.warn).toHaveBeenCalledTimes(1);
  });
});

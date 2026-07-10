import {
  MainPortalCustomerSource,
  mapProviderGroup,
  type MainPortalRawProviderGroup,
} from './mainportal.source';

/** Synthetic raw provider group — no real names/emails. */
const syntheticGroup = (overrides: Partial<MainPortalRawProviderGroup> = {}): MainPortalRawProviderGroup => ({
  id: 7,
  name: 'Example Provider Group',
  managers: [{ email: 'manager-a@example.test', firstName: 'Ada', lastName: 'Tester' }],
  ...overrides,
});

/** Minimal fake fetch Response carrying JSON. */
const fakeResponse = (init: { ok: boolean; status: number; json?: unknown }): Response =>
  ({
    ok: init.ok,
    status: init.status,
    json: async () => init.json,
  }) as unknown as Response;

describe('mapProviderGroup', () => {
  it('maps the full record (externalRef = id-as-string, company/name/emails, first manager name)', () => {
    expect(mapProviderGroup(syntheticGroup())).toEqual({
      externalRef: '7',
      companyName: 'Example Provider Group',
      firstName: 'Ada',
      lastName: 'Tester',
      contactEmails: ['manager-a@example.test'],
    });
  });

  it('collects ALL manager e-mails, first/last name from managers[0]', () => {
    const mapped = mapProviderGroup(
      syntheticGroup({
        managers: [
          { email: 'first@example.test', firstName: 'First', lastName: 'One' },
          { email: 'second@example.test', firstName: 'Second', lastName: 'Two' },
        ],
      }),
    );
    expect(mapped.firstName).toBe('First');
    expect(mapped.lastName).toBe('One');
    expect(mapped.contactEmails).toEqual(['first@example.test', 'second@example.test']);
  });

  it('dedupes e-mails case-insensitively across managers, keeping the first occurrence', () => {
    const mapped = mapProviderGroup(
      syntheticGroup({
        managers: [
          { email: '  manager@example.test  ', firstName: 'A', lastName: 'B' },
          { email: 'Manager@example.test', firstName: 'C', lastName: 'D' },
          { email: '', firstName: 'E', lastName: 'F' },
        ],
      }),
    );
    expect(mapped.contactEmails).toEqual(['manager@example.test']);
  });

  it('yields an empty contactEmails array when there are no managers', () => {
    expect(mapProviderGroup(syntheticGroup({ managers: [] })).contactEmails).toEqual([]);
    expect(mapProviderGroup(syntheticGroup({ managers: null })).contactEmails).toEqual([]);
  });

  it('leaves firstName/lastName undefined when the first manager has none', () => {
    const mapped = mapProviderGroup(
      syntheticGroup({ managers: [{ email: 'm@example.test', firstName: null, lastName: null }] }),
    );
    expect(mapped.firstName).toBeUndefined();
    expect(mapped.lastName).toBeUndefined();
  });
});

describe('MainPortalCustomerSource.fetchAll', () => {
  const config = {
    baseUrl: 'https://app.example.test',
    apiToken: 'system-api-token-secret',
    providerGroupsPath: '/system/v1/provider-groups',
  };
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('fetches the provider-groups endpoint and returns the mapped snapshot (no deletedExternalRefs)', async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse({
        ok: true,
        status: 200,
        json: { items: [syntheticGroup(), syntheticGroup({ id: 8, name: 'Second Group' })], next: null },
      }),
    );

    const snapshot = await new MainPortalCustomerSource(config).fetchAll();

    expect(snapshot).toEqual({
      customers: [
        {
          externalRef: '7',
          companyName: 'Example Provider Group',
          firstName: 'Ada',
          lastName: 'Tester',
          contactEmails: ['manager-a@example.test'],
        },
        {
          externalRef: '8',
          companyName: 'Second Group',
          firstName: 'Ada',
          lastName: 'Tester',
          contactEmails: ['manager-a@example.test'],
        },
      ],
    });
    expect(snapshot).not.toHaveProperty('deletedExternalRefs');
  });

  it('sends a GET to baseUrl+path with the Bearer + accept headers', async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse({ ok: true, status: 200, json: { items: [] } }));

    await new MainPortalCustomerSource(config).fetchAll();

    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('https://app.example.test/system/v1/provider-groups');
    expect(options.method).toBe('GET');
    expect(options.headers).toMatchObject({
      accept: 'application/json',
      Authorization: 'Bearer system-api-token-secret',
    });
  });

  it('follows `next` pagination and merges the pages', async () => {
    fetchMock
      .mockResolvedValueOnce(
        fakeResponse({
          ok: true,
          status: 200,
          json: { items: [syntheticGroup({ id: 1 })], next: '/system/v1/provider-groups?offset=1' },
        }),
      )
      .mockResolvedValueOnce(
        fakeResponse({ ok: true, status: 200, json: { items: [syntheticGroup({ id: 2 })], next: null } }),
      );

    const snapshot = await new MainPortalCustomerSource(config).fetchAll();

    expect(snapshot.customers.map((customer) => customer.externalRef)).toEqual(['1', '2']);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0]).toBe('https://app.example.test/system/v1/provider-groups?offset=1');
  });

  it('throws (without leaking the token) on a non-2xx response', async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse({ ok: false, status: 403, json: {} }));
    const source = new MainPortalCustomerSource(config);
    await expect(source.fetchAll()).rejects.toThrow(/provider-groups fetch failed/i);
    await expect(source.fetchAll()).rejects.not.toThrow(/system-api-token-secret/);
  });

  it('throws when the API token is missing, without calling fetch', async () => {
    const source = new MainPortalCustomerSource({ ...config, apiToken: '   ' });
    await expect(source.fetchAll()).rejects.toThrow(/missing its API token/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

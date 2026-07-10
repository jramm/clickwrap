import {
  MetergridCustomerSource,
  mapMetergridCustomer,
  type MetergridRawCustomer,
  type MetergridRawProject,
} from './metergrid.source';

/** Synthetic raw customer — no real names/emails. */
const syntheticRaw = (overrides: Partial<MetergridRawCustomer> = {}): MetergridRawCustomer => ({
  id: 42,
  crmId: '28947694817',
  companyName: 'Example GmbH',
  email: 'billing@example.test',
  contactPerson: { firstName: 'Ada', lastName: 'Tester', email: 'ada@example.test' },
  ...overrides,
});

/** Minimal fake fetch Response carrying JSON + Set-Cookie via undici-style getSetCookie(). */
const fakeResponse = (init: { ok: boolean; status: number; json?: unknown; setCookies?: string[] }): Response =>
  ({
    ok: init.ok,
    status: init.status,
    json: async () => init.json,
    headers: {
      getSetCookie: () => init.setCookies ?? [],
      get: (name: string) =>
        name.toLowerCase() === 'set-cookie' && init.setCookies ? init.setCookies.join(', ') : null,
    },
  }) as unknown as Response;

describe('mapMetergridCustomer', () => {
  it('maps the full record (externalRef = HubSpot crmId, company/name/emails)', () => {
    expect(mapMetergridCustomer(syntheticRaw())).toEqual({
      externalRef: '28947694817',
      companyName: 'Example GmbH',
      firstName: 'Ada',
      lastName: 'Tester',
      contactEmails: ['ada@example.test', 'billing@example.test'],
    });
  });

  it('falls back to the game id when crmId is missing/blank', () => {
    expect(mapMetergridCustomer(syntheticRaw({ crmId: null })).externalRef).toBe('42');
    expect(mapMetergridCustomer(syntheticRaw({ crmId: '   ' })).externalRef).toBe('42');
  });

  it('guards a missing contactPerson (firstName/lastName undefined, company email still used)', () => {
    const mapped = mapMetergridCustomer(syntheticRaw({ contactPerson: null }));
    expect(mapped.firstName).toBeUndefined();
    expect(mapped.lastName).toBeUndefined();
    expect(mapped.contactEmails).toEqual(['billing@example.test']);
  });

  it('leaves companyName undefined when null', () => {
    expect(mapMetergridCustomer(syntheticRaw({ companyName: null })).companyName).toBeUndefined();
  });

  it('dedupes, trims and drops empty contact e-mails', () => {
    const mapped = mapMetergridCustomer(
      syntheticRaw({
        email: '  ada@example.test  ',
        contactPerson: { firstName: 'Ada', lastName: 'Tester', email: 'ada@example.test' },
      }),
    );
    expect(mapped.contactEmails).toEqual(['ada@example.test']);
  });

  it('dedupes case-insensitively, keeping the first occurrence (contactPerson wins)', () => {
    const mapped = mapMetergridCustomer(
      syntheticRaw({
        email: 'Ahaeussermann@gmx.de',
        contactPerson: { firstName: 'Ada', lastName: 'Tester', email: 'ahaeussermann@gmx.de' },
      }),
    );
    expect(mapped.contactEmails).toEqual(['ahaeussermann@gmx.de']);
  });

  it('yields an empty contactEmails array when both e-mails are null/blank', () => {
    const mapped = mapMetergridCustomer(
      syntheticRaw({ email: '   ', contactPerson: { firstName: 'Ada', lastName: 'Tester', email: null } }),
    );
    expect(mapped.contactEmails).toEqual([]);
  });
});

describe('MetergridCustomerSource.fetchAll', () => {
  const config = { baseUrl: 'https://api.example.test', username: 'svc@example.test', password: 'super-secret-pw' };
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const signinOk = () =>
    fakeResponse({
      ok: true,
      status: 200,
      json: { status: 'OK', user: { id: 'u1' } },
      setCookies: ['sAccessToken=access-abc; Path=/; HttpOnly', 'sRefreshToken=refresh-def; Path=/auth; HttpOnly'],
    });

  const itemsResponse = (items: unknown[]) => fakeResponse({ ok: true, status: 200, json: { items } });

  /** A won project referencing `customerId` (defaults to the WON stage). */
  const wonProject = (customerId: number, status = 'WON'): MetergridRawProject => ({
    id: customerId * 10,
    customerId,
    tenantElectricity: { status },
  });

  it('signs in, fetches projects + customers and returns only the mapped WON-deal customers', async () => {
    fetchMock
      .mockResolvedValueOnce(signinOk())
      .mockResolvedValueOnce(itemsResponse([wonProject(42)]))
      .mockResolvedValueOnce(
        itemsResponse([syntheticRaw({ crmId: 'hs-42' }), syntheticRaw({ id: 99, crmId: 'hs-99' })]),
      );

    const source = new MetergridCustomerSource(config);
    const snapshot = await source.fetchAll();

    // Only customer 42 has a won project; customer 99 (no project) is excluded.
    expect(snapshot).toEqual({
      customers: [
        {
          externalRef: 'hs-42',
          companyName: 'Example GmbH',
          firstName: 'Ada',
          lastName: 'Tester',
          contactEmails: ['ada@example.test', 'billing@example.test'],
        },
      ],
    });
    expect(snapshot).not.toHaveProperty('deletedExternalRefs');
  });

  it('keeps only won-deal customers (WON + PROJECT_PLANNING_EXECUTION), excluding lost/qualification/no-project and null customerId', async () => {
    const projects: MetergridRawProject[] = [
      wonProject(1, 'WON'),
      wonProject(2, 'LOST'), // customer 2: only a lost project → excluded
      wonProject(3, 'PROJECT_PLANNING_EXECUTION'),
      wonProject(3, 'LOST'), // customer 3 also has a lost one, but a won project wins → included
      wonProject(5, 'QUALIFICATION'), // customer 5: not yet won → excluded
      { id: 700, customerId: null, tenantElectricity: { status: 'WON' } }, // null customerId → ignored
      { id: 800, customerId: 6, tenantElectricity: null }, // no stage → ignored (customer 6 excluded)
    ];
    const customers = [1, 2, 3, 4, 5, 6].map((id) =>
      syntheticRaw({ id, crmId: `hs-${id}`, companyName: `Company ${id}` }),
    );
    fetchMock
      .mockResolvedValueOnce(signinOk())
      .mockResolvedValueOnce(itemsResponse(projects))
      .mockResolvedValueOnce(itemsResponse(customers));

    const snapshot = await new MetergridCustomerSource(config).fetchAll();

    // Customers 1 and 3 are won; 2 (lost), 4 (no project), 5 (qualification), 6 (null stage) are out.
    expect(snapshot.customers.map((c) => c.externalRef)).toEqual(['hs-1', 'hs-3']);
  });

  it('sends the correct sign-in request (URL, headers, formFields body)', async () => {
    fetchMock
      .mockResolvedValueOnce(signinOk())
      .mockResolvedValueOnce(itemsResponse([]))
      .mockResolvedValueOnce(itemsResponse([]));

    await new MetergridCustomerSource(config).fetchAll();

    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.example.test/auth/signin');
    expect(options.method).toBe('POST');
    expect(options.headers).toMatchObject({
      'content-type': 'application/json',
      rid: 'emailpassword',
      'st-auth-mode': 'cookie',
    });
    expect(JSON.parse(options.body)).toEqual({
      formFields: [
        { id: 'email', value: 'svc@example.test' },
        { id: 'password', value: 'super-secret-pw' },
      ],
    });
  });

  it('sends the projects request with the session Cookie header, URL and tenantElectricity include body', async () => {
    fetchMock
      .mockResolvedValueOnce(signinOk())
      .mockResolvedValueOnce(itemsResponse([]))
      .mockResolvedValueOnce(itemsResponse([]));

    await new MetergridCustomerSource(config).fetchAll();

    const [url, options] = fetchMock.mock.calls[1];
    expect(url).toBe('https://api.example.test/api/configurator/projects?skip_total_items=true');
    expect(options.method).toBe('POST');
    expect(options.headers).toMatchObject({
      'content-type': 'application/json',
      Cookie: 'sAccessToken=access-abc; sRefreshToken=refresh-def',
    });
    expect(JSON.parse(options.body)).toEqual({
      include: { tenantElectricity: true },
      filter: {},
      params: {},
    });
  });

  it('sends the customers request with the session Cookie header, URL and include body', async () => {
    fetchMock
      .mockResolvedValueOnce(signinOk())
      .mockResolvedValueOnce(itemsResponse([]))
      .mockResolvedValueOnce(itemsResponse([]));

    await new MetergridCustomerSource(config).fetchAll();

    const [url, options] = fetchMock.mock.calls[2];
    expect(url).toBe('https://api.example.test/api/configurator/customers?skip_total_items=true');
    expect(options.method).toBe('POST');
    expect(options.headers).toMatchObject({
      'content-type': 'application/json',
      Cookie: 'sAccessToken=access-abc; sRefreshToken=refresh-def',
    });
    expect(JSON.parse(options.body)).toEqual({
      include: { address: true, contactPerson: true },
      filter: {},
      params: {},
    });
  });

  it('falls back to a single set-cookie header when getSetCookie() is unavailable', async () => {
    const signinLegacy = {
      ok: true,
      status: 200,
      json: async () => ({ status: 'OK' }),
      headers: {
        get: (name: string) =>
          name.toLowerCase() === 'set-cookie'
            ? 'sAccessToken=access-abc; Path=/, sRefreshToken=refresh-def; Path=/auth'
            : null,
      },
    } as unknown as Response;
    fetchMock
      .mockResolvedValueOnce(signinLegacy)
      .mockResolvedValueOnce(itemsResponse([]))
      .mockResolvedValueOnce(itemsResponse([]));

    await new MetergridCustomerSource(config).fetchAll();

    expect(fetchMock.mock.calls[1][1].headers.Cookie).toBe('sAccessToken=access-abc; sRefreshToken=refresh-def');
    expect(fetchMock.mock.calls[2][1].headers.Cookie).toBe('sAccessToken=access-abc; sRefreshToken=refresh-def');
  });

  it('throws (without leaking the password) on a non-200 sign-in', async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse({ ok: false, status: 401, json: {} }));
    const source = new MetergridCustomerSource(config);
    await expect(source.fetchAll()).rejects.toThrow(/sign-in failed/i);
    await expect(source.fetchAll()).rejects.not.toThrow(/super-secret-pw/);
    expect(fetchMock).toHaveBeenCalledTimes(2); // only sign-in attempted, no projects/customers fetched
  });

  it('throws when sign-in returns a non-OK status', async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse({ ok: true, status: 200, json: { status: 'WRONG_CREDENTIALS_ERROR' } }));
    await expect(new MetergridCustomerSource(config).fetchAll()).rejects.toThrow(/status "WRONG_CREDENTIALS_ERROR"/);
  });

  it('throws when the projects fetch fails', async () => {
    fetchMock
      .mockResolvedValueOnce(signinOk())
      .mockResolvedValueOnce(fakeResponse({ ok: false, status: 500, json: {} }));
    await expect(new MetergridCustomerSource(config).fetchAll()).rejects.toThrow(/project fetch failed/i);
  });

  it('throws when the customers fetch fails', async () => {
    fetchMock
      .mockResolvedValueOnce(signinOk())
      .mockResolvedValueOnce(itemsResponse([]))
      .mockResolvedValueOnce(fakeResponse({ ok: false, status: 500, json: {} }));
    await expect(new MetergridCustomerSource(config).fetchAll()).rejects.toThrow(/customer fetch failed/i);
  });
});

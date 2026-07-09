import { MetergridCustomerSource, mapMetergridCustomer, type MetergridRawCustomer } from './metergrid.source';

/** Synthetic raw customer — no real names/emails. */
const syntheticRaw = (overrides: Partial<MetergridRawCustomer> = {}): MetergridRawCustomer => ({
  id: 42,
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
  it('maps the full record (numeric id → string, company/name/emails)', () => {
    expect(mapMetergridCustomer(syntheticRaw())).toEqual({
      externalRef: '42',
      companyName: 'Example GmbH',
      firstName: 'Ada',
      lastName: 'Tester',
      contactEmails: ['ada@example.test', 'billing@example.test'],
    });
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

  it('signs in, fetches the snapshot and returns the mapped customers', async () => {
    fetchMock
      .mockResolvedValueOnce(signinOk())
      .mockResolvedValueOnce(fakeResponse({ ok: true, status: 200, json: { items: [syntheticRaw()], total_items: 1 } }));

    const source = new MetergridCustomerSource(config);
    const snapshot = await source.fetchAll();

    expect(snapshot).toEqual({
      customers: [
        {
          externalRef: '42',
          companyName: 'Example GmbH',
          firstName: 'Ada',
          lastName: 'Tester',
          contactEmails: ['ada@example.test', 'billing@example.test'],
        },
      ],
    });
    expect(snapshot).not.toHaveProperty('deletedExternalRefs');
  });

  it('sends the correct sign-in request (URL, headers, formFields body)', async () => {
    fetchMock
      .mockResolvedValueOnce(signinOk())
      .mockResolvedValueOnce(fakeResponse({ ok: true, status: 200, json: { items: [] } }));

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

  it('sends the customers request with the session Cookie header, URL and include body', async () => {
    fetchMock
      .mockResolvedValueOnce(signinOk())
      .mockResolvedValueOnce(fakeResponse({ ok: true, status: 200, json: { items: [] } }));

    await new MetergridCustomerSource(config).fetchAll();

    const [url, options] = fetchMock.mock.calls[1];
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
      .mockResolvedValueOnce(fakeResponse({ ok: true, status: 200, json: { items: [] } }));

    await new MetergridCustomerSource(config).fetchAll();

    expect(fetchMock.mock.calls[1][1].headers.Cookie).toBe('sAccessToken=access-abc; sRefreshToken=refresh-def');
  });

  it('throws (without leaking the password) on a non-200 sign-in', async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse({ ok: false, status: 401, json: {} }));
    const source = new MetergridCustomerSource(config);
    await expect(source.fetchAll()).rejects.toThrow(/sign-in failed/i);
    await expect(source.fetchAll()).rejects.not.toThrow(/super-secret-pw/);
    expect(fetchMock).toHaveBeenCalledTimes(2); // only sign-in attempted, customers never fetched
  });

  it('throws when sign-in returns a non-OK status', async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse({ ok: true, status: 200, json: { status: 'WRONG_CREDENTIALS_ERROR' } }));
    await expect(new MetergridCustomerSource(config).fetchAll()).rejects.toThrow(/status "WRONG_CREDENTIALS_ERROR"/);
  });

  it('throws when the customers fetch fails', async () => {
    fetchMock
      .mockResolvedValueOnce(signinOk())
      .mockResolvedValueOnce(fakeResponse({ ok: false, status: 500, json: {} }));
    await expect(new MetergridCustomerSource(config).fetchAll()).rejects.toThrow(/customer fetch failed/i);
  });
});

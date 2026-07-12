import { createAcceptanceClient, readEmbeddedView, renderEmbeddedView } from './accept-client.js';
import type { AcceptancePageView } from './kinds/acceptance-page.js';

interface Call {
  url: string;
  init: RequestInit;
}

/** A duck-typed fetch that records the request and returns a canned JSON response. */
const stubFetch = (status: number, body: unknown, sink: Call[]): typeof fetch =>
  (async (url: string | URL | Request, init?: RequestInit) => {
    sink.push({ url: String(url), init: init ?? {} });
    return { ok: status < 400, status, json: async () => body } as Response;
  }) as unknown as typeof fetch;

describe('createAcceptanceClient', () => {
  const base = '/accept/tok-123';

  it('accept: POSTs {…}/acceptances with an Idempotency-Key and returns the parsed success', async () => {
    const calls: Call[] = [];
    const client = createAcceptanceClient({ basePath: base, fetch: stubFetch(201, { acceptanceId: 'a-9', state: 'ACCEPTED' }, calls) });

    const out = await client.accept({ versionId: 'v-1', displayedConsentText: 'I agree.', signerName: 'Max', signerEmail: 'max@acme.example' });

    expect(out).toEqual({ ok: true, acceptanceId: 'a-9', state: 'ACCEPTED' });
    expect(calls[0].url).toBe('/accept/tok-123/acceptances');
    expect(calls[0].init.method).toBe('POST');
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers['Content-Type']).toBe('application/json');
    expect(headers['Idempotency-Key']).toBeTruthy();
    const sent = JSON.parse(calls[0].init.body as string);
    expect(sent).toEqual({ versionId: 'v-1', displayedConsentText: 'I agree.', signerName: 'Max', signerEmail: 'max@acme.example' });
    expect(sent).not.toHaveProperty('idempotencyKey'); // goes to the header, not the body
  });

  it('accept: maps a typed error body onto { ok:false, status, code }', async () => {
    const calls: Call[] = [];
    const client = createAcceptanceClient({ basePath: base, fetch: stubFetch(409, { code: 'ALREADY_ACCEPTED', message: 'done' }, calls) });
    const out = await client.accept({ versionId: 'v-1', signerName: 'M', signerEmail: 'm@x.io' });
    expect(out).toEqual({ ok: false, status: 409, code: 'ALREADY_ACCEPTED', message: 'done' });
  });

  it('object: POSTs {…}/objections and returns the parsed success', async () => {
    const calls: Call[] = [];
    const client = createAcceptanceClient({ basePath: base, fetch: stubFetch(201, { objectionId: 'o-1', state: 'OBJECTED' }, calls) });
    const out = await client.object({ versionId: 'v-1', reason: 'no', idempotencyKey: 'k-1' });
    expect(out).toEqual({ ok: true, objectionId: 'o-1', state: 'OBJECTED' });
    expect(calls[0].url).toBe('/accept/tok-123/objections');
    expect((calls[0].init.headers as Record<string, string>)['Idempotency-Key']).toBe('k-1'); // caller key honored
    expect(JSON.parse(calls[0].init.body as string)).toEqual({ versionId: 'v-1', reason: 'no' });
  });

  it('a network failure becomes { ok:false, status:0, code:NETWORK_ERROR }', async () => {
    const throwingFetch = (async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;
    const client = createAcceptanceClient({ basePath: base, fetch: throwingFetch });
    expect(await client.accept({ versionId: 'v-1', signerName: 'M', signerEmail: 'm@x.io' })).toEqual({
      ok: false,
      status: 0,
      code: 'NETWORK_ERROR',
    });
  });

  it('strips a trailing slash from basePath', async () => {
    const calls: Call[] = [];
    const client = createAcceptanceClient({ basePath: `${base}/`, fetch: stubFetch(201, { acceptanceId: 'a', state: 'ACCEPTED' }, calls) });
    await client.accept({ versionId: 'v-1', signerName: 'M', signerEmail: 'm@x.io' });
    expect(calls[0].url).toBe('/accept/tok-123/acceptances');
  });
});

describe('renderEmbeddedView / readEmbeddedView', () => {
  const view = { linkId: 'al-1', customerName: 'Acme', firstName: 'A', lastName: 'B', companyName: 'Acme', suggestedEmail: 'a@x.io', items: [] } as AcceptancePageView;

  it('renders a script tag that escapes </ and round-trips through readEmbeddedView', () => {
    const html = renderEmbeddedView({ ...view, customerName: '</script><b>x</b>' });
    expect(html).toContain('<script type="application/json" id="clickwrap-accept-view">');
    expect(html).not.toContain('</script><b>'); // the payload's </ is escaped
    const json = html.replace(/^<script[^>]*>/, '').replace(/<\/script>$/, '').replace(/\\u003c/g, '<');
    const parsed = JSON.parse(json) as AcceptancePageView;
    expect(parsed.customerName).toBe('</script><b>x</b>');
  });

  it('readEmbeddedView reads the embedded JSON from a (stubbed) document', () => {
    const text = renderEmbeddedView(view).replace(/^<script[^>]*>/, '').replace(/<\/script>$/, '');
    (globalThis as { document?: unknown }).document = { getElementById: (id: string) => (id === 'clickwrap-accept-view' ? { textContent: text } : null) };
    try {
      expect(readEmbeddedView()?.customerName).toBe('Acme');
      expect(readEmbeddedView('missing')).toBeUndefined();
    } finally {
      delete (globalThis as { document?: unknown }).document;
    }
  });
});

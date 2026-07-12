/**
 * Browser client for the hosted acceptance page — so an `acceptance-page` plugin's client UI never
 * hardcodes the HTTP contract. It encapsulates the two endpoints the page POSTs to
 * (`…/acceptances`, `…/objections`), the per-attempt Idempotency-Key, and the `{ code, message }`
 * error mapping. Paired with {@link renderEmbeddedView} / {@link readEmbeddedView} for handing the
 * server-assembled {@link AcceptancePageView} to the client.
 *
 * Shipped as the SDK subpath `@jramm/clickwrap-plugin-sdk/accept-client` (browser code — kept out of
 * the main entry). Uses only cross-runtime globals (`fetch`, `crypto`, `location`, `document`); the
 * `fetch` implementation and `basePath` are injectable for testing / SSR.
 */
import type { AcceptancePageView } from './kinds/acceptance-page.js';

const DEFAULT_VIEW_ELEMENT_ID = 'clickwrap-accept-view';

/** Body of a `POST …/acceptances`. ACTIVE items must echo `displayedConsentText`; PASSIVE omit it. */
export interface AcceptRequest {
  versionId: string;
  displayedConsentText?: string;
  signerName: string;
  signerEmail: string;
  /** Idempotency key; a random one is generated per call when omitted. */
  idempotencyKey?: string;
}

/** Body of a `POST …/objections` (PASSIVE items within the objection period). A reason is required. */
export interface ObjectRequest {
  versionId: string;
  reason: string;
  signerName?: string;
  signerEmail?: string;
  idempotencyKey?: string;
}

/** Failure shape shared by both calls — the server's `{ code, message }` plus the HTTP status. */
export interface ClickwrapFailure {
  ok: false;
  status: number;
  code?: string;
  message?: string;
}

export type AcceptOutcome = ({ ok: true } & { acceptanceId: string; state: 'ACCEPTED' }) | ClickwrapFailure;
export type ObjectOutcome = ({ ok: true } & { objectionId: string; state: 'OBJECTED' }) | ClickwrapFailure;

export interface AcceptanceClient {
  accept(request: AcceptRequest): Promise<AcceptOutcome>;
  object(request: ObjectRequest): Promise<ObjectOutcome>;
}

export interface AcceptanceClientOptions {
  /** Base path of the hosted page (`…/accept/<token>`). Defaults to the current location's path. */
  basePath?: string;
  /** `fetch` implementation; defaults to the global `fetch`. */
  fetch?: typeof fetch;
}

const stripTrailingSlash = (path: string): string => path.replace(/\/+$/, '');

const currentBasePath = (): string => {
  const loc = (globalThis as { location?: { pathname?: string } }).location;
  if (!loc?.pathname) {
    throw new Error('createAcceptanceClient: no basePath given and no location.pathname available');
  }
  return stripTrailingSlash(loc.pathname);
};

const randomIdempotencyKey = (): string => {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  return c?.randomUUID ? c.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
};

/** Creates a client bound to a single hosted acceptance page (one capability link). */
export function createAcceptanceClient(options: AcceptanceClientOptions = {}): AcceptanceClient {
  const doFetch = options.fetch ?? (globalThis as { fetch?: typeof fetch }).fetch;
  if (!doFetch) throw new Error('createAcceptanceClient: no fetch implementation available');
  const basePath = options.basePath !== undefined ? stripTrailingSlash(options.basePath) : currentBasePath();

  const post = async (
    endpoint: string,
    body: unknown,
    idempotencyKey?: string,
  ): Promise<ClickwrapFailure | { ok: true; data: Record<string, unknown> }> => {
    let response: Response;
    try {
      response = await doFetch(`${basePath}/${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey ?? randomIdempotencyKey() },
        body: JSON.stringify(body),
      });
    } catch {
      return { ok: false, status: 0, code: 'NETWORK_ERROR' };
    }
    const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (response.ok) return { ok: true, data };
    return { ok: false, status: response.status, code: data.code as string | undefined, message: data.message as string | undefined };
  };

  return {
    async accept(request) {
      const { idempotencyKey, ...body } = request;
      const result = await post('acceptances', body, idempotencyKey);
      if (!result.ok) return result;
      return { ok: true, acceptanceId: String(result.data.acceptanceId ?? ''), state: 'ACCEPTED' };
    },
    async object(request) {
      const { idempotencyKey, ...body } = request;
      const result = await post('objections', body, idempotencyKey);
      if (!result.ok) return result;
      return { ok: true, objectionId: String(result.data.objectionId ?? ''), state: 'OBJECTED' };
    },
  };
}

/**
 * Server-side: the `<script type="application/json">` tag a renderer embeds so the client can read
 * the view-model. Escapes `</` so the JSON can never terminate the script or inject markup.
 */
export function renderEmbeddedView(view: AcceptancePageView, elementId: string = DEFAULT_VIEW_ELEMENT_ID): string {
  const json = JSON.stringify(view).replace(/</g, '\\u003c');
  return `<script type="application/json" id="${elementId}">${json}</script>`;
}

/** Browser-side: reads the view embedded by {@link renderEmbeddedView}; undefined when absent. */
export function readEmbeddedView(elementId: string = DEFAULT_VIEW_ELEMENT_ID): AcceptancePageView | undefined {
  const doc = (globalThis as { document?: { getElementById(id: string): { textContent: string | null } | null } }).document;
  const text = doc?.getElementById(elementId)?.textContent;
  return text ? (JSON.parse(text) as AcceptancePageView) : undefined;
}

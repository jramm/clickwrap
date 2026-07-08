import '@testing-library/jest-dom/vitest';
import { afterAll, afterEach, beforeAll } from 'vitest';
import { server } from './server';
import { setMatchMediaMatches } from './matchMedia';

/** MSW lifecycle + storage reset between tests. */
beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
  // jsdom's AbortSignal is not an instance of undici's (Node fetch used by msw),
  // so react-query's request-cancellation signal makes fetch throw in tests only.
  // Strip it at the outermost fetch layer; production (real browser) is unaffected.
  const patchedFetch = globalThis.fetch;
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    if (init && 'signal' in init) {
      const { signal: _signal, ...rest } = init;
      return patchedFetch(input, rest);
    }
    return patchedFetch(input, init);
  }) as typeof fetch;
});
afterEach(() => {
  server.resetHandlers();
  setMatchMediaMatches(false); // reset to desktop layout between tests
  try {
    localStorage.clear();
    localStorage.clear();
  } catch {
    /* ignore */
  }
});
afterAll(() => server.close());

/**
 * jsdom has no `window.matchMedia`, which MUI's `useMediaQuery` (and therefore
 * our responsive `useIsMobile`) needs. This installs a controllable stub:
 * `setMatchMediaMatches(true)` makes every media query report a match, letting a
 * test render the mobile (card list / full-screen dialog) layout. Defaults to
 * desktop (no match) and is reset between tests.
 */
let currentMatches = false;

export function setMatchMediaMatches(matches: boolean): void {
  currentMatches = matches;
}

function install(): void {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: (query: string): MediaQueryList => ({
      matches: currentMatches,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

install();

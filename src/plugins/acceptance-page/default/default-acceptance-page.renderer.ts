/**
 * Default `acceptance-page` renderer: the current server-rendered hosted acceptance page.
 *
 * It is a thin adapter over the existing `renderAcceptPage` / `renderLinkNotFoundPage` in
 * `src/accept/accept-page.view.ts` — all page logic, inline CSS/JS and the PASSIVE "Accept now"
 * button stay there, unchanged. Selected by default (`ACCEPTANCE_PAGE=default`), it reproduces the
 * previous behaviour byte-for-byte.
 */
import { renderAcceptPage, renderLinkNotFoundPage } from '../../../accept/accept-page.view';
import type { AcceptancePageLang, AcceptancePageRenderer, AcceptancePageView } from '../../../plugin-sdk';

export class DefaultAcceptancePageRenderer implements AcceptancePageRenderer {
  renderAcceptPage(view: AcceptancePageView, lang: AcceptancePageLang): string {
    return renderAcceptPage(view, lang);
  }

  renderNotFoundPage(lang: AcceptancePageLang): string {
    return renderLinkNotFoundPage(lang);
  }
}

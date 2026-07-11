/**
 * Server-side renderer of the hosted acceptance page: one self-contained HTML document —
 * inline CSS, mobile-first, no external assets. The exact consent text is transported to the
 * page's inline JS via an embedded JSON block (never through HTML attributes) so the POST can
 * echo it verbatim (CONSENT_TEXT_MISMATCH cross-check).
 */
import type { AcceptPageItem, AcceptPageView } from './accept-page.service.js';
import { ACCEPT_PAGE_STRINGS, type AcceptPageLang, type AcceptPageStrings } from './i18n.js';

export const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

/** Embedded JSON must never terminate the <script> block or introduce markup. */
const toJsonScript = (payload: unknown): string => JSON.stringify(payload).replace(/</g, '\\u003c');

const formatDate = (date: Date, lang: AcceptPageLang): string => {
  const iso = date.toISOString().slice(0, 10);
  if (lang === 'de') {
    const [year, month, day] = iso.split('-');
    return `${day}.${month}.${year}`;
  }
  return iso;
};

const STYLES = `
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
         background: #f4f6f8; color: #1a2027; line-height: 1.5; }
  main { max-width: 40rem; margin: 0 auto; padding: 1rem; }
  h1 { font-size: 1.35rem; margin: 0.5rem 0; }
  h2 { font-size: 1.05rem; margin: 0 0 0.25rem; }
  .card { background: #fff; border: 1px solid #dde3e9; border-radius: 0.75rem;
          padding: 1rem; margin: 1rem 0; }
  .muted { color: #5b6770; font-size: 0.875rem; }
  .meta { color: #5b6770; font-size: 0.875rem; margin: 0.25rem 0 0.75rem; }
  .warning { background: #fdecea; border: 1px solid #f5c6c2; color: #8a1c12;
             border-radius: 0.5rem; padding: 0.6rem 0.75rem; font-size: 0.875rem; margin: 0.75rem 0; }
  .info { background: #eef4fb; border: 1px solid #c9dcf1; color: #1d4f91;
          border-radius: 0.5rem; padding: 0.6rem 0.75rem; font-size: 0.875rem; margin: 0.75rem 0; }
  .consent { display: flex; gap: 0.6rem; align-items: flex-start; margin: 0.75rem 0;
             padding: 0.75rem; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 0.5rem; }
  .consent input { margin-top: 0.2rem; width: 1.1rem; height: 1.1rem; flex: none; }
  label.field { display: block; margin: 0.75rem 0; }
  label.field span { display: block; font-size: 0.875rem; margin-bottom: 0.25rem; }
  input[type='text'], input[type='email'] { width: 100%; padding: 0.6rem 0.7rem; font-size: 1rem;
             border: 1px solid #c3ccd4; border-radius: 0.5rem; background: #fff; }
  button { width: 100%; padding: 0.75rem 1rem; font-size: 1rem; font-weight: 600; border: 0;
           border-radius: 0.5rem; background: #1d4f91; color: #fff; cursor: pointer; }
  button:disabled { background: #9fb4cc; cursor: not-allowed; }
  a.pdf { display: inline-block; margin: 0.25rem 0 0.5rem; color: #1d4f91; font-weight: 600; }
  .msg-error { color: #8a1c12; font-size: 0.875rem; margin: 0.5rem 0 0; }
  .accepted { background: #e8f5ec; border: 1px solid #bfe3c8; color: #1d6b34;
              border-radius: 0.5rem; padding: 0.75rem; font-weight: 600; text-align: center; }
  .center { text-align: center; padding: 3rem 1rem; }
  @media (min-width: 30rem) { main { padding: 2rem 1rem; } button { width: auto; } }
`;

const htmlShell = (lang: AcceptPageLang, title: string, body: string): string => `<!doctype html>
<html lang="${ACCEPT_PAGE_STRINGS[lang].htmlLang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${escapeHtml(title)}</title>
<style>${STYLES}</style>
</head>
<body>
<main>
${body}
</main>
</body>
</html>
`;

const renderItem = (item: AcceptPageItem, s: AcceptPageStrings, lang: AcceptPageLang): string => {
  const deadline = item.deadlineAt ? ` · ${escapeHtml(s.deadline)}: ${formatDate(item.deadlineAt, lang)}` : '';
  // Scheduled effectiveness: an upcoming (published, not yet effective) version shows its
  // "valid from" date — it can already be accepted in advance.
  const upcoming = item.upcoming
    ? `<div class="info">${escapeHtml(s.upcomingValidFrom.replace('{date}', formatDate(item.validFrom, lang)))}</div>`
    : '';
  const blocking = item.blocking ? `<div class="warning">${escapeHtml(s.blockingWarning)}</div>` : '';
  const active = item.mode === 'ACTIVE' && item.consentText !== undefined;
  const messageEl = `<p class="msg-error" data-message hidden></p>`;
  let action: string;
  if (active) {
    // ACTIVE: consent checkbox (verbatim text) + accept button.
    action = `<div class="consent">
        <input type="checkbox" id="consent-${escapeHtml(item.versionId)}" data-consent-checkbox>
        <label for="consent-${escapeHtml(item.versionId)}">${escapeHtml(item.consentText ?? '')}</label>
      </div>
      <button type="button" data-accept-button>${escapeHtml(s.acceptButton)}</button>
      ${messageEl}`;
  } else if (item.mode === 'PASSIVE') {
    // PASSIVE: takes effect automatically, but may be opted into early — a button, NO checkbox and
    // NO consent text (the acceptance POST omits displayedConsentText for PASSIVE items).
    action = `<div class="info">${escapeHtml(s.passiveInfo)}</div>
      <button type="button" data-accept-button>${escapeHtml(s.passiveAcceptButton)}</button>
      ${messageEl}`;
  } else {
    action = `<div class="info">${escapeHtml(s.passiveInfo)}</div>`;
  }
  return `<section class="card" data-accept-card data-version-id="${escapeHtml(item.versionId)}">
    <h2>${escapeHtml(item.documentName)}</h2>
    <p class="meta">${escapeHtml(s.versionLabel)}: ${escapeHtml(item.versionLabel)}${deadline}</p>
    ${upcoming}
    ${blocking}
    <p><strong>${escapeHtml(s.changeSummary)}:</strong> ${escapeHtml(item.changeSummary)}</p>
    <a class="pdf" href="${escapeHtml(item.pdfUrl)}" target="_blank" rel="noopener">${escapeHtml(s.openPdf)}</a>
    ${action}
  </section>`;
};

/**
 * Inline JS: reads the embedded JSON (exact consent texts + localized error strings), validates
 * the signer block and POSTs `{ versionId, displayedConsentText, signerName, signerEmail }` as
 * JSON to `<current path>/acceptances` with a random Idempotency-Key per attempt.
 */
const PAGE_SCRIPT = `
(function () {
  var data = JSON.parse(document.getElementById('accept-page-data').textContent);
  var nameInput = document.getElementById('signer-name');
  var emailInput = document.getElementById('signer-email');
  var emailPattern = /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/;

  function markAccepted(card, text) {
    var button = card.querySelector('[data-accept-button]');
    var consent = card.querySelector('.consent');
    if (button) button.remove();
    if (consent) consent.remove();
    var done = document.createElement('div');
    done.className = 'accepted';
    done.textContent = text;
    card.appendChild(done);
  }

  document.querySelectorAll('[data-accept-card]').forEach(function (card) {
    var button = card.querySelector('[data-accept-button]');
    if (!button) return;
    var versionId = card.getAttribute('data-version-id');
    var checkbox = card.querySelector('[data-consent-checkbox]');
    var message = card.querySelector('[data-message]');

    function showError(text) {
      message.textContent = text;
      message.hidden = false;
    }

    button.addEventListener('click', function () {
      message.hidden = true;
      var signerName = (nameInput.value || '').trim();
      var signerEmail = (emailInput.value || '').trim();
      if (!signerName || !signerEmail) return showError(data.strings.errorMissingSigner);
      if (!emailPattern.test(signerEmail)) return showError(data.strings.errorInvalidEmail);
      // PASSIVE items have no consent checkbox — the checkbox-required check only applies when one exists.
      if (checkbox && !checkbox.checked) return showError(data.strings.errorConsentRequired);

      button.disabled = true;
      var idempotencyKey = (window.crypto && crypto.randomUUID)
        ? crypto.randomUUID()
        : String(Date.now()) + '-' + Math.random().toString(36).slice(2);
      fetch(window.location.pathname.replace(/\\/$/, '') + '/acceptances', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
        body: JSON.stringify({
          versionId: versionId,
          displayedConsentText: data.consentTexts[versionId],
          signerName: signerName,
          signerEmail: signerEmail,
        }),
      })
        .then(function (response) {
          if (response.ok) return { accepted: true };
          return response.json().then(
            function (body) { return { accepted: false, code: body && body.code }; },
            function () { return { accepted: false }; }
          );
        })
        .then(function (result) {
          if (result.accepted) return markAccepted(card, data.strings.acceptedBadge);
          if (result.code === 'ALREADY_ACCEPTED') return markAccepted(card, data.strings.errorAlreadyAccepted);
          button.disabled = false;
          if (result.code === 'VERSION_NOT_CURRENT') return showError(data.strings.errorVersionNotCurrent);
          if (result.code === 'RATE_LIMITED') return showError(data.strings.errorRateLimited);
          showError(data.strings.errorGeneric);
        })
        .catch(function () {
          button.disabled = false;
          showError(data.strings.errorGeneric);
        });
    });
  });
})();
`;

export const renderAcceptPage = (view: AcceptPageView, lang: AcceptPageLang): string => {
  const s = ACCEPT_PAGE_STRINGS[lang];
  if (view.items.length === 0) {
    return htmlShell(
      lang,
      s.pageTitle,
      `<div class="card center"><h1>${escapeHtml(s.allDoneTitle)}</h1><p class="muted">${escapeHtml(s.allDoneBody)}</p></div>`,
    );
  }

  // Any acceptable item (an ACTIVE one with consent text, or a PASSIVE one that can be opted into
  // early) needs the self-declared signer block for the POST.
  const hasAcceptableItems = view.items.some(
    (item) => (item.mode === 'ACTIVE' && item.consentText !== undefined) || item.mode === 'PASSIVE',
  );
  // Prefill (convenience only — the recorded identity stays self-declared and editable).
  const prefillName = `${view.firstName} ${view.lastName}`.trim();
  const companyContext =
    view.companyName.trim() !== ''
      ? `<p class="muted">${escapeHtml(s.companyContext.replace('{company}', view.companyName))}</p>`
      : '';
  const signerBlock = hasAcceptableItems
    ? `<section class="card">
        ${companyContext}
        <label class="field"><span>${escapeHtml(s.signerName)}</span>
          <input type="text" id="signer-name" autocomplete="name" value="${escapeHtml(prefillName)}" required></label>
        <label class="field"><span>${escapeHtml(s.signerEmail)}</span>
          <input type="email" id="signer-email" autocomplete="email" value="${escapeHtml(view.suggestedEmail)}" required></label>
        <p class="muted">${escapeHtml(s.identityNote)}</p>
      </section>`
    : '';

  const consentTexts: Record<string, string> = {};
  for (const item of view.items) {
    if (item.consentText !== undefined) {
      consentTexts[item.versionId] = item.consentText;
    }
  }
  const pageData = toJsonScript({
    consentTexts,
    strings: {
      acceptedBadge: s.acceptedBadge,
      errorMissingSigner: s.errorMissingSigner,
      errorInvalidEmail: s.errorInvalidEmail,
      errorConsentRequired: s.errorConsentRequired,
      errorAlreadyAccepted: s.errorAlreadyAccepted,
      errorVersionNotCurrent: s.errorVersionNotCurrent,
      errorRateLimited: s.errorRateLimited,
      errorGeneric: s.errorGeneric,
    },
  });

  const body = `<h1>${escapeHtml(s.heading)}</h1>
<p class="muted">${escapeHtml(s.intro.replace('{customerName}', view.customerName))}</p>
${signerBlock}
${view.items.map((item) => renderItem(item, s, lang)).join('\n')}
<script type="application/json" id="accept-page-data">${pageData}</script>
<script>${PAGE_SCRIPT}</script>`;
  return htmlShell(lang, s.pageTitle, body);
};

/** Uniform 404: identical for unknown, expired and revoked tokens (no information leak). */
export const renderLinkNotFoundPage = (lang: AcceptPageLang): string => {
  const s = ACCEPT_PAGE_STRINGS[lang];
  return htmlShell(
    lang,
    s.notFoundTitle,
    `<div class="card center"><h1>${escapeHtml(s.notFoundTitle)}</h1><p class="muted">${escapeHtml(s.notFoundBody)}</p></div>`,
  );
};

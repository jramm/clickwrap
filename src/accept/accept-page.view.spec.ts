import type { AcceptPageItem, AcceptPageView } from './accept-page.service';
import { escapeHtml, renderAcceptPage, renderLinkNotFoundPage } from './accept-page.view';
import { resolveAcceptPageLang } from './i18n';

const anItem = (overrides: Partial<AcceptPageItem> = {}): AcceptPageItem => ({
  versionId: 'v-1',
  documentName: 'DPA — Customers',
  documentType: 'dpa',
  audience: 'customer',
  versionLabel: 'June 2026 edition',
  changeSummary: 'New sub-processor for e-mail delivery.',
  pdfUrl: 'https://storage.example/presigned/v-1',
  mode: 'ACTIVE',
  consentText: 'I have read the new revision and agree.',
  deadlineAt: new Date('2026-07-22T08:00:00Z'),
  blocking: false,
  upcoming: false,
  validFrom: new Date('2026-07-01T00:00:00Z'),
  ...overrides,
});

const aView = (overrides: Partial<AcceptPageView> = {}): AcceptPageView => ({
  linkId: 'al-1',
  customerName: 'Acme GmbH',
  firstName: 'Jane',
  lastName: 'Doe',
  companyName: 'Acme GmbH',
  suggestedEmail: 'jane@customer.example',
  items: [anItem()],
  ...overrides,
});

describe('escapeHtml', () => {
  it('escapes all HTML-relevant characters', () => {
    expect(escapeHtml(`<script>alert("x&y'z")</script>`)).toBe(
      '&lt;script&gt;alert(&quot;x&amp;y&#39;z&quot;)&lt;/script&gt;',
    );
  });
});

describe('renderAcceptPage', () => {
  it('is a self-contained document: no external scripts/styles/images', () => {
    const html = renderAcceptPage(aView(), 'en');
    expect(html).not.toMatch(/<script[^>]+src=/);
    expect(html).not.toMatch(/<link[^>]+href=/);
    expect(html).not.toMatch(/<img/);
    expect(html).toContain('<style>');
    expect(html).toContain('name="viewport"');
  });

  it('renders document name, version label, change summary, PDF link, consent text and signer inputs', () => {
    const html = renderAcceptPage(aView(), 'en');
    expect(html).toContain('DPA — Customers');
    expect(html).toContain('June 2026 edition');
    expect(html).toContain('New sub-processor for e-mail delivery.');
    expect(html).toContain('https://storage.example/presigned/v-1');
    expect(html).toContain('I have read the new revision and agree.');
    expect(html).toContain('id="signer-name"');
    expect(html).toContain('id="signer-email"');
    expect(html).toContain('Acme GmbH');
  });

  it('prefills the signer name/e-mail inputs and shows the company as context (still editable)', () => {
    const html = renderAcceptPage(
      aView({ firstName: 'Jane', lastName: 'Doe', companyName: 'Acme GmbH', suggestedEmail: 'jane@acme.example' }),
      'en',
    );
    expect(html).toContain('id="signer-name" autocomplete="name" value="Jane Doe"');
    expect(html).toContain('id="signer-email" autocomplete="email" value="jane@acme.example"');
    expect(html).toContain('On behalf of Acme GmbH');
  });

  it('omits the company context line when no company is known', () => {
    const html = renderAcceptPage(aView({ companyName: '', firstName: 'Jane', lastName: 'Doe' }), 'en');
    expect(html).not.toContain('On behalf of');
    expect(html).toContain('value="Jane Doe"');
  });

  it('embeds the exact consent text in the JSON data block (evidence cross-check basis)', () => {
    const html = renderAcceptPage(aView(), 'en');
    expect(html).toContain('"consentTexts":{"v-1":"I have read the new revision and agree."}');
  });

  it('escapes HTML in user-influenced content and keeps the JSON block script-safe', () => {
    const html = renderAcceptPage(
      aView({
        customerName: '<b>Acme</b>',
        items: [anItem({ changeSummary: '<script>alert(1)</script>', consentText: 'Text with </script> inside.' })],
      }),
      'en',
    );
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('<b>Acme</b>');
    // The embedded JSON never contains a literal "</script>".
    expect(html).toContain('\\u003c/script> inside.');
  });

  it('PASSIVE items render an accept button (no checkbox, no consent text) and keep the info + deadline', () => {
    const html = renderAcceptPage(aView({ items: [anItem({ mode: 'PASSIVE', consentText: undefined })] }), 'en');
    expect(html).toContain('data-accept-button');
    expect(html).toContain('Accept now');
    expect(html).not.toContain('type="checkbox"'); // no consent checkbox rendered for PASSIVE
    expect(html).toContain('takes effect automatically');
    expect(html).toContain('2026-07-22');
  });

  it('a PASSIVE-only view still shows the signer block (needed for the early-acceptance POST)', () => {
    const html = renderAcceptPage(aView({ items: [anItem({ mode: 'PASSIVE', consentText: undefined })] }), 'en');
    expect(html).toContain('id="signer-name"');
    expect(html).toContain('id="signer-email"');
    // No consent text is embedded for a PASSIVE item.
    expect(html).toContain('"consentTexts":{}');
  });

  it('renders the German PASSIVE accept button label', () => {
    const html = renderAcceptPage(aView({ items: [anItem({ mode: 'PASSIVE', consentText: undefined })] }), 'de');
    expect(html).toContain('Jetzt akzeptieren');
  });

  it('blocking items carry the block warning', () => {
    const html = renderAcceptPage(aView({ items: [anItem({ blocking: true })] }), 'en');
    expect(html).toContain('Access is currently blocked');
  });

  it('upcoming items show the "valid from" note with the localized date (en + de)', () => {
    const upcomingItem = anItem({ upcoming: true, validFrom: new Date('2026-08-01T00:00:00Z') });
    const en = renderAcceptPage(aView({ items: [upcomingItem] }), 'en');
    expect(en).toContain('Valid from 2026-08-01');
    const de = renderAcceptPage(aView({ items: [upcomingItem] }), 'de');
    expect(de).toContain('Gültig ab 01.08.2026');
  });

  it('current (non-upcoming) items do not show a "valid from" note', () => {
    const html = renderAcceptPage(aView({ items: [anItem()] }), 'en');
    expect(html).not.toContain('Valid from');
  });

  it('renders the friendly all-accepted page when nothing is pending', () => {
    const html = renderAcceptPage(aView({ items: [] }), 'en');
    expect(html).toContain('Everything is accepted');
    expect(html).not.toContain('data-accept-card');
  });

  it('renders German (lang=de, incl. date format)', () => {
    const html = renderAcceptPage(aView(), 'de');
    expect(html).toContain('<html lang="de">');
    expect(html).toContain('Dokumente zur Prüfung');
    expect(html).toContain('Ich stimme zu');
    expect(html).toContain('22.07.2026');
  });
});

describe('renderLinkNotFoundPage', () => {
  it('is a friendly, uniform page in both languages', () => {
    expect(renderLinkNotFoundPage('en')).toContain('Link not available');
    expect(renderLinkNotFoundPage('de')).toContain('Link nicht verfügbar');
  });
});

describe('resolveAcceptPageLang', () => {
  it.each([
    ['de', undefined, 'de'],
    ['en', 'de-DE', 'en'], // explicit query wins
    [undefined, 'de-DE,de;q=0.9,en;q=0.8', 'de'],
    [undefined, 'fr-FR,fr;q=0.9,en-US;q=0.8', 'en'],
    [undefined, 'fr-FR', 'en'], // unsupported → default en
    [undefined, undefined, 'en'],
    ['fr', undefined, 'en'], // unsupported query → fall through to default
  ])('query=%p accept-language=%p → %s', (query, header, expected) => {
    expect(resolveAcceptPageLang(query, header)).toBe(expected);
  });
});

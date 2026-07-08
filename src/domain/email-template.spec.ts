import { FixedClock } from './clock';
import {
  DEFAULT_ACCEPTANCE_CONFIRMATION_TEMPLATE_ID,
  DEFAULT_NOTIFICATION_TEMPLATE_ID,
  DEFAULT_REMINDER_TEMPLATE_ID,
  EMAIL_TEMPLATE_VARIABLES,
  countDesignContentBlocks,
  defaultEmailTemplates,
  defaultTemplateIdForKind,
  deriveTextFromHtml,
  emptyTemplateVars,
  isDefaultEmailTemplateId,
  renderTemplate,
} from './email-template';
import type { TemplateVars } from './email-template';

const vars = (overrides: Partial<TemplateVars> = {}): TemplateVars => ({
  ...emptyTemplateVars(),
  customerName: 'Acme GmbH',
  documentName: 'Data Processing Agreement',
  documentType: 'DPA',
  audience: 'Customers',
  versionLabel: 'June 2026 edition',
  changeSummary: 'New sub-processor.',
  validFrom: '2026-07-01',
  deadlineAt: '2026-07-21',
  acceptedAt: '2026-07-08T14:12:03.000Z',
  acceptanceLink: 'https://clickwrap.example.org/accept/tok',
  documentPdfUrl: 'https://clickwrap.example.org/documents/dpa/customer/latest.pdf',
  appName: 'Clickwrap',
  ...overrides,
});

describe('renderTemplate', () => {
  it('substitutes known {{placeholders}} in subject (plain) and html', () => {
    const out = renderTemplate(
      { subject: 'Hi {{customerName}} — {{versionLabel}}', html: '<p>See {{documentName}}.</p>' },
      vars(),
    );
    expect(out.subject).toBe('Hi Acme GmbH — June 2026 edition');
    expect(out.html).toBe('<p>See Data Processing Agreement.</p>');
  });

  it('HTML-escapes substituted VALUES in html but not the surrounding markup', () => {
    const out = renderTemplate(
      { subject: '', html: '<p>{{customerName}}</p>' },
      vars({ customerName: 'A & B <script>' }),
    );
    expect(out.html).toBe('<p>A &amp; B &lt;script&gt;</p>');
  });

  it('does not HTML-escape subject values', () => {
    const out = renderTemplate({ subject: '{{customerName}}', html: '' }, vars({ customerName: 'A & B' }));
    expect(out.subject).toBe('A & B');
  });

  it('leaves unknown placeholders visible so authors notice typos', () => {
    const out = renderTemplate({ subject: 'Hi {{typo}}', html: '<p>{{alsoWrong}}</p>' }, vars());
    expect(out.subject).toBe('Hi {{typo}}');
    expect(out.html).toBe('<p>{{alsoWrong}}</p>');
  });

  it('derives a text part with anchor hrefs preserved as "label (url)"', () => {
    const out = renderTemplate(
      { subject: '', html: '<p>Hello</p><a href="{{acceptanceLink}}">Accept</a>' },
      vars(),
    );
    expect(out.text).toBe('Hello\nAccept (https://clickwrap.example.org/accept/tok)');
  });
});

describe('deriveTextFromHtml', () => {
  it('strips tags, keeps links, decodes entities and collapses blank lines', () => {
    const text = deriveTextFromHtml('<p>A &amp; B</p><p></p><p>C</p><a href="https://x.test">go</a>');
    expect(text).toBe('A & B\n\nC\ngo (https://x.test)');
  });

  it('emits a bare url when the anchor label equals the href', () => {
    expect(deriveTextFromHtml('<a href="https://x.test">https://x.test</a>')).toBe('https://x.test');
  });
});

describe('default templates', () => {
  it('ships notification, reminder and acceptance-confirmation templates with fixed ids and design+html', () => {
    const templates = defaultEmailTemplates(new FixedClock(new Date('2026-07-08T00:00:00Z')));
    const byId = new Map(templates.map((t) => [t.id, t]));
    expect(templates).toHaveLength(3);
    expect(byId.get(DEFAULT_NOTIFICATION_TEMPLATE_ID)?.kind).toBe('VERSION_NOTIFICATION');
    expect(byId.get(DEFAULT_REMINDER_TEMPLATE_ID)?.kind).toBe('REMINDER');
    expect(byId.get(DEFAULT_ACCEPTANCE_CONFIRMATION_TEMPLATE_ID)?.kind).toBe('ACCEPTANCE_CONFIRMATION');
    for (const t of templates) {
      expect(t.html).toContain('{{acceptanceLink}}');
      expect(t.html).toContain('{{documentPdfUrl}}');
      expect(() => JSON.parse(t.design)).not.toThrow();
    }
  });

  it('each default design is block-structured (more than one content block, not a single HTML blob)', () => {
    const templates = defaultEmailTemplates(new FixedClock(new Date('2026-07-08T00:00:00Z')));
    for (const t of templates) {
      expect(countDesignContentBlocks(t.design)).toBeGreaterThan(1);
    }
  });

  it('the new name placeholders are supported and render (firstName/lastName/companyName)', () => {
    for (const name of ['firstName', 'lastName', 'companyName'] as const) {
      expect(EMAIL_TEMPLATE_VARIABLES).toContain(name);
    }
    const out = renderTemplate(
      { subject: '{{firstName}} {{lastName}}', html: '<p>{{companyName}}</p>' },
      vars({ firstName: 'Jane', lastName: 'Doe', companyName: 'Acme GmbH' }),
    );
    expect(out.subject).toBe('Jane Doe');
    expect(out.html).toBe('<p>Acme GmbH</p>');
  });

  it('the acceptance-confirmation default uses the {{acceptedAt}} placeholder', () => {
    const templates = defaultEmailTemplates(new FixedClock(new Date('2026-07-08T00:00:00Z')));
    const confirmation = templates.find((t) => t.id === DEFAULT_ACCEPTANCE_CONFIRMATION_TEMPLATE_ID);
    expect(confirmation?.html).toContain('{{acceptedAt}}');
  });

  it('maps each kind to its default template id', () => {
    expect(defaultTemplateIdForKind('VERSION_NOTIFICATION')).toBe(DEFAULT_NOTIFICATION_TEMPLATE_ID);
    expect(defaultTemplateIdForKind('REMINDER')).toBe(DEFAULT_REMINDER_TEMPLATE_ID);
    expect(defaultTemplateIdForKind('ACCEPTANCE_CONFIRMATION')).toBe(
      DEFAULT_ACCEPTANCE_CONFIRMATION_TEMPLATE_ID,
    );
  });

  it('default html placeholders are all supported variables', () => {
    const supported = new Set<string>(EMAIL_TEMPLATE_VARIABLES);
    const templates = defaultEmailTemplates(new FixedClock(new Date()));
    for (const t of templates) {
      const used = [...`${t.subject} ${t.html}`.matchAll(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g)].map((m) => m[1]);
      for (const name of used) {
        expect(supported.has(name)).toBe(true);
      }
    }
  });

  it('a rendered default notification contains the CTA href and no stray placeholders', () => {
    const [notification] = defaultEmailTemplates(new FixedClock(new Date()));
    const out = renderTemplate(notification, vars());
    expect(out.html).toContain('href="https://clickwrap.example.org/accept/tok"');
    expect(out.html).not.toContain('{{');
    expect(out.text).toContain('Review & accept (https://clickwrap.example.org/accept/tok)');
  });

  it('recognises the default template ids', () => {
    expect(isDefaultEmailTemplateId(DEFAULT_NOTIFICATION_TEMPLATE_ID)).toBe(true);
    expect(isDefaultEmailTemplateId(DEFAULT_REMINDER_TEMPLATE_ID)).toBe(true);
    expect(isDefaultEmailTemplateId(DEFAULT_ACCEPTANCE_CONFIRMATION_TEMPLATE_ID)).toBe(true);
    expect(isDefaultEmailTemplateId('tpl-custom')).toBe(false);
  });
});

/**
 * Pure e-mail template rendering + the built-in default templates.
 * No Nest/Prisma imports (CONVENTIONS: domain is pure); time via the injected {@link Clock}.
 *
 * A template stores the Unlayer `design` JSON (for re-editing) and the exported `html`. Rendering
 * substitutes `{{placeholder}}` values into the subject (plain) and the html (values HTML-escaped;
 * the authored markup is trusted) and derives the plain-text part from the substituted html.
 */
import type { Clock } from './clock';
import type { EmailTemplate, EmailTemplateKind } from './types';

/**
 * Supported template variables (documented in docs/API.md and surfaced as Unlayer merge tags in
 * the admin editor). Every value is a plain string; `acceptanceLink` and `documentPdfUrl` are ''
 * when not applicable/available. `customerName` is the DERIVED display name (see
 * customerDisplayName: `companyName` if set, else `${firstName} ${lastName}`); `firstName`,
 * `lastName` and `companyName` are the raw customer fields (`companyName` is '' when absent).
 */
export const EMAIL_TEMPLATE_VARIABLES = [
  'customerName',
  'firstName',
  'lastName',
  'companyName',
  'documentName',
  'documentType',
  'audience',
  'versionLabel',
  'changeSummary',
  'validFrom',
  'deadlineAt',
  'acceptedAt',
  'acceptanceLink',
  'documentPdfUrl',
  'appName',
] as const;

export type EmailTemplateVariable = (typeof EMAIL_TEMPLATE_VARIABLES)[number];
export type TemplateVars = Record<EmailTemplateVariable, string>;

/** All supported variables initialised to '' — a base for building a concrete var set. */
export const emptyTemplateVars = (): TemplateVars =>
  Object.fromEntries(EMAIL_TEMPLATE_VARIABLES.map((name) => [name, ''])) as TemplateVars;

export interface RenderedTemplate {
  subject: string;
  html: string;
  text: string;
}

const PLACEHOLDER = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

/** HTML-escapes a substituted VALUE (never the surrounding authored markup). */
const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

/**
 * Substitutes known `{{name}}` placeholders; unknown ones stay visible as `{{name}}` (so authors
 * notice typos). When `escape` is set, substituted values are HTML-escaped.
 */
const substitute = (template: string, vars: TemplateVars, escape: boolean): string =>
  template.replace(PLACEHOLDER, (_match, name: string) => {
    if (!Object.prototype.hasOwnProperty.call(vars, name)) {
      return `{{${name}}}`;
    }
    const value = vars[name as EmailTemplateVariable];
    return escape ? escapeHtml(value) : value;
  });

/** Decodes the handful of HTML entities the derivation produces, back to text. */
const decodeEntities = (input: string): string =>
  input
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");

/**
 * Derives a readable plain-text part from (already-substituted) e-mail HTML: anchors become
 * `label (href)` so links survive, block elements become line breaks, remaining tags are stripped
 * and entities decoded. Deliberately small (no external html-to-text dependency).
 */
export const deriveTextFromHtml = (html: string): string => {
  const withLinks = html.replace(
    /<a\b[^>]*href=["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi,
    (_m, href: string, inner: string) => {
      const label = inner.replace(/<[^>]+>/g, '').trim();
      const url = decodeEntities(href).trim();
      if (url === '') {
        return label;
      }
      return label === '' || label === url ? url : `${label} (${url})`;
    },
  );
  const withBreaks = withLinks
    .replace(/<\s*br\s*\/?\s*>/gi, '\n')
    .replace(/<\/\s*(p|div|tr|h[1-6]|li|table)\s*>/gi, '\n');
  const stripped = decodeEntities(withBreaks.replace(/<[^>]+>/g, ''));
  return stripped
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
};

/** Substitutes placeholders into subject + html and derives the text part. */
export const renderTemplate = (
  template: Pick<EmailTemplate, 'subject' | 'html'>,
  vars: TemplateVars,
): RenderedTemplate => {
  const subject = substitute(template.subject, vars, false);
  const html = substitute(template.html, vars, true);
  return { subject, html, text: deriveTextFromHtml(html) };
};

// --- Built-in default templates (seeded as real, editable rows) -------------------------------

export const DEFAULT_NOTIFICATION_TEMPLATE_ID = 'tpl-default-notification';
export const DEFAULT_REMINDER_TEMPLATE_ID = 'tpl-default-reminder';
export const DEFAULT_ACCEPTANCE_CONFIRMATION_TEMPLATE_ID = 'tpl-default-acceptance-confirmation';

const DEFAULT_TEMPLATE_ID_BY_KIND: Record<EmailTemplateKind, string> = {
  VERSION_NOTIFICATION: DEFAULT_NOTIFICATION_TEMPLATE_ID,
  REMINDER: DEFAULT_REMINDER_TEMPLATE_ID,
  ACCEPTANCE_CONFIRMATION: DEFAULT_ACCEPTANCE_CONFIRMATION_TEMPLATE_ID,
};

const DEFAULT_TEMPLATE_IDS = new Set<string>(Object.values(DEFAULT_TEMPLATE_ID_BY_KIND));

/** The built-in default rows may be edited but never deleted (INVALID_STATE). */
export const isDefaultEmailTemplateId = (id: string): boolean => DEFAULT_TEMPLATE_IDS.has(id);

/** The default template used when a document type has no assignment for the given kind. */
export const defaultTemplateIdForKind = (kind: EmailTemplateKind): string =>
  DEFAULT_TEMPLATE_ID_BY_KIND[kind];

// --- Block-structured default designs ---------------------------------------------------------
//
// The default templates are authored as PROPER Unlayer BLOCK designs: each `DefaultBlock` maps to
// exactly ONE editor content block (heading / text / button / divider) inside its own row, so a
// legal admin can edit them block-by-block in the drag-and-drop editor. Both the stored `design`
// JSON and the exported `html` are derived from the SAME block list (buildDefaultTemplate) so they
// stay consistent, and the render pipeline substitutes placeholders in the exported `html`.

/** One content block of a default template. */
type DefaultBlock =
  | { type: 'heading'; text: string }
  | { type: 'text'; html: string }
  | { type: 'button'; href: string; label: string }
  | { type: 'divider' }
  | { type: 'footer'; html: string };

/** The matching HTML row for a block — the exported html is the concatenation of these. */
const blockToHtmlRow = (block: DefaultBlock): string => {
  switch (block.type) {
    case 'heading':
      return `<tr><td style="background:#1f2937;padding:20px 32px;color:#ffffff;font-size:18px;font-weight:bold;">${block.text}</td></tr>`;
    case 'text':
      return `<tr><td style="padding:8px 32px;font-size:15px;line-height:1.5;">${block.html}</td></tr>`;
    case 'button':
      return (
        '<tr><td style="padding:8px 32px 24px;">' +
        '<table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="border-radius:6px;background:#2563eb;">' +
        `<a href="${block.href}" style="display:inline-block;padding:12px 24px;color:#ffffff;text-decoration:none;font-size:15px;font-weight:bold;">${block.label}</a>` +
        '</td></tr></table></td></tr>'
      );
    case 'divider':
      return '<tr><td style="padding:8px 32px;"><hr style="border:0;border-top:1px solid #e5e7eb;margin:0;"></td></tr>';
    case 'footer':
      return `<tr><td style="padding:20px 32px;background:#f9fafb;font-size:12px;color:#6b7280;">${block.html}</td></tr>`;
  }
};

/** The matching Unlayer content object for a block (one content per row/column). */
const blockToContent = (block: DefaultBlock, index: number): Record<string, unknown> => {
  const id = `content-${index}`;
  switch (block.type) {
    case 'heading':
      return {
        id,
        type: 'heading',
        values: { headingType: 'h1', text: block.text, fontSize: '20px', color: '#ffffff' },
      };
    case 'text':
    case 'footer':
      return { id, type: 'text', values: { text: block.html } };
    case 'button':
      return {
        id,
        type: 'button',
        values: {
          text: block.label,
          href: { name: 'web', values: { href: block.href, target: '_blank' } },
          buttonColors: { color: '#ffffff', backgroundColor: '#2563eb' },
        },
      };
    case 'divider':
      return {
        id,
        type: 'divider',
        values: { border: { borderTopWidth: '1px', borderTopStyle: 'solid', borderTopColor: '#e5e7eb' } },
      };
  }
};

/** Wraps the block HTML rows into a self-contained, mobile-friendly e-mail document. */
const shellHtml = (rows: string[]): string =>
  [
    '<!DOCTYPE html>',
    '<html><body style="margin:0;padding:0;background:#f4f5f7;font-family:Arial,Helvetica,sans-serif;color:#1a1a1a;">',
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:24px 0;">',
    '<tr><td align="center">',
    '<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:8px;overflow:hidden;">',
    ...rows,
    '</table></td></tr></table></body></html>',
  ].join('\n');

/** Builds the block-structured `design` (multiple content blocks) + the matching exported `html`. */
const buildDefaultTemplate = (blocks: DefaultBlock[]): { design: string; html: string } => {
  const rows = blocks.map((block, index) => ({
    id: `row-${index}`,
    cells: [1],
    columns: [{ id: `col-${index}`, contents: [blockToContent(block, index)], values: {} }],
    values: {},
  }));
  const design = JSON.stringify({
    counters: {
      u_row: blocks.length,
      u_column: blocks.length,
      u_content_heading: 1,
      u_content_text: 1,
      u_content_button: 1,
      u_content_divider: 1,
    },
    body: { id: 'default-body', rows, values: { contentWidth: '600px' } },
    schemaVersion: 16,
  });
  return { design, html: shellHtml(blocks.map(blockToHtmlRow)) };
};

const greetingBlock: DefaultBlock = {
  type: 'text',
  html: '<p style="margin:0;">Hello {{customerName}},</p>',
};

/** Footer referencing the company, the app and the document copy. */
const footerBlock: DefaultBlock = {
  type: 'footer',
  html:
    'This message was sent to {{companyName}} on behalf of {{appName}}. ' +
    'A copy of the document is available at {{documentPdfUrl}}.',
};

const notificationBlocks = (intro: string): DefaultBlock[] => [
  { type: 'heading', text: '{{appName}}' },
  greetingBlock,
  { type: 'text', html: `<p style="margin:0;">${intro}</p>` },
  { type: 'text', html: '<p style="margin:0;">{{changeSummary}}</p>' },
  { type: 'button', href: '{{acceptanceLink}}', label: 'Review & accept' },
  {
    type: 'text',
    html:
      '<p style="margin:0 0 8px;color:#4b5563;">You can read the full document here:</p>' +
      '<p style="margin:0;"><a href="{{documentPdfUrl}}" style="color:#2563eb;">{{documentPdfUrl}}</a></p>',
  },
  { type: 'divider' },
  footerBlock,
];

const confirmationBlocks = (): DefaultBlock[] => [
  { type: 'heading', text: '{{appName}}' },
  greetingBlock,
  {
    type: 'text',
    html:
      '<p style="margin:0;">Thank you — we have recorded your acceptance of {{documentName}} ' +
      '({{documentType}}), version {{versionLabel}}, on {{acceptedAt}}.</p>',
  },
  {
    type: 'text',
    html: '<p style="margin:0;">A copy of the accepted document is attached to this e-mail for your records.</p>',
  },
  {
    type: 'text',
    html:
      '<p style="margin:0 0 8px;color:#4b5563;">You can also download it here:</p>' +
      '<p style="margin:0;"><a href="{{documentPdfUrl}}" style="color:#2563eb;">{{documentPdfUrl}}</a></p>',
  },
  { type: 'button', href: '{{acceptanceLink}}', label: 'Manage your agreements' },
  { type: 'divider' },
  footerBlock,
];

/** The three built-in templates, timestamped via the clock (idempotent seeding uses the fixed ids). */
export const defaultEmailTemplates = (clock: Clock): EmailTemplate[] => {
  const now = clock.now();
  const notification = buildDefaultTemplate(
    notificationBlocks(
      'A new version of {{documentName}} ({{documentType}}) is now available: {{versionLabel}}, effective {{validFrom}}.',
    ),
  );
  const reminder = buildDefaultTemplate(
    notificationBlocks(
      '{{documentName}} ({{versionLabel}}) is still awaiting your acceptance. The deadline is {{deadlineAt}}.',
    ),
  );
  const confirmation = buildDefaultTemplate(confirmationBlocks());
  return [
    {
      id: DEFAULT_NOTIFICATION_TEMPLATE_ID,
      name: 'Default — version notification',
      kind: 'VERSION_NOTIFICATION',
      subject: '{{appName}}: new version of {{documentName}} — {{versionLabel}}',
      design: notification.design,
      html: notification.html,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: DEFAULT_REMINDER_TEMPLATE_ID,
      name: 'Default — reminder',
      kind: 'REMINDER',
      subject: 'Reminder: please accept {{documentName}} — {{versionLabel}}',
      design: reminder.design,
      html: reminder.html,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: DEFAULT_ACCEPTANCE_CONFIRMATION_TEMPLATE_ID,
      name: 'Default — acceptance confirmation',
      kind: 'ACCEPTANCE_CONFIRMATION',
      subject: '{{appName}}: your acceptance of {{documentName}} — {{versionLabel}}',
      design: confirmation.design,
      html: confirmation.html,
      createdAt: now,
      updatedAt: now,
    },
  ];
};

/** Number of content blocks in a serialised default design (for tests / block-structure checks). */
export const countDesignContentBlocks = (design: string): number => {
  const parsed = JSON.parse(design) as {
    body?: { rows?: { columns?: { contents?: unknown[] }[] }[] };
  };
  let count = 0;
  for (const row of parsed.body?.rows ?? []) {
    for (const column of row.columns ?? []) {
      count += column.contents?.length ?? 0;
    }
  }
  return count;
};

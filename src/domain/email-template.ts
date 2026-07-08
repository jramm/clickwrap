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
 * when not applicable/available.
 */
export const EMAIL_TEMPLATE_VARIABLES = [
  'customerName',
  'documentName',
  'documentType',
  'audience',
  'versionLabel',
  'changeSummary',
  'validFrom',
  'deadlineAt',
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

const DEFAULT_TEMPLATE_IDS = new Set<string>([
  DEFAULT_NOTIFICATION_TEMPLATE_ID,
  DEFAULT_REMINDER_TEMPLATE_ID,
]);

/** The built-in default rows may be edited but never deleted (INVALID_STATE). */
export const isDefaultEmailTemplateId = (id: string): boolean => DEFAULT_TEMPLATE_IDS.has(id);

/** The default template used when a document type has no assignment for the given kind. */
export const defaultTemplateIdForKind = (kind: EmailTemplateKind): string =>
  kind === 'VERSION_NOTIFICATION' ? DEFAULT_NOTIFICATION_TEMPLATE_ID : DEFAULT_REMINDER_TEMPLATE_ID;

/** A clean, self-contained default e-mail HTML shared by both default templates. */
const defaultHtml = (intro: string, ctaLabel: string): string =>
  [
    '<!DOCTYPE html>',
    '<html><body style="margin:0;padding:0;background:#f4f5f7;font-family:Arial,Helvetica,sans-serif;color:#1a1a1a;">',
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:24px 0;">',
    '<tr><td align="center">',
    '<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:8px;overflow:hidden;">',
    '<tr><td style="background:#1f2937;padding:20px 32px;color:#ffffff;font-size:18px;font-weight:bold;">{{appName}}</td></tr>',
    '<tr><td style="padding:32px;">',
    '<p style="margin:0 0 16px;font-size:15px;">Hello {{customerName}},</p>',
    `<p style="margin:0 0 16px;font-size:15px;line-height:1.5;">${intro}</p>`,
    '<p style="margin:0 0 24px;font-size:15px;line-height:1.5;">{{changeSummary}}</p>',
    '<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 24px;"><tr><td style="border-radius:6px;background:#2563eb;">',
    `<a href="{{acceptanceLink}}" style="display:inline-block;padding:12px 24px;color:#ffffff;text-decoration:none;font-size:15px;font-weight:bold;">${ctaLabel}</a>`,
    '</td></tr></table>',
    '<p style="margin:0 0 8px;font-size:14px;color:#4b5563;">You can read the full document here:</p>',
    '<p style="margin:0 0 24px;font-size:14px;"><a href="{{documentPdfUrl}}" style="color:#2563eb;">{{documentPdfUrl}}</a></p>',
    '</td></tr>',
    '<tr><td style="padding:20px 32px;background:#f9fafb;font-size:12px;color:#6b7280;">You receive this e-mail because your organisation has an agreement managed via {{appName}}.</td></tr>',
    '</table></td></tr></table></body></html>',
  ].join('\n');

/**
 * A minimal but valid Unlayer design that wraps the exported html as a single HTML content block,
 * so the default templates open (and stay editable) in the react-email-editor like any other row.
 */
const designForHtml = (html: string): string =>
  JSON.stringify({
    counters: { u_column: 1, u_row: 1, u_content_html: 1 },
    body: {
      id: 'default-body',
      rows: [
        {
          id: 'default-row',
          cells: [1],
          columns: [
            {
              id: 'default-col',
              contents: [{ id: 'default-html', type: 'html', values: { html } }],
              values: {},
            },
          ],
          values: {},
        },
      ],
      values: { contentWidth: '600px' },
    },
    schemaVersion: 16,
  });

/** The two built-in templates, timestamped via the clock (idempotent seeding uses the fixed ids). */
export const defaultEmailTemplates = (clock: Clock): EmailTemplate[] => {
  const now = clock.now();
  const notificationHtml = defaultHtml(
    'A new version of {{documentName}} ({{documentType}}) is now available: {{versionLabel}}, effective {{validFrom}}.',
    'Review & accept',
  );
  const reminderHtml = defaultHtml(
    '{{documentName}} ({{versionLabel}}) is still awaiting your acceptance. The deadline is {{deadlineAt}}.',
    'Review & accept',
  );
  return [
    {
      id: DEFAULT_NOTIFICATION_TEMPLATE_ID,
      name: 'Default — version notification',
      kind: 'VERSION_NOTIFICATION',
      subject: '{{appName}}: new version of {{documentName}} — {{versionLabel}}',
      design: designForHtml(notificationHtml),
      html: notificationHtml,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: DEFAULT_REMINDER_TEMPLATE_ID,
      name: 'Default — reminder',
      kind: 'REMINDER',
      subject: 'Reminder: please accept {{documentName}} — {{versionLabel}}',
      design: designForHtml(reminderHtml),
      html: reminderHtml,
      createdAt: now,
      updatedAt: now,
    },
  ];
};

/**
 * E-mail template kinds and their i18n label keys — mirrors the backend
 * (src/domain/types.ts::EmailTemplateKind). Kept in one place so the templates list, the editor
 * dialog and the per-document-type assignment selects stay in sync.
 */
import type { EmailTemplateKind } from '../api/hooks';

export const EMAIL_TEMPLATE_KINDS: readonly EmailTemplateKind[] = [
  'VERSION_NOTIFICATION',
  'REMINDER',
  'ACCEPTANCE_CONFIRMATION',
];

const KIND_LABEL_KEY: Record<EmailTemplateKind, string> = {
  VERSION_NOTIFICATION: 'emailTemplates.kindNotification',
  REMINDER: 'emailTemplates.kindReminder',
  ACCEPTANCE_CONFIRMATION: 'emailTemplates.kindAcceptanceConfirmation',
};

export const kindLabelKey = (kind: EmailTemplateKind): string => KIND_LABEL_KEY[kind];

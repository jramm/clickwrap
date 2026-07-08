/**
 * The e-mail template placeholder variables — mirrors the backend
 * (src/domain/email-template.ts::EMAIL_TEMPLATE_VARIABLES). Surfaced in the editor as Unlayer
 * merge tags and in the dialog helper text.
 */
export const PLACEHOLDER_VARIABLES = [
  'customerName',
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

export type PlaceholderVariable = (typeof PLACEHOLDER_VARIABLES)[number];

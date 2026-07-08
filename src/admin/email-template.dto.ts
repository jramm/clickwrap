/**
 * Request schemas for e-mail template administration and per-document-type assignment
 * (zod, `.strict()` — unknown fields → 400).
 */
import { z } from 'zod';

const emailTemplateKind = z.enum(['VERSION_NOTIFICATION', 'REMINDER', 'ACCEPTANCE_CONFIRMATION']);

export const createEmailTemplateBodySchema = z
  .object({
    name: z.string().min(1),
    kind: emailTemplateKind,
    subject: z.string(),
    design: z.string(),
    html: z.string(),
  })
  .strict();
export type CreateEmailTemplateBody = z.infer<typeof createEmailTemplateBodySchema>;

export const updateEmailTemplateBodySchema = z
  .object({
    name: z.string().min(1).optional(),
    kind: emailTemplateKind.optional(),
    subject: z.string().optional(),
    design: z.string().optional(),
    html: z.string().optional(),
  })
  .strict();
export type UpdateEmailTemplateBody = z.infer<typeof updateEmailTemplateBodySchema>;

export const emailTemplatePreviewBodySchema = z
  .object({
    documentTypeKey: z.string().optional(),
  })
  .strict();
export type EmailTemplatePreviewBody = z.infer<typeof emailTemplatePreviewBodySchema>;

/** `null` clears an assignment; a string assigns; an omitted field keeps the current value. */
export const updateDocumentTypeBodySchema = z
  .object({
    name: z.string().optional(),
    notificationTemplateId: z.string().nullable().optional(),
    reminderTemplateId: z.string().nullable().optional(),
    acceptanceConfirmationTemplateId: z.string().nullable().optional(),
  })
  .strict();
export type UpdateDocumentTypeBody = z.infer<typeof updateDocumentTypeBodySchema>;

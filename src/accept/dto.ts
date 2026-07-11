/**
 * Request schema of the hosted acceptance page POST. `.strict()` like the portal schemas —
 * everything except the four documented fields is rejected (the actor identity is built
 * server-side from the link + the signer fields, never taken over verbatim as an actor object).
 */
import { z } from 'zod';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const linkAcceptanceBodySchema = z
  .object({
    versionId: z.string().min(1),
    // Optional: ACTIVE versions echo the displayed consent text (cross-checked server-side); a
    // PASSIVE early acceptance has no consent checkbox and omits it. The ACTIVE requirement is
    // enforced in AcceptanceService, not by the schema.
    displayedConsentText: z.string().optional(),
    signerName: z.string().trim().min(1),
    signerEmail: z.string().trim().regex(EMAIL_PATTERN, 'invalid e-mail address'),
  })
  .strict();
export type LinkAcceptanceBody = z.infer<typeof linkAcceptanceBodySchema>;

/**
 * Objection (Widerspruch) from the hosted page. A reason is REQUIRED (#30); the signer identity is
 * optional and self-declared (recorded as objection evidence). `.strict()` rejects everything else.
 */
export const linkObjectionBodySchema = z
  .object({
    versionId: z.string().min(1),
    reason: z.string().trim().min(1, 'a reason is required'),
    signerName: z.string().trim().optional(),
    signerEmail: z.string().trim().regex(EMAIL_PATTERN, 'invalid e-mail address').optional(),
  })
  .strict();
export type LinkObjectionBody = z.infer<typeof linkObjectionBodySchema>;

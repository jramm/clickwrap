/**
 * Request schemas of the portal endpoints (zod, `.strict()`).
 * `.strict()` ensures actor/IP/UA must NEVER appear in the body — they come from the context.
 */
import { BadRequestException, PipeTransform } from '@nestjs/common';
import { z, ZodSchema } from 'zod';

export const acceptanceBodySchema = z
  .object({
    versionId: z.string().min(1),
    // Optional: required for ACTIVE versions (consent-text cross-check), omitted for a PASSIVE
    // early acceptance. The ACTIVE requirement is enforced in AcceptanceService, not by the schema.
    displayedConsentText: z.string().optional(),
  })
  .strict();
export type AcceptanceBody = z.infer<typeof acceptanceBodySchema>;

export const objectionBodySchema = z
  .object({
    versionId: z.string().min(1),
    reason: z.string().optional(),
  })
  .strict();
export type ObjectionBody = z.infer<typeof objectionBodySchema>;

export const notificationBodySchema = z
  .object({
    versionId: z.string().min(1),
    channel: z.literal('PORTAL'),
    displayedAt: z.string().datetime().optional(),
  })
  .strict();
export type NotificationBody = z.infer<typeof notificationBodySchema>;

/** Validates the body against a zod schema; errors → 400 (not a domain error). */
export class ZodBodyPipe<T> implements PipeTransform {
  constructor(private readonly schema: ZodSchema<T>) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new BadRequestException(result.error.issues);
    }
    return result.data;
  }
}

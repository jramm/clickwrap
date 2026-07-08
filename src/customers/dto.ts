/**
 * Request schemas for customer administration (zod, `.strict()`), shared by the admin API and the
 * integration API. `.strict()` rejects unknown fields (e.g. an actor smuggled into the body) → 400.
 */
import { z } from 'zod';

const acceptedVersionSchema = z
  .object({
    versionId: z.string().min(1),
    /** Signature date (ISO). Backdating is allowed for IMPORT; defaults to now. */
    acceptedAt: z.string().datetime().optional(),
    /** Evidence reference, e.g. "HubSpot deal 12345 / signed offer". */
    reference: z.string().optional(),
  })
  .strict();

export const createCustomerBodySchema = z
  .object({
    externalRef: z.string().min(1),
    firstName: z.string().optional(),
    lastName: z.string().optional(),
    companyName: z.string().optional(),
    roles: z.array(z.string()),
    contactEmails: z.array(z.string()),
    acceptedVersions: z.array(acceptedVersionSchema).optional(),
  })
  .strict();
export type CreateCustomerBody = z.infer<typeof createCustomerBodySchema>;

export const updateCustomerBodySchema = z
  .object({
    firstName: z.string().optional(),
    lastName: z.string().optional(),
    companyName: z.string().optional(),
    roles: z.array(z.string()).optional(),
    contactEmails: z.array(z.string()).optional(),
  })
  .strict();
export type UpdateCustomerBody = z.infer<typeof updateCustomerBodySchema>;

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

/**
 * Accept documents by type at a contract signing date (#29): instead of naming explicit versions,
 * the caller passes the signing date + the document types the contract covers. The customer is
 * recorded as having accepted, for each listed type (across the audiences its roles cover), the
 * document version that was effective at `effectiveDate`.
 */
const signedDocumentsSchema = z
  .object({
    /** Contract signing date (ISO) — the point in time whose effective versions are accepted. */
    effectiveDate: z.string().datetime(),
    /** Document type keys the signed contract covers (e.g. ["terms", "dpa"]). */
    documentTypes: z.array(z.string().min(1)).min(1),
    /** Evidence reference (e.g. "Signed offer / CRM deal 12345"). */
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
    signedDocuments: signedDocumentsSchema.optional(),
  })
  .strict();
export type CreateCustomerBody = z.infer<typeof createCustomerBodySchema>;

/**
 * Body of the inbound upsert `PUT /customers/by-external-ref/:externalRef`. `externalRef` is taken
 * from the path (not the body). `.strict()` rejects unknown fields (e.g. a smuggled actor) → 400.
 */
export const upsertByExternalRefBodySchema = z
  .object({
    firstName: z.string().optional(),
    lastName: z.string().optional(),
    companyName: z.string().optional(),
    contactEmails: z.array(z.string()),
    roles: z.array(z.string()),
    /** Caller's system namespace (e.g. a CRM passes `crm`); defaults to `external`. */
    source: z.string().optional(),
  })
  .strict();
export type UpsertByExternalRefBody = z.infer<typeof upsertByExternalRefBodySchema>;

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

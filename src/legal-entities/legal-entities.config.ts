/**
 * Declarative legal-entity configuration (audiences + document types) — the single source of truth
 * that the {@link LegalEntitiesReconciler} reconciles into the store on every boot.
 *
 * The config is JSON, validated with Zod (mirroring the portal DTOs). A missing or malformed config
 * FAILS THE BOOT with a clear error: an inconsistent legal-entity state must never start serving.
 */
import { readFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { z } from 'zod';
import { ENTITY_KEY_PATTERN } from '../domain/keys';

/** Default config path (relative to the process working directory), overridable via env. */
export const DEFAULT_LEGAL_ENTITIES_CONFIG_PATH = 'config/legal-entities.json';

/** Slug key — reuses the existing entity-key rule (src/domain/keys.ts). */
const entityKeySchema = z
  .string()
  .regex(ENTITY_KEY_PATTERN, `must be a slug matching ${ENTITY_KEY_PATTERN.source}`);

const audienceSchema = z
  .object({
    key: entityKeySchema,
    name: z.string().min(1, 'name is required'),
  })
  .strict();

/**
 * A document-type entry. The three template-id fields are optional (absent or `null` ⇒ the built-in
 * default template of that kind is used); `external` is optional and defaults to `false`.
 */
const documentTypeSchema = z
  .object({
    key: entityKeySchema,
    name: z.string().min(1, 'name is required'),
    external: z.boolean().optional().default(false),
    notificationTemplateId: z.string().min(1).nullish(),
    reminderTemplateId: z.string().min(1).nullish(),
    acceptanceConfirmationTemplateId: z.string().min(1).nullish(),
  })
  .strict();

export const legalEntitiesConfigSchema = z
  .object({
    audiences: z.array(audienceSchema),
    documentTypes: z.array(documentTypeSchema),
  })
  .strict();

export type LegalEntitiesConfig = z.infer<typeof legalEntitiesConfigSchema>;
export type LegalEntitiesConfigAudience = z.infer<typeof audienceSchema>;
export type LegalEntitiesConfigDocumentType = z.infer<typeof documentTypeSchema>;

/** Resolves the configured path (env `LEGAL_ENTITIES_CONFIG`) against the working directory. */
export const legalEntitiesConfigPath = (): string => {
  const configured = process.env.LEGAL_ENTITIES_CONFIG?.trim();
  const path = configured && configured.length > 0 ? configured : DEFAULT_LEGAL_ENTITIES_CONFIG_PATH;
  return isAbsolute(path) ? path : join(process.cwd(), path);
};

/**
 * Parses + validates a raw (already-JSON-parsed) config value. Throws an Error with a clear,
 * aggregated message on any schema violation (missing field, bad slug, wrong type, unknown key).
 */
export const parseLegalEntitiesConfig = (raw: unknown, source: string): LegalEntitiesConfig => {
  const result = legalEntitiesConfigSchema.safeParse(raw);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid legal-entities config (${source}): ${details}`);
  }
  return result.data;
};

/**
 * Loads + validates the config file at the given (or configured) path. A missing file or invalid
 * JSON is turned into a clear boot error (fail-fast).
 */
export const loadLegalEntitiesConfig = (path: string = legalEntitiesConfigPath()): LegalEntitiesConfig => {
  let contents: string;
  try {
    contents = readFileSync(path, 'utf8');
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Cannot read legal-entities config at "${path}": ${reason}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(contents);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Legal-entities config at "${path}" is not valid JSON: ${reason}`);
  }
  return parseLegalEntitiesConfig(parsed, path);
};

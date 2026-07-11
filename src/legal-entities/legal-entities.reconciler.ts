/**
 * Reconciles the declarative legal-entity config (audiences + document types) into the store on
 * application bootstrap — the config is the SOURCE OF TRUTH, so the entity state is reproducible on
 * every boot. Runs once, for whatever persistence driver is active (in-memory or Prisma), in the
 * real server, the seed script and the boot tests.
 *
 * Reconcile semantics (per entity kind, audiences before document types):
 *  - upsert every config entry BY KEY: create the missing ones, update a changed name / external /
 *    template-id — keeping the stored id stable (look up by key first);
 *  - for each stored entity whose key is NOT in the config: `deleteIfUnused(key)`. A still-referenced
 *    entity (by a document or a customer role) is KEPT and logged as a WARNING — never hard-deleted.
 *
 * Idempotent: a second boot with the same config performs no writes.
 */
import { Inject, Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { newId } from '../agreements/ids.js';
import type { AudienceRepo, DocumentTypeRepo } from '../domain/ports.js';
import type { Audience, DocumentTypeDef } from '../domain/types.js';
import { TOKENS } from '../persistence/tokens.js';
import {
  loadLegalEntitiesConfig,
  type LegalEntitiesConfig,
  type LegalEntitiesConfigAudience,
  type LegalEntitiesConfigDocumentType,
} from './legal-entities.config.js';

interface ReconcileCounts {
  created: number;
  updated: number;
  kept: number;
  deleted: number;
}

export interface ReconcileSummary {
  audiences: ReconcileCounts;
  documentTypes: ReconcileCounts;
}

/** null/undefined template id from the config maps to `undefined` (⇒ built-in default template). */
const normalizeTemplateId = (value: string | null | undefined): string | undefined => value ?? undefined;

@Injectable()
export class LegalEntitiesReconciler implements OnApplicationBootstrap {
  private readonly logger = new Logger(LegalEntitiesReconciler.name);

  constructor(
    @Inject(TOKENS.AudienceRepo) private readonly audiences: AudienceRepo,
    @Inject(TOKENS.DocumentTypeRepo) private readonly documentTypes: DocumentTypeRepo,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    // Fail-fast: a missing/malformed config throws here and aborts the boot.
    const config = loadLegalEntitiesConfig();
    await this.reconcile(config);
  }

  /** Reconciles the given (already validated) config into the store. Returns the change summary. */
  async reconcile(config: LegalEntitiesConfig): Promise<ReconcileSummary> {
    const audiences = await this.reconcileAudiences(config.audiences);
    const documentTypes = await this.reconcileDocumentTypes(config.documentTypes);
    this.logger.log(
      `Legal-entities reconciled — audiences: ${this.format(audiences)}; ` +
        `document types: ${this.format(documentTypes)}.`,
    );
    return { audiences, documentTypes };
  }

  private format(counts: ReconcileCounts): string {
    return `created ${counts.created}, updated ${counts.updated}, kept ${counts.kept}, deleted ${counts.deleted}`;
  }

  private async reconcileAudiences(configured: LegalEntitiesConfigAudience[]): Promise<ReconcileCounts> {
    const counts: ReconcileCounts = { created: 0, updated: 0, kept: 0, deleted: 0 };
    for (const entry of configured) {
      const existing = await this.audiences.findByKey(entry.key);
      if (!existing) {
        await this.audiences.save({ id: newId('aud'), key: entry.key, name: entry.name });
        counts.created += 1;
      } else if (this.audienceChanged(existing, entry)) {
        await this.audiences.save({ ...existing, name: entry.name });
        counts.updated += 1;
      }
    }
    const configuredKeys = new Set(configured.map((entry) => entry.key));
    for (const existing of await this.audiences.findAll()) {
      if (configuredKeys.has(existing.key)) {
        continue;
      }
      const deleted = await this.audiences.deleteIfUnused(existing.key);
      if (deleted) {
        counts.deleted += 1;
        this.logger.log(`Deleted audience "${existing.key}" (${existing.name}) — absent from config, unused.`);
      } else {
        counts.kept += 1;
        this.logger.warn(
          `Kept audience "${existing.key}" (${existing.name}) — absent from config but still referenced ` +
            'by a document or a customer role; not deleted.',
        );
      }
    }
    return counts;
  }

  private async reconcileDocumentTypes(configured: LegalEntitiesConfigDocumentType[]): Promise<ReconcileCounts> {
    const counts: ReconcileCounts = { created: 0, updated: 0, kept: 0, deleted: 0 };
    for (const entry of configured) {
      const existing = await this.documentTypes.findByKey(entry.key);
      const desired = this.toDocumentType(entry, existing);
      if (!existing) {
        await this.documentTypes.save(desired);
        counts.created += 1;
      } else if (this.documentTypeChanged(existing, entry)) {
        await this.documentTypes.save(desired);
        counts.updated += 1;
      }
    }
    const configuredKeys = new Set(configured.map((entry) => entry.key));
    for (const existing of await this.documentTypes.findAll()) {
      if (configuredKeys.has(existing.key)) {
        continue;
      }
      const deleted = await this.documentTypes.deleteIfUnused(existing.key);
      if (deleted) {
        counts.deleted += 1;
        this.logger.log(`Deleted document type "${existing.key}" (${existing.name}) — absent from config, unused.`);
      } else {
        counts.kept += 1;
        this.logger.warn(
          `Kept document type "${existing.key}" (${existing.name}) — absent from config but still ` +
            'referenced by a document; not deleted.',
        );
      }
    }
    return counts;
  }

  private toDocumentType(
    entry: LegalEntitiesConfigDocumentType,
    existing: DocumentTypeDef | undefined,
  ): DocumentTypeDef {
    return {
      id: existing?.id ?? newId('dt'),
      key: entry.key,
      name: entry.name,
      external: entry.external,
      notificationTemplateId: normalizeTemplateId(entry.notificationTemplateId),
      reminderTemplateId: normalizeTemplateId(entry.reminderTemplateId),
      acceptanceConfirmationTemplateId: normalizeTemplateId(entry.acceptanceConfirmationTemplateId),
    };
  }

  private audienceChanged(existing: Audience, entry: LegalEntitiesConfigAudience): boolean {
    return existing.name !== entry.name;
  }

  private documentTypeChanged(existing: DocumentTypeDef, entry: LegalEntitiesConfigDocumentType): boolean {
    return (
      existing.name !== entry.name ||
      (existing.external ?? false) !== entry.external ||
      (existing.notificationTemplateId ?? undefined) !== normalizeTemplateId(entry.notificationTemplateId) ||
      (existing.reminderTemplateId ?? undefined) !== normalizeTemplateId(entry.reminderTemplateId) ||
      (existing.acceptanceConfirmationTemplateId ?? undefined) !==
        normalizeTemplateId(entry.acceptanceConfirmationTemplateId)
    );
  }
}

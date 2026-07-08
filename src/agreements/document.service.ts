import { Inject, Injectable } from '@nestjs/common';
import { DomainError } from '../common/errors';
import { latestPdfPath, publicBaseUrl } from '../common/public-documents';
import { TOKENS } from '../persistence/tokens';
import type { Clock } from '../domain/clock';
import type { AgreementDocumentRepo, AgreementVersionRepo, AudienceRepo, DocumentTypeRepo } from '../domain/ports';
import type { AgreementDocument } from '../domain/types';
import { AGREEMENTS_TOKENS, type PdfStorage } from './ports';
import { toVersionDto, type VersionDto } from './version.dto';
import { newId } from './ids';

export interface CreateDocumentInput {
  /** Document type key (must exist in DocumentTypeRepo). */
  type: string;
  /** Audience key (must exist in AudienceRepo). */
  audience: string;
  name: string;
}

/** Flat document list entry including the current (applicable) version DTO for the admin UI. */
export interface DocumentListEntry {
  id: string;
  /** DocumentTypeDef key. */
  type: string;
  /** Audience key. */
  audience: string;
  name: string;
  /** The newest applicable PUBLISHED version as a DTO, or null when only drafts exist. */
  currentVersion: VersionDto | null;
  /**
   * ALL UPCOMING published versions (validFrom in the future, scheduled publish) as DTOs, ordered
   * by validFrom ASC (the nearest flip first). Empty when none are scheduled. Several future
   * versions may be scheduled at once — every one is listed, not just the next. The current version
   * stays the compliance baseline until the flip at the nearest one's validFrom.
   */
  upcomingVersions: VersionDto[];
  /**
   * Stable public URL (`${PUBLIC_BASE_URL}/documents/<type>/<audience>/latest.pdf`) that always
   * 302-redirects to the currently effective published PDF — for rendering into offers. Null
   * when no published version is in effect or PUBLIC_BASE_URL is unset.
   */
  latestPdfUrl: string | null;
}

/** Documents per (type key, audience key) — created once, listed with their current version. */
@Injectable()
export class DocumentService {
  constructor(
    @Inject(TOKENS.AgreementDocumentRepo) private readonly documents: AgreementDocumentRepo,
    @Inject(TOKENS.AgreementVersionRepo) private readonly versions: AgreementVersionRepo,
    @Inject(TOKENS.DocumentTypeRepo) private readonly documentTypes: DocumentTypeRepo,
    @Inject(TOKENS.AudienceRepo) private readonly audiences: AudienceRepo,
    @Inject(AGREEMENTS_TOKENS.PdfStorage) private readonly pdf: PdfStorage,
    @Inject(TOKENS.Clock) private readonly clock: Clock,
  ) {}

  /**
   * Once per (type, audience) — duplicate → INVALID_STATE. Both keys are validated against
   * the dynamic entities: unknown type → UNKNOWN_DOCUMENT_TYPE, unknown audience →
   * UNKNOWN_AUDIENCE (both 422).
   */
  async create(input: CreateDocumentInput): Promise<AgreementDocument> {
    if (!(await this.documentTypes.findByKey(input.type))) {
      throw new DomainError('UNKNOWN_DOCUMENT_TYPE', `Unknown document type: ${input.type}`);
    }
    if (!(await this.audiences.findByKey(input.audience))) {
      throw new DomainError('UNKNOWN_AUDIENCE', `Unknown audience: ${input.audience}`);
    }
    const existing = await this.documents.findByTypeAndAudience(input.type, input.audience);
    if (existing) {
      throw new DomainError(
        'INVALID_STATE',
        `A document for (${input.type}, ${input.audience}) already exists`,
      );
    }
    return this.documents.save({ id: newId('doc'), type: input.type, audience: input.audience, name: input.name });
  }

  async list(): Promise<DocumentListEntry[]> {
    const documents = await this.documents.findAll();
    const now = this.clock.now();
    const baseUrl = publicBaseUrl();
    return Promise.all(
      documents.map(async (document) => {
        const current = await this.versions.findCurrentPublished(document.type, document.audience, now);
        const upcoming = await this.versions.findUpcomingPublishedList(document.type, document.audience, now);
        const currentVersion = current
          ? toVersionDto(current, await this.pdf.getPresignedUrl(current.storageKey))
          : null;
        const upcomingVersions = await Promise.all(
          upcoming.map(async (v) => toVersionDto(v, await this.pdf.getPresignedUrl(v.storageKey))),
        );
        return {
          id: document.id,
          type: document.type,
          audience: document.audience,
          name: document.name,
          currentVersion,
          upcomingVersions,
          latestPdfUrl:
            current && baseUrl ? `${baseUrl}${latestPdfPath(document.type, document.audience)}` : null,
        };
      }),
    );
  }
}

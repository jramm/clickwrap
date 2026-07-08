/**
 * Public "latest PDF" resolution — backs the unauthenticated redirect endpoint
 * GET /documents/:typeKey/:audienceKey/latest.pdf (src/compliance/public-documents.controller.ts).
 *
 * Always resolves the CURRENTLY EFFECTIVE published version (findCurrentPublished) — never an
 * upcoming one (validFrom in the future): a link rendered into an offer must reference what is
 * in force at signing time. Deliberately side-effect-free: no notification/state/evidence writes
 * — acceptance happens implicitly by signing the offer and is recorded later via the
 * `acceptedVersions` import on customer creation.
 */
import { Inject, Injectable } from '@nestjs/common';
import type { Clock } from '../domain/clock';
import type { AgreementVersionRepo } from '../domain/ports';
import { TOKENS } from '../persistence/tokens';
import { PDF_URL_PROVIDER, type PdfUrlProvider } from './ports/pdf-url-provider';

@Injectable()
export class PublicDocumentsService {
  constructor(
    @Inject(TOKENS.AgreementVersionRepo) private readonly versions: AgreementVersionRepo,
    @Inject(TOKENS.Clock) private readonly clock: Clock,
    @Inject(PDF_URL_PROVIDER) private readonly pdfUrlProvider: PdfUrlProvider,
  ) {}

  /**
   * Fresh presigned URL of the currently effective published PDF, or undefined when there is
   * nothing to serve (unknown type/audience/document, no published version, or only an upcoming
   * one) — the caller renders a uniform 404 for all of these.
   */
  async resolveLatestPdfUrl(typeKey: string, audienceKey: string): Promise<string | undefined> {
    const current = await this.versions.findCurrentPublished(typeKey, audienceKey, this.clock.now());
    if (!current) {
      return undefined;
    }
    return this.pdfUrlProvider.getPresignedUrl(current.storageKey);
  }
}

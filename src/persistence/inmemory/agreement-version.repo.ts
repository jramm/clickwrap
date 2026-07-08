import { DomainError } from '../../common/errors';
import type { AgreementDocumentRepo, AgreementVersionRepo } from '../../domain/ports';
import type { AgreementVersion } from '../../domain/types';
import { deepCopy } from './clone';

export class InMemoryAgreementVersionRepo implements AgreementVersionRepo {
  private readonly versions = new Map<string, AgreementVersion>();

  constructor(private readonly documents: AgreementDocumentRepo) {}

  async save(version: AgreementVersion): Promise<AgreementVersion> {
    const document = await this.documents.findById(version.documentId);
    if (!document) {
      throw new DomainError('INVALID_STATE', `Document ${version.documentId} does not exist`);
    }
    this.versions.set(version.id, deepCopy(version));
    return deepCopy(version);
  }

  async findById(id: string): Promise<AgreementVersion | undefined> {
    return deepCopy(this.versions.get(id));
  }

  async findByDocument(documentId: string): Promise<AgreementVersion[]> {
    return deepCopy([...this.versions.values()].filter((v) => v.documentId === documentId));
  }

  async findCurrentPublished(
    typeKey: string,
    audienceKey: string,
    now: Date,
  ): Promise<AgreementVersion | undefined> {
    const document = await this.documents.findByTypeAndAudience(typeKey, audienceKey);
    if (!document) {
      return undefined;
    }
    const candidates = [...this.versions.values()]
      .filter(
        (v) =>
          v.documentId === document.id &&
          v.status === 'PUBLISHED' &&
          v.validFrom.getTime() <= now.getTime(),
      )
      .sort(
        (a, b) =>
          b.validFrom.getTime() - a.validFrom.getTime() ||
          (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0),
      );
    return deepCopy(candidates[0]);
  }

  async findUpcomingPublished(
    typeKey: string,
    audienceKey: string,
    now: Date,
  ): Promise<AgreementVersion | undefined> {
    const document = await this.documents.findByTypeAndAudience(typeKey, audienceKey);
    if (!document) {
      return undefined;
    }
    const candidates = [...this.versions.values()]
      .filter(
        (v) =>
          v.documentId === document.id &&
          v.status === 'PUBLISHED' &&
          v.validFrom.getTime() > now.getTime(),
      )
      // Next flip first: SMALLEST validFrom; on a tie the newest publishedAt (the one
      // findCurrentPublished would pick once the flip has happened).
      .sort(
        (a, b) =>
          a.validFrom.getTime() - b.validFrom.getTime() ||
          (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0),
      );
    return deepCopy(candidates[0]);
  }

  async delete(id: string): Promise<void> {
    const version = this.versions.get(id);
    if (!version) {
      throw new DomainError('VERSION_NOT_FOUND');
    }
    if (version.status !== 'DRAFT') {
      throw new DomainError('VERSION_IMMUTABLE', 'Only DRAFTs may be deleted');
    }
    this.versions.delete(id);
  }
}

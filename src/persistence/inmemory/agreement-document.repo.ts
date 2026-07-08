import { DomainError } from '../../common/errors';
import type { AgreementDocumentRepo } from '../../domain/ports';
import type { AgreementDocument } from '../../domain/types';
import { deepCopy } from './clone';

export class InMemoryAgreementDocumentRepo implements AgreementDocumentRepo {
  private readonly documents = new Map<string, AgreementDocument>();

  async save(document: AgreementDocument): Promise<AgreementDocument> {
    const duplicate = [...this.documents.values()].find(
      (d) => d.id !== document.id && d.type === document.type && d.audience === document.audience,
    );
    if (duplicate) {
      throw new DomainError(
        'INVALID_STATE',
        `A document for (${document.type}, ${document.audience}) already exists`,
      );
    }
    this.documents.set(document.id, deepCopy(document));
    return deepCopy(document);
  }

  async findById(id: string): Promise<AgreementDocument | undefined> {
    return deepCopy(this.documents.get(id));
  }

  async findByTypeAndAudience(typeKey: string, audienceKey: string): Promise<AgreementDocument | undefined> {
    const found = [...this.documents.values()].find((d) => d.type === typeKey && d.audience === audienceKey);
    return deepCopy(found);
  }

  async findAll(): Promise<AgreementDocument[]> {
    return deepCopy([...this.documents.values()]);
  }
}

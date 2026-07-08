import { DomainError } from '../../common/errors';
import { assertValidEntityKey } from '../../domain/keys';
import type { AgreementDocumentRepo, DocumentTypeRepo } from '../../domain/ports';
import type { DocumentTypeDef } from '../../domain/types';
import { deepCopy } from './clone';

/**
 * In-memory fake of DocumentTypeRepo — mirrors src/persistence/prisma/document-type.repo.ts.
 * `save` upserts by id, validates the key slug and enforces key uniqueness across types.
 * `deleteIfUnused` checks references in AgreementDocument.type.
 */
export class InMemoryDocumentTypeRepo implements DocumentTypeRepo {
  private readonly types = new Map<string, DocumentTypeDef>();

  constructor(private readonly documents: AgreementDocumentRepo) {}

  async save(documentType: DocumentTypeDef): Promise<DocumentTypeDef> {
    assertValidEntityKey(documentType.key, 'document type');
    const duplicate = [...this.types.values()].find((t) => t.id !== documentType.id && t.key === documentType.key);
    if (duplicate) {
      throw new DomainError('INVALID_STATE', `A document type with key "${documentType.key}" already exists`);
    }
    this.types.set(documentType.id, deepCopy(documentType));
    return deepCopy(documentType);
  }

  async findByKey(key: string): Promise<DocumentTypeDef | undefined> {
    return deepCopy([...this.types.values()].find((t) => t.key === key));
  }

  async findAll(): Promise<DocumentTypeDef[]> {
    return deepCopy([...this.types.values()]);
  }

  async deleteIfUnused(key: string): Promise<boolean> {
    const existing = [...this.types.values()].find((t) => t.key === key);
    if (!existing) {
      return false;
    }
    const documents = await this.documents.findAll();
    if (documents.some((d) => d.type === key)) {
      return false;
    }
    this.types.delete(existing.id);
    return true;
  }
}

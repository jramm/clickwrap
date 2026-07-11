import type { SignedDocumentRepo } from '../../domain/ports.js';
import type { SignedDocument } from '../../domain/types.js';
import { deepCopy } from './clone.js';

/**
 * In-memory fake of SignedDocumentRepo — mirrors src/persistence/prisma/signed-document.repo.ts.
 * Append-only: `append` stores an immutable copy; there is no update/delete (corrections are a new
 * upload). `findByCustomer` returns newest first (uploadedAt desc, id desc as a stable tie-break).
 */
export class InMemorySignedDocumentRepo implements SignedDocumentRepo {
  private readonly documents = new Map<string, SignedDocument>();

  async append(document: SignedDocument): Promise<SignedDocument> {
    this.documents.set(document.id, deepCopy(document));
    return deepCopy(document);
  }

  async findById(id: string): Promise<SignedDocument | undefined> {
    return deepCopy(this.documents.get(id));
  }

  async findByCustomer(customerId: string): Promise<SignedDocument[]> {
    return deepCopy(
      [...this.documents.values()]
        .filter((d) => d.customerId === customerId)
        .sort((a, b) => b.uploadedAt.getTime() - a.uploadedAt.getTime() || b.id.localeCompare(a.id)),
    );
  }
}

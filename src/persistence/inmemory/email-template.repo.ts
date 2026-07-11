import type { DocumentTypeRepo, EmailTemplateRepo } from '../../domain/ports.js';
import type { EmailTemplate } from '../../domain/types.js';
import { deepCopy } from './clone.js';

/**
 * In-memory fake of EmailTemplateRepo — mirrors src/persistence/prisma/email-template.repo.ts.
 * `save` upserts by id; `deleteIfUnused` refuses deletion while the template is still assigned to
 * any DocumentTypeDef (notificationTemplateId / reminderTemplateId).
 */
export class InMemoryEmailTemplateRepo implements EmailTemplateRepo {
  private readonly templates = new Map<string, EmailTemplate>();

  constructor(private readonly documentTypes: DocumentTypeRepo) {}

  async save(template: EmailTemplate): Promise<EmailTemplate> {
    this.templates.set(template.id, deepCopy(template));
    return deepCopy(template);
  }

  async findById(id: string): Promise<EmailTemplate | undefined> {
    return deepCopy(this.templates.get(id));
  }

  async findAll(): Promise<EmailTemplate[]> {
    return deepCopy([...this.templates.values()]);
  }

  async deleteIfUnused(id: string): Promise<boolean> {
    if (!this.templates.has(id)) {
      return false;
    }
    const documentTypes = await this.documentTypes.findAll();
    const assigned = documentTypes.some(
      (t) => t.notificationTemplateId === id || t.reminderTemplateId === id,
    );
    if (assigned) {
      return false;
    }
    this.templates.delete(id);
    return true;
  }
}

import { aDocument } from '../domain/testing/fixtures.js';
import { InMemoryAgreementDocumentRepo } from '../persistence/inmemory/agreement-document.repo.js';
import { InMemoryAudienceRepo } from '../persistence/inmemory/audience.repo.js';
import { InMemoryCustomerRepo } from '../persistence/inmemory/customer.repo.js';
import { InMemoryDocumentTypeRepo } from '../persistence/inmemory/document-type.repo.js';
import type { LegalEntitiesConfig } from './legal-entities.config.js';
import { LegalEntitiesReconciler } from './legal-entities.reconciler.js';

const demoConfig: LegalEntitiesConfig = {
  audiences: [
    { key: 'customer', name: 'Customers' },
    { key: 'partner', name: 'Partners' },
  ],
  documentTypes: [
    {
      key: 'terms',
      name: 'Terms of Service',
      external: false,
      notificationTemplateId: null,
      reminderTemplateId: null,
      acceptanceConfirmationTemplateId: null,
    },
    {
      key: 'dpa',
      name: 'Data Processing Agreement',
      external: false,
      notificationTemplateId: null,
      reminderTemplateId: null,
      acceptanceConfirmationTemplateId: null,
    },
  ],
};

describe('LegalEntitiesReconciler', () => {
  let documents: InMemoryAgreementDocumentRepo;
  let customers: InMemoryCustomerRepo;
  let audiences: InMemoryAudienceRepo;
  let documentTypes: InMemoryDocumentTypeRepo;
  let reconciler: LegalEntitiesReconciler;

  beforeEach(() => {
    documents = new InMemoryAgreementDocumentRepo();
    customers = new InMemoryCustomerRepo();
    audiences = new InMemoryAudienceRepo(documents, customers);
    documentTypes = new InMemoryDocumentTypeRepo(documents);
    reconciler = new LegalEntitiesReconciler(audiences, documentTypes);
  });

  it('creates the missing audiences and document types', async () => {
    const summary = await reconciler.reconcile(demoConfig);

    expect(summary.audiences).toMatchObject({ created: 2, updated: 0, kept: 0, deleted: 0 });
    expect(summary.documentTypes).toMatchObject({ created: 2, updated: 0, kept: 0, deleted: 0 });
    expect((await audiences.findAll()).map((a) => a.key).sort()).toEqual(['customer', 'partner']);
    expect((await documentTypes.findAll()).map((t) => t.key).sort()).toEqual(['dpa', 'terms']);
  });

  it('is idempotent — a second run performs no changes', async () => {
    await reconciler.reconcile(demoConfig);
    const summary = await reconciler.reconcile(demoConfig);
    expect(summary.audiences).toMatchObject({ created: 0, updated: 0, kept: 0, deleted: 0 });
    expect(summary.documentTypes).toMatchObject({ created: 0, updated: 0, kept: 0, deleted: 0 });
  });

  it('updates a changed name / external / template id while keeping the id stable', async () => {
    await audiences.save({ id: 'aud-fixed', key: 'customer', name: 'Old customers' });
    await documentTypes.save({ id: 'dt-fixed', key: 'terms', name: 'Old terms', external: false });

    const config: LegalEntitiesConfig = {
      audiences: [{ key: 'customer', name: 'Customers' }],
      documentTypes: [
        {
          key: 'terms',
          name: 'Terms of Service',
          external: true,
          notificationTemplateId: 'tpl-notify',
          reminderTemplateId: null,
          acceptanceConfirmationTemplateId: null,
        },
      ],
    };
    const summary = await reconciler.reconcile(config);

    expect(summary.audiences.updated).toBe(1);
    expect(summary.documentTypes.updated).toBe(1);
    const audience = await audiences.findByKey('customer');
    expect(audience).toMatchObject({ id: 'aud-fixed', name: 'Customers' });
    const type = await documentTypes.findByKey('terms');
    expect(type).toMatchObject({
      id: 'dt-fixed',
      name: 'Terms of Service',
      external: true,
      notificationTemplateId: 'tpl-notify',
    });
  });

  it('deletes an unused entity that is absent from the config', async () => {
    await audiences.save({ id: 'aud-obsolete', key: 'reseller', name: 'Resellers' });
    await documentTypes.save({ id: 'dt-obsolete', key: 'nda', name: 'NDA', external: false });

    const summary = await reconciler.reconcile(demoConfig);

    expect(summary.audiences.deleted).toBe(1);
    expect(summary.documentTypes.deleted).toBe(1);
    expect(await audiences.findByKey('reseller')).toBeUndefined();
    expect(await documentTypes.findByKey('nda')).toBeUndefined();
  });

  it('keeps a referenced entity absent from the config and logs a warning', async () => {
    await audiences.save({ id: 'aud-legacy', key: 'legacy-aud', name: 'Legacy audience' });
    await documentTypes.save({ id: 'dt-legacy', key: 'legacy-type', name: 'Legacy type', external: false });
    // A document references both → deleteIfUnused returns false.
    await documents.save(aDocument({ id: 'doc-legacy', type: 'legacy-type', audience: 'legacy-aud' }));

    const warn = jest.spyOn(reconciler['logger'], 'warn').mockImplementation(() => undefined);
    const summary = await reconciler.reconcile(demoConfig);

    expect(summary.audiences.kept).toBe(1);
    expect(summary.documentTypes.kept).toBe(1);
    expect(await audiences.findByKey('legacy-aud')).toBeDefined();
    expect(await documentTypes.findByKey('legacy-type')).toBeDefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('legacy-aud'));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('legacy-type'));
  });
});

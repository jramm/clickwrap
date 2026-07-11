import { FixedClock } from '../../../domain/clock.js';
import { defaultEmailTemplates } from '../../../domain/email-template.js';
import { aCustomer, aDocument, anActiveVersion, aVersion } from '../../../domain/testing/fixtures.js';
import { InMemoryFileStorage } from '../../file-storage/memory/in-memory-file-storage.js';
import { InMemoryAcceptanceLinkRepo } from '../../../persistence/inmemory/acceptance-link.repo.js';
import { InMemoryAgreementDocumentRepo } from '../../../persistence/inmemory/agreement-document.repo.js';
import { InMemoryAudienceRepo } from '../../../persistence/inmemory/audience.repo.js';
import { InMemoryCustomerRepo } from '../../../persistence/inmemory/customer.repo.js';
import { InMemoryDocumentTypeRepo } from '../../../persistence/inmemory/document-type.repo.js';
import { InMemoryEmailTemplateRepo } from '../../../persistence/inmemory/email-template.repo.js';
import { InMemoryEventRepo } from '../../../persistence/inmemory/event.repo.js';
import { EventRecorder } from '../../../events/event-recorder.js';
import { AgreementEmailService } from './agreement-email.service.js';
import { EmailContentService } from './email-content.service.js';
import type { EmailDeliveryProvider, NotificationConfig, OutboundMail } from './email-delivery-provider.js';
import { InMemoryOutboundEmailRepo } from './outbound-email.repo.inmemory.js';
import { PermanentAcceptanceLinkService } from './permanent-acceptance-link.service.js';

class FakeEmailProvider implements EmailDeliveryProvider {
  public readonly sentMessages: OutboundMail[] = [];
  private nextRef = 1;

  async send(mail: OutboundMail) {
    this.sentMessages.push(mail);
    return { providerRef: `ref-${this.nextRef++}` };
  }
}

const T0 = new Date('2026-07-07T09:00:00Z');
const PDF = Buffer.from('%PDF-1.4 test document');
const CONFIG: NotificationConfig = {
  appName: 'Clickwrap',
  publicBaseUrl: 'https://clickwrap.example.org',
  acceptanceLinkSecret: 'test-secret',
};

describe('AgreementEmailService', () => {
  let provider: FakeEmailProvider;
  let outboundEmailRepo: InMemoryOutboundEmailRepo;
  let clock: FixedClock;
  let events: InMemoryEventRepo;
  let fileStorage: InMemoryFileStorage;
  let pdfStorageKey: string;
  let service: AgreementEmailService;

  beforeEach(async () => {
    provider = new FakeEmailProvider();
    outboundEmailRepo = new InMemoryOutboundEmailRepo();
    clock = new FixedClock(T0);
    events = new InMemoryEventRepo();
    fileStorage = new InMemoryFileStorage();
    ({ storageKey: pdfStorageKey } = await fileStorage.store(PDF, { fileName: 'dpa-2026-06.pdf' }));

    const documents = new InMemoryAgreementDocumentRepo();
    const documentTypes = new InMemoryDocumentTypeRepo(documents);
    const customers = new InMemoryCustomerRepo();
    const audiences = new InMemoryAudienceRepo(documents, customers);
    const templates = new InMemoryEmailTemplateRepo(documentTypes);
    const links = new InMemoryAcceptanceLinkRepo();
    const permanentLinks = new PermanentAcceptanceLinkService(links, clock, CONFIG);
    await documents.save(aDocument());
    await documentTypes.save({ id: 'dt-dpa', key: 'dpa', name: 'Data Processing Agreement' });
    await audiences.save({ id: 'aud-customer', key: 'customer', name: 'Customers' });
    for (const t of defaultEmailTemplates(clock)) {
      await templates.save(t);
    }
    const content = new EmailContentService(
      documents,
      documentTypes,
      audiences,
      templates,
      clock,
      CONFIG,
      permanentLinks,
    );
    service = new AgreementEmailService(
      provider,
      outboundEmailRepo,
      clock,
      content,
      new EventRecorder(events, clock),
      fileStorage,
    );
  });

  describe('sendVersionNotification', () => {
    it('sends rendered content via the delivery provider to the given recipient', async () => {
      const result = await service.sendVersionNotification(
        aCustomer(),
        'max@customer.example',
        aVersion({ storageKey: pdfStorageKey }),
      );

      expect(result.providerRef).toBe('ref-1');
      expect(provider.sentMessages[0].to).toBe('max@customer.example');
      expect(provider.sentMessages[0].subject).toContain(aVersion().versionLabel);
      expect(provider.sentMessages[0].html).toContain('/accept/');
      expect(provider.sentMessages[0].text).toBeDefined();
    });

    it('persists the send in the OutboundEmailRepo — deliveredAt stays empty', async () => {
      const customer = aCustomer();
      const version = aVersion({ storageKey: pdfStorageKey });

      await service.sendVersionNotification(customer, 'max@customer.example', version);

      const stored = await outboundEmailRepo.findByProviderRef('ref-1');
      expect(stored).toMatchObject({
        providerRef: 'ref-1',
        customerId: customer.id,
        versionId: version.id,
        recipient: 'max@customer.example',
      });
      expect(stored?.deliveredAt).toBeUndefined();
      expect(stored?.sentAt.toISOString()).toBe(T0.toISOString());
    });

    it('a PASSIVE notification attaches the version PDF (filename + base64 content + application/pdf)', async () => {
      const version = aVersion({ storageKey: pdfStorageKey, fileName: 'dpa-2026-06.pdf' });

      await service.sendVersionNotification(aCustomer(), 'max@customer.example', version);

      const [attachment] = provider.sentMessages[0].attachments ?? [];
      expect(attachment).toBeDefined();
      expect(attachment.filename).toBe('dpa-2026-06.pdf');
      expect(attachment.contentType).toBe('application/pdf');
      expect(Buffer.from(attachment.contentBase64, 'base64').equals(PDF)).toBe(true);
    });

    it('an ACTIVE notification carries no attachment (link-only)', async () => {
      const version = anActiveVersion({ storageKey: pdfStorageKey });

      await service.sendVersionNotification(aCustomer(), 'max@customer.example', version);

      expect(provider.sentMessages[0].attachments ?? []).toHaveLength(0);
    });
  });

  describe('sendReminder', () => {
    it('sends a reminder and persists the send', async () => {
      const deadlineAt = new Date('2026-07-21T09:00:00Z');

      const result = await service.sendReminder(aCustomer(), 'max@customer.example', aVersion(), deadlineAt);

      expect(provider.sentMessages[0].subject).toContain('Reminder');
      const stored = await outboundEmailRepo.findByProviderRef(result.providerRef);
      expect(stored?.recipient).toBe('max@customer.example');
    });
  });

  describe('event recording', () => {
    it('records an EMAIL_SENT event after a successful send', async () => {
      const customer = aCustomer();
      const version = aVersion({ storageKey: pdfStorageKey });
      await service.sendVersionNotification(customer, 'max@customer.example', version);

      const { items } = await events.query({});
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({
        type: 'EMAIL_SENT',
        category: 'COMMUNICATION',
        actorKind: 'SYSTEM',
        actorLabel: 'system',
        customerId: customer.id,
        versionId: version.id,
        channel: 'EMAIL',
        recipient: 'max@customer.example',
      });
    });

    it('records NO event when the provider send throws', async () => {
      jest.spyOn(provider, 'send').mockRejectedValueOnce(new Error('provider down'));
      await expect(
        service.sendVersionNotification(aCustomer(), 'max@customer.example', aVersion({ storageKey: pdfStorageKey })),
      ).rejects.toThrow();
      expect((await events.query({})).total).toBe(0);
    });
  });
});

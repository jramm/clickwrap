import { FixedClock } from '../../../domain/clock';
import { defaultEmailTemplates } from '../../../domain/email-template';
import { aCustomer, aDocument, aVersion } from '../../../domain/testing/fixtures';
import { InMemoryAcceptanceLinkRepo } from '../../../persistence/inmemory/acceptance-link.repo';
import { InMemoryAgreementDocumentRepo } from '../../../persistence/inmemory/agreement-document.repo';
import { InMemoryAudienceRepo } from '../../../persistence/inmemory/audience.repo';
import { InMemoryCustomerRepo } from '../../../persistence/inmemory/customer.repo';
import { InMemoryDocumentTypeRepo } from '../../../persistence/inmemory/document-type.repo';
import { InMemoryEmailTemplateRepo } from '../../../persistence/inmemory/email-template.repo';
import { InMemoryEventRepo } from '../../../persistence/inmemory/event.repo';
import { EventRecorder } from '../../../events/event-recorder';
import { AgreementEmailService } from './agreement-email.service';
import { EmailContentService } from './email-content.service';
import type { EmailDeliveryProvider, NotificationConfig, OutboundMail } from './email-delivery-provider';
import { InMemoryOutboundEmailRepo } from './outbound-email.repo.inmemory';
import { PermanentAcceptanceLinkService } from './permanent-acceptance-link.service';

class FakeEmailProvider implements EmailDeliveryProvider {
  public readonly sentMessages: OutboundMail[] = [];
  private nextRef = 1;

  async send(mail: OutboundMail) {
    this.sentMessages.push(mail);
    return { providerRef: `ref-${this.nextRef++}` };
  }
}

const T0 = new Date('2026-07-07T09:00:00Z');
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
  let service: AgreementEmailService;

  beforeEach(async () => {
    provider = new FakeEmailProvider();
    outboundEmailRepo = new InMemoryOutboundEmailRepo();
    clock = new FixedClock(T0);
    events = new InMemoryEventRepo();

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
    service = new AgreementEmailService(provider, outboundEmailRepo, clock, content, new EventRecorder(events, clock));
  });

  describe('sendVersionNotification', () => {
    it('sends rendered content via the delivery provider to the given recipient', async () => {
      const result = await service.sendVersionNotification(aCustomer(), 'max@customer.example', aVersion());

      expect(result.providerRef).toBe('ref-1');
      expect(provider.sentMessages[0].to).toBe('max@customer.example');
      expect(provider.sentMessages[0].subject).toContain(aVersion().versionLabel);
      expect(provider.sentMessages[0].html).toContain('/accept/');
      expect(provider.sentMessages[0].text).toBeDefined();
    });

    it('persists the send in the OutboundEmailRepo — deliveredAt stays empty', async () => {
      const customer = aCustomer();
      const version = aVersion();

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
      const version = aVersion();
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
      await expect(service.sendVersionNotification(aCustomer(), 'max@customer.example', aVersion())).rejects.toThrow();
      expect((await events.query({})).total).toBe(0);
    });
  });
});

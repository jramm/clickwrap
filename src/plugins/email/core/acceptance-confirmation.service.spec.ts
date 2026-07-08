import { FixedClock } from '../../../domain/clock';
import { defaultEmailTemplates } from '../../../domain/email-template';
import { anAcceptance, aCustomer, aDocument, aVersion, testActor } from '../../../domain/testing/fixtures';
import { InMemoryFileStorage } from '../../file-storage/memory/in-memory-file-storage';
import { InMemoryAcceptanceLinkRepo } from '../../../persistence/inmemory/acceptance-link.repo';
import { InMemoryAgreementDocumentRepo } from '../../../persistence/inmemory/agreement-document.repo';
import { InMemoryAudienceRepo } from '../../../persistence/inmemory/audience.repo';
import { InMemoryCustomerRepo } from '../../../persistence/inmemory/customer.repo';
import { InMemoryDocumentTypeRepo } from '../../../persistence/inmemory/document-type.repo';
import { InMemoryEmailTemplateRepo } from '../../../persistence/inmemory/email-template.repo';
import { AcceptanceConfirmationService } from './acceptance-confirmation.service';
import { EmailContentService } from './email-content.service';
import type { EmailDeliveryProvider, NotificationConfig, OutboundMail } from './email-delivery-provider';
import { InMemoryOutboundEmailRepo } from './outbound-email.repo.inmemory';
import { PermanentAcceptanceLinkService } from './permanent-acceptance-link.service';

const T0 = new Date('2026-07-08T14:12:03Z');
const CONFIG: NotificationConfig = {
  appName: 'Clickwrap',
  publicBaseUrl: 'https://clickwrap.example.org',
  acceptanceLinkSecret: 'test-secret',
};
const PDF = Buffer.from('%PDF-1.7 the accepted document');

class FakeEmailProvider implements EmailDeliveryProvider {
  public readonly sentMessages: OutboundMail[] = [];
  public throwOnSend = false;
  private nextRef = 1;

  async send(mail: OutboundMail) {
    if (this.throwOnSend) {
      throw new Error('provider is down');
    }
    this.sentMessages.push(mail);
    return { providerRef: `ref-${this.nextRef++}` };
  }
}

interface Harness {
  service: AcceptanceConfirmationService;
  provider: FakeEmailProvider;
  outbound: InMemoryOutboundEmailRepo;
  customers: InMemoryCustomerRepo;
  storageKey: string;
}

const buildHarness = async (): Promise<Harness> => {
  const clock = new FixedClock(T0);
  const provider = new FakeEmailProvider();
  const outbound = new InMemoryOutboundEmailRepo();
  const documents = new InMemoryAgreementDocumentRepo();
  const documentTypes = new InMemoryDocumentTypeRepo(documents);
  const customers = new InMemoryCustomerRepo();
  const audiences = new InMemoryAudienceRepo(documents, customers);
  const templates = new InMemoryEmailTemplateRepo(documentTypes);
  const links = new InMemoryAcceptanceLinkRepo();
  const storage = new InMemoryFileStorage();

  await documents.save(aDocument());
  await documentTypes.save({ id: 'dt-dpa', key: 'dpa', name: 'Data Processing Agreement' });
  await audiences.save({ id: 'aud-customer', key: 'customer', name: 'Customers' });
  await customers.save(aCustomer());
  for (const t of defaultEmailTemplates(clock)) {
    await templates.save(t);
  }
  const { storageKey } = await storage.store(PDF, { fileName: 'dpa-2026-06.pdf' });

  const permanentLinks = new PermanentAcceptanceLinkService(links, clock, CONFIG);
  const content = new EmailContentService(
    documents,
    documentTypes,
    audiences,
    templates,
    clock,
    CONFIG,
    permanentLinks,
  );
  const service = new AcceptanceConfirmationService(provider, outbound, customers, storage, clock, content);
  return { service, provider, outbound, customers, storageKey };
};

describe('AcceptanceConfirmationService', () => {
  it('attaches the stored version PDF (filename + base64 content + application/pdf)', async () => {
    const { service, provider, storageKey } = await buildHarness();
    const version = aVersion({ storageKey, fileName: 'dpa-2026-06.pdf' });

    await service.sendForAcceptance(version, anAcceptance({ method: 'ACTIVE_CONSENT', channel: 'PORTAL' }));

    expect(provider.sentMessages).toHaveLength(1);
    const [attachment] = provider.sentMessages[0].attachments!;
    expect(attachment.filename).toBe('dpa-2026-06.pdf');
    expect(attachment.contentType).toBe('application/pdf');
    expect(Buffer.from(attachment.contentBase64, 'base64').equals(PDF)).toBe(true);
  });

  it('renders the confirmation with the acceptedAt timestamp and records the send', async () => {
    const { service, provider, outbound, storageKey } = await buildHarness();
    const version = aVersion({ storageKey });

    await service.sendForAcceptance(
      version,
      anAcceptance({ method: 'ACTIVE_CONSENT', channel: 'PORTAL', acceptedAt: T0 }),
    );

    expect(provider.sentMessages[0].subject).toContain('your acceptance');
    expect(provider.sentMessages[0].html).toContain(T0.toISOString());
    const stored = await outbound.findByProviderRef('ref-1');
    expect(stored).toMatchObject({ customerId: 'c-123', versionId: version.id, recipient: 'jane@customer.example' });
  });

  describe('trigger matrix', () => {
    it.each([
      ['ACTIVE_CONSENT', 'PORTAL'],
      ['ACTIVE_CONSENT', 'LINK'],
      ['ACTIVE_CONSENT', 'ADMIN'],
      ['TACIT', 'SYSTEM'],
    ] as const)('sends for method %s via channel %s', async (method, channel) => {
      const { service, provider, storageKey } = await buildHarness();
      // TACIT: the system actor has no e-mail → falls back to contactEmails.
      const actor = method === 'TACIT' ? testActor({ email: undefined }) : testActor();

      await service.sendForAcceptance(aVersion({ storageKey }), anAcceptance({ method, channel, actor }));

      expect(provider.sentMessages).toHaveLength(1);
    });

    it('does NOT send for method IMPORT', async () => {
      const { service, provider, outbound, storageKey } = await buildHarness();

      await service.sendForAcceptance(
        aVersion({ storageKey }),
        anAcceptance({ method: 'IMPORT', channel: 'ADMIN' }),
      );

      expect(provider.sentMessages).toHaveLength(0);
      expect(await outbound.findByProviderRef('ref-1')).toBeUndefined();
    });
  });

  describe('recipient fallback chain', () => {
    it('uses the accepting actor e-mail when present', async () => {
      const { service, provider, storageKey } = await buildHarness();

      await service.sendForAcceptance(
        aVersion({ storageKey }),
        anAcceptance({ method: 'ACTIVE_CONSENT', actor: testActor({ email: 'signer@customer.example' }) }),
      );

      expect(provider.sentMessages.map((m) => m.to)).toEqual(['signer@customer.example']);
    });

    it('falls back to all customer contactEmails when the actor has no e-mail', async () => {
      const { service, provider, customers, storageKey } = await buildHarness();
      await customers.save(aCustomer({ contactEmails: ['a@customer.example', 'b@customer.example'] }));

      await service.sendForAcceptance(
        aVersion({ storageKey }),
        anAcceptance({ method: 'TACIT', channel: 'SYSTEM', actor: testActor({ email: undefined }) }),
      );

      expect(provider.sentMessages.map((m) => m.to)).toEqual(['a@customer.example', 'b@customer.example']);
    });

    it('skips (no send) with a warning when there is no recipient at all', async () => {
      const { service, provider, customers, storageKey } = await buildHarness();
      await customers.save(aCustomer({ contactEmails: [] }));

      await service.sendForAcceptance(
        aVersion({ storageKey }),
        anAcceptance({ method: 'TACIT', channel: 'SYSTEM', actor: testActor({ email: undefined }) }),
      );

      expect(provider.sentMessages).toHaveLength(0);
    });
  });

  describe('failure isolation', () => {
    it('never throws when the provider fails', async () => {
      const { service, provider, outbound, storageKey } = await buildHarness();
      provider.throwOnSend = true;

      await expect(
        service.sendForAcceptance(aVersion({ storageKey }), anAcceptance({ method: 'ACTIVE_CONSENT' })),
      ).resolves.toBeUndefined();
      expect(await outbound.findByProviderRef('ref-1')).toBeUndefined();
    });

    it('never throws when the version PDF cannot be retrieved', async () => {
      const { service, provider } = await buildHarness();

      await expect(
        service.sendForAcceptance(
          aVersion({ storageKey: 's3://bucket/missing.pdf' }),
          anAcceptance({ method: 'ACTIVE_CONSENT' }),
        ),
      ).resolves.toBeUndefined();
      expect(provider.sentMessages).toHaveLength(0);
    });
  });
});

import { Logger } from '@nestjs/common';
import { InMemoryAdminAuditRepo } from '../agreements/audit';
import type { RolloutNotifier } from '../agreements/ports';
import { InMemoryRolloutNotifier } from '../agreements/rollout-notifier.inmemory';
import { DomainError } from '../common/errors';
import { PendingAgreementsService } from '../compliance/pending-agreements.service';
import { FakePdfUrlProvider } from '../compliance/testing/fake-pdf-url-provider';
import { FixedClock } from '../domain/clock';
import { anAudience, aVersion } from '../domain/testing/fixtures';
import {
  InMemoryAcceptanceRepo,
  InMemoryAgreementDocumentRepo,
  InMemoryAgreementVersionRepo,
  InMemoryAudienceRepo,
  InMemoryCustomerRepo,
  InMemoryCustomerVersionStateRepo,
} from '../persistence/inmemory';
import { CustomerAdminService } from './customer-admin.service';

const T0 = new Date('2026-07-07T09:00:00Z');
const ADMIN = { userId: 'admin-1', name: 'Admin One' };

describe('CustomerAdminService', () => {
  let customers: InMemoryCustomerRepo;
  let audiences: InMemoryAudienceRepo;
  let documents: InMemoryAgreementDocumentRepo;
  let versions: InMemoryAgreementVersionRepo;
  let states: InMemoryCustomerVersionStateRepo;
  let acceptances: InMemoryAcceptanceRepo;
  let audit: InMemoryAdminAuditRepo;
  let notifier: InMemoryRolloutNotifier;
  let service: CustomerAdminService;

  /** Rebuilds the service with a different notifier (failure-injection tests). */
  const serviceWithNotifier = (rolloutNotifier: RolloutNotifier): CustomerAdminService =>
    new CustomerAdminService(
      customers,
      audiences,
      versions,
      documents,
      states,
      acceptances,
      rolloutNotifier,
      audit,
      new FixedClock(T0),
    );

  beforeEach(async () => {
    documents = new InMemoryAgreementDocumentRepo();
    customers = new InMemoryCustomerRepo();
    audiences = new InMemoryAudienceRepo(documents, customers);
    versions = new InMemoryAgreementVersionRepo(documents);
    states = new InMemoryCustomerVersionStateRepo();
    acceptances = new InMemoryAcceptanceRepo();
    audit = new InMemoryAdminAuditRepo();
    notifier = new InMemoryRolloutNotifier();
    await audiences.save(anAudience({ id: 'aud-customer', key: 'customer', name: 'Customers' }));
    await audiences.save(anAudience({ id: 'aud-partner', key: 'partner', name: 'Partners' }));
    service = serviceWithNotifier(notifier);
  });

  describe('list', () => {
    it('returns rows { id, externalRef, firstName, lastName, companyName, roles, contactEmails } sorted by display name/externalRef with total', async () => {
      await customers.save({ id: 'c-b', externalRef: 'ext-b', firstName: '', lastName: '', companyName: 'Beta', roles: ['customer'], contactEmails: [] });
      await customers.save({ id: 'c-a', externalRef: 'ext-a', firstName: '', lastName: '', companyName: 'Alpha', roles: ['partner'], contactEmails: ['a@x.io'] });

      const result = await service.list();
      expect(result.total).toBe(2);
      expect(result.items).toEqual([
        { id: 'c-a', externalRef: 'ext-a', firstName: '', lastName: '', companyName: 'Alpha', roles: ['partner'], contactEmails: ['a@x.io'] },
        { id: 'c-b', externalRef: 'ext-b', firstName: '', lastName: '', companyName: 'Beta', roles: ['customer'], contactEmails: [] },
      ]);
    });

    it('sorts by the derived display name — contact person (firstName lastName) when no company', async () => {
      await customers.save({ id: 'c-z', externalRef: 'ext-z', firstName: 'Zoe', lastName: 'Adams', roles: ['customer'], contactEmails: [] });
      await customers.save({ id: 'c-m', externalRef: 'ext-m', firstName: 'Max', lastName: 'Braun', roles: ['customer'], contactEmails: [] });

      const items = (await service.list()).items;
      expect(items.map((c) => c.id)).toEqual(['c-m', 'c-z']);
    });

    it('paginates with a page size of 50', async () => {
      for (let i = 0; i < 55; i++) {
        const n = String(i).padStart(3, '0');
        await customers.save({ id: `c-${n}`, externalRef: `ext-${n}`, firstName: '', lastName: '', companyName: `Cust ${n}`, roles: [], contactEmails: [] });
      }
      expect((await service.list(1)).items).toHaveLength(50);
      const page2 = await service.list(2);
      expect(page2.items).toHaveLength(5);
      expect(page2.total).toBe(55);
    });

    describe('search', () => {
      beforeEach(async () => {
        await customers.save({ id: 'c-acme', externalRef: 'crm-4711', firstName: '', lastName: '', companyName: 'Acme GmbH', roles: ['customer'], contactEmails: ['legal@acme.example'] });
        await customers.save({ id: 'c-globex', externalRef: 'crm-8000', firstName: '', lastName: '', companyName: 'Globex Corp', roles: ['partner'], contactEmails: ['ops@globex.test'] });
        await customers.save({ id: 'c-initech', externalRef: 'crm-9999', firstName: '', lastName: '', companyName: 'Initech', roles: [], contactEmails: [] });
      });

      it('filters by a case-insensitive substring of the name', async () => {
        const result = await service.list(undefined, 'acme');
        expect(result.items.map((c) => c.id)).toEqual(['c-acme']);
        expect(result.total).toBe(1);
      });

      it('filters by a substring of the externalRef', async () => {
        expect((await service.list(undefined, '8000')).items.map((c) => c.id)).toEqual(['c-globex']);
      });

      it('filters by a substring of a contact e-mail', async () => {
        expect((await service.list(undefined, 'globex.test')).items.map((c) => c.id)).toEqual(['c-globex']);
      });

      it('total reflects the filtered count and pagination runs over the filtered set', async () => {
        const result = await service.list(undefined, 'crm-');
        expect(result.total).toBe(3);
        expect(result.items.map((c) => c.id)).toEqual(['c-acme', 'c-globex', 'c-initech']);
      });

      it('an empty search behaves like no search', async () => {
        expect((await service.list(undefined, '')).total).toBe(3);
      });
    });
  });

  describe('create', () => {
    it('creates a customer (201 object) and writes a CUSTOMER_CREATE audit entry', async () => {
      const created = await service.create(
        { externalRef: 'ext-1', companyName: 'Acme', roles: ['customer'], contactEmails: ['legal@acme.io'] },
        ADMIN,
      );
      expect(created).toMatchObject({
        externalRef: 'ext-1',
        companyName: 'Acme',
        roles: ['customer'],
        contactEmails: ['legal@acme.io'],
        importedAcceptances: [],
      });
      expect(created.id).toBeTruthy();
      expect((await audit.findByTarget('Customer', created.id))[0]).toMatchObject({
        action: 'CUSTOMER_CREATE',
        actor: 'admin-1',
      });
    });

    it('rejects an unknown role with UNKNOWN_AUDIENCE', async () => {
      await expect(
        service.create({ externalRef: 'ext-1', companyName: 'x', roles: ['ghost'], contactEmails: [] }, ADMIN),
      ).rejects.toMatchObject({ code: 'UNKNOWN_AUDIENCE' });
    });

    it('rejects a duplicate externalRef with an OVERLAPPING role (INVALID_STATE)', async () => {
      await service.create({ externalRef: 'ext-1', companyName: 'x', roles: ['customer'], contactEmails: [] }, ADMIN);
      await expect(
        service.create({ externalRef: 'ext-1', companyName: 'y', roles: ['customer'], contactEmails: [] }, ADMIN),
      ).rejects.toMatchObject({ code: 'INVALID_STATE' });
    });

    it('allows a duplicate externalRef across NON-overlapping roles (partner vs customer ID space)', async () => {
      await service.create({ externalRef: 'X', companyName: 'customer', roles: ['customer'], contactEmails: [] }, ADMIN);
      const partner = await service.create({ externalRef: 'X', companyName: 'partner', roles: ['partner'], contactEmails: [] }, ADMIN);
      expect(partner).toMatchObject({ externalRef: 'X', roles: ['partner'] });
    });

    it('rejects a third externalRef=X once it overlaps an existing role', async () => {
      await service.create({ externalRef: 'X', companyName: 'customer', roles: ['customer'], contactEmails: [] }, ADMIN);
      await service.create({ externalRef: 'X', companyName: 'partner', roles: ['partner'], contactEmails: [] }, ADMIN);
      await expect(
        service.create({ externalRef: 'X', companyName: 'dup', roles: ['customer'], contactEmails: [] }, ADMIN),
      ).rejects.toMatchObject({ code: 'INVALID_STATE' });
    });

    it('a multi-role customer blocks both single-role duplicates of the same externalRef', async () => {
      await service.create({ externalRef: 'X', companyName: 'both', roles: ['customer', 'partner'], contactEmails: [] }, ADMIN);
      await expect(
        service.create({ externalRef: 'X', companyName: 'c', roles: ['customer'], contactEmails: [] }, ADMIN),
      ).rejects.toMatchObject({ code: 'INVALID_STATE' });
      await expect(
        service.create({ externalRef: 'X', companyName: 'p', roles: ['partner'], contactEmails: [] }, ADMIN),
      ).rejects.toMatchObject({ code: 'INVALID_STATE' });
    });

    it('allows a duplicate externalRef when both records are role-less (no overlap)', async () => {
      await service.create({ externalRef: 'ext-1', companyName: 'x', roles: [], contactEmails: [] }, ADMIN);
      const second = await service.create({ externalRef: 'ext-1', companyName: 'y', roles: [], contactEmails: [] }, ADMIN);
      expect(second).toMatchObject({ externalRef: 'ext-1', roles: [] });
    });

    it('rejects an invalid contactEmail with INVALID_STATE', async () => {
      await expect(
        service.create({ externalRef: 'ext-1', companyName: 'x', roles: [], contactEmails: ['not-an-email'] }, ADMIN),
      ).rejects.toMatchObject({ code: 'INVALID_STATE' });
    });

    it('rejects a blank externalRef with INVALID_STATE', async () => {
      await expect(
        service.create({ externalRef: '  ', companyName: 'x', roles: [], contactEmails: [] }, ADMIN),
      ).rejects.toBeInstanceOf(DomainError);
    });

    describe('acceptedVersions import (signed offer)', () => {
      beforeEach(async () => {
        await documents.save({ id: 'doc-dpa-c', type: 'dpa', audience: 'customer', name: 'DPA — Customers' });
        await versions.save(
          aVersion({ id: 'v-pub', documentId: 'doc-dpa-c', status: 'PUBLISHED', contentHash: 'sha256:abc' }),
        );
      });

      it('imports an accepted version as IMPORT/ADMIN, ACCEPTED state, backdated, with the reference as evidence', async () => {
        const created = await service.create(
          {
            externalRef: 'ext-1',
            companyName: 'Acme',
            roles: ['customer'],
            contactEmails: [],
            acceptedVersions: [
              { versionId: 'v-pub', acceptedAt: '2026-07-01T00:00:00Z', reference: 'HubSpot deal 12345' },
            ],
          },
          ADMIN,
        );
        expect(created.importedAcceptances).toEqual([{ versionId: 'v-pub', acceptanceId: expect.any(String) }]);

        const [acceptance] = await acceptances.findByCustomer(created.id);
        expect(acceptance).toMatchObject({
          versionId: 'v-pub',
          method: 'IMPORT',
          channel: 'ADMIN',
          isEffective: true,
          contentHash: 'sha256:abc',
          evidenceNote: 'HubSpot deal 12345',
          acceptedAt: new Date('2026-07-01T00:00:00Z'),
        });
        expect(acceptance.actor).toMatchObject({ userId: 'admin-1' });

        const state = await states.findByCustomerAndVersion(created.id, 'v-pub');
        expect(state?.state).toBe('ACCEPTED');

        const auditEntry = (await audit.findByTarget('Customer', created.id))[0];
        expect(auditEntry.metadata).toMatchObject({ importedAcceptances: 1 });
      });

      it('accepts a RETIRED version (superseded between signing and creation)', async () => {
        await versions.save(aVersion({ id: 'v-retired', documentId: 'doc-dpa-c', status: 'RETIRED' }));
        const created = await service.create(
          { externalRef: 'ext-r', companyName: 'x', roles: ['customer'], contactEmails: [], acceptedVersions: [{ versionId: 'v-retired' }] },
          ADMIN,
        );
        expect(created.importedAcceptances).toHaveLength(1);
      });

      it('rejects an unknown versionId with VERSION_NOT_FOUND and creates no customer', async () => {
        await expect(
          service.create(
            { externalRef: 'ext-1', companyName: 'x', roles: ['customer'], contactEmails: [], acceptedVersions: [{ versionId: 'ghost' }] },
            ADMIN,
          ),
        ).rejects.toMatchObject({ code: 'VERSION_NOT_FOUND' });
        expect(await customers.findAllByExternalRef('ext-1')).toEqual([]);
      });

      it('rejects a DRAFT version with INVALID_STATE', async () => {
        await versions.save(aVersion({ id: 'v-draft', documentId: 'doc-dpa-c', status: 'DRAFT' }));
        await expect(
          service.create(
            { externalRef: 'ext-1', companyName: 'x', roles: ['customer'], contactEmails: [], acceptedVersions: [{ versionId: 'v-draft' }] },
            ADMIN,
          ),
        ).rejects.toMatchObject({ code: 'INVALID_STATE' });
      });

      it('rejects when the version audience is not covered by the roles with ROLE_MISMATCH', async () => {
        await expect(
          service.create(
            { externalRef: 'ext-1', companyName: 'x', roles: ['partner'], contactEmails: [], acceptedVersions: [{ versionId: 'v-pub' }] },
            ADMIN,
          ),
        ).rejects.toMatchObject({ code: 'ROLE_MISMATCH' });
      });

      it('import of an OLD (retired) version: the CURRENT version still becomes PENDING_NOTIFICATION', async () => {
        // The signed offer covered the retired revision — the customer must be asked for the
        // current one immediately (explicit user expectation).
        await versions.save(
          aVersion({ id: 'v-old', documentId: 'doc-dpa-c', status: 'RETIRED', validFrom: new Date('2026-01-01T00:00:00Z') }),
        );
        const created = await service.create(
          { externalRef: 'ext-1', companyName: 'x', roles: ['customer'], contactEmails: [], acceptedVersions: [{ versionId: 'v-old' }] },
          ADMIN,
        );

        expect((await states.findByCustomerAndVersion(created.id, 'v-old'))?.state).toBe('ACCEPTED');
        expect((await states.findByCustomerAndVersion(created.id, 'v-pub'))?.state).toBe('PENDING_NOTIFICATION');
      });

      it('import of the CURRENT version: state stays ACCEPTED, no duplicate/pending state', async () => {
        const created = await service.create(
          { externalRef: 'ext-1', companyName: 'x', roles: ['customer'], contactEmails: [], acceptedVersions: [{ versionId: 'v-pub' }] },
          ADMIN,
        );
        expect((await states.findByCustomerAndVersion(created.id, 'v-pub'))?.state).toBe('ACCEPTED');
        expect(await states.findByCustomer(created.id)).toHaveLength(1);
      });

      it('rejects duplicate versionIds in the array with INVALID_STATE', async () => {
        await expect(
          service.create(
            {
              externalRef: 'ext-1',
              companyName: 'x',
              roles: ['customer'],
              contactEmails: [],
              acceptedVersions: [{ versionId: 'v-pub' }, { versionId: 'v-pub' }],
            },
            ADMIN,
          ),
        ).rejects.toMatchObject({ code: 'INVALID_STATE' });
      });
    });
  });

  describe('onboarding rollout (customer created/role added AFTER the last publish)', () => {
    beforeEach(async () => {
      await documents.save({ id: 'doc-dpa-c', type: 'dpa', audience: 'customer', name: 'DPA — Customers' });
      await documents.save({ id: 'doc-tos-p', type: 'terms', audience: 'partner', name: 'ToS — Partners' });
      await versions.save(aVersion({ id: 'v-dpa', documentId: 'doc-dpa-c', status: 'PUBLISHED' }));
      await versions.save(aVersion({ id: 'v-tos', documentId: 'doc-tos-p', status: 'PUBLISHED' }));
    });

    it('create: PENDING_NOTIFICATION states for the current published versions of the roles — the version shows up in pending-agreements', async () => {
      const created = await service.create(
        { externalRef: 'ext-1', companyName: 'Acme', roles: ['customer'], contactEmails: [] },
        ADMIN,
      );

      const state = await states.findByCustomerAndVersion(created.id, 'v-dpa');
      expect(state).toMatchObject({ state: 'PENDING_NOTIFICATION', remindersSent: 0 });
      expect(state?.notifiedAt).toBeUndefined(); // deadline starts with the first provable access
      // No state for the audience the customer does not have.
      expect(await states.findByCustomerAndVersion(created.id, 'v-tos')).toBeUndefined();
      expect((await audit.findByTarget('Customer', created.id))[0].metadata).toMatchObject({ rolloutStates: 1 });

      // End-to-end expectation: pending-agreements (popup AND hosted acceptance page) lists it.
      const pending = new PendingAgreementsService(
        customers,
        audiences,
        documents,
        versions,
        states,
        new FixedClock(T0),
        new FakePdfUrlProvider(),
      );
      const items = await pending.getPendingAgreements(created.id);
      expect(items.map((i) => i.versionId)).toEqual(['v-dpa']);
    });

    it('create without any matching published version creates no states', async () => {
      const created = await service.create({ externalRef: 'ext-1', companyName: 'x', roles: [], contactEmails: [] }, ADMIN);
      expect(await states.findByCustomer(created.id)).toHaveLength(0);
    });

    it('role add via update: rollout only for the ADDED role, existing states untouched', async () => {
      const created = await service.create(
        { externalRef: 'ext-1', companyName: 'Acme', roles: ['customer'], contactEmails: [] },
        ADMIN,
      );
      expect(await states.findByCustomer(created.id)).toHaveLength(1);

      await service.update(created.id, { roles: ['customer', 'partner'] }, ADMIN);

      const all = await states.findByCustomer(created.id);
      expect(all).toHaveLength(2);
      expect((await states.findByCustomerAndVersion(created.id, 'v-tos'))?.state).toBe('PENDING_NOTIFICATION');
    });

    it('no duplicate states: repeating the same role update is a no-op', async () => {
      const created = await service.create(
        { externalRef: 'ext-1', companyName: 'Acme', roles: ['customer'], contactEmails: [] },
        ADMIN,
      );
      await service.update(created.id, { roles: ['customer', 'partner'] }, ADMIN);
      await service.update(created.id, { roles: ['customer', 'partner'] }, ADMIN);
      expect(await states.findByCustomer(created.id)).toHaveLength(2);
    });

    it('update without a roles change does not touch states', async () => {
      const created = await service.create(
        { externalRef: 'ext-1', companyName: 'Acme', roles: ['customer'], contactEmails: [] },
        ADMIN,
      );
      const before = await states.findByCustomer(created.id);
      await service.update(created.id, { companyName: 'Acme New' }, ADMIN);
      expect(await states.findByCustomer(created.id)).toEqual(before);
    });

    it('create: also creates a state for an UPCOMING published version (scheduled publish) — advance acceptance for new customers', async () => {
      await versions.save(
        aVersion({ id: 'v-dpa-next', documentId: 'doc-dpa-c', status: 'PUBLISHED', validFrom: new Date('2026-08-01T00:00:00Z'), publishedAt: T0 }),
      );

      const created = await service.create(
        { externalRef: 'ext-1', companyName: 'Acme', roles: ['customer'], contactEmails: [] },
        ADMIN,
      );

      expect((await states.findByCustomerAndVersion(created.id, 'v-dpa'))?.state).toBe('PENDING_NOTIFICATION');
      expect((await states.findByCustomerAndVersion(created.id, 'v-dpa-next'))?.state).toBe('PENDING_NOTIFICATION');
      expect((await audit.findByTarget('Customer', created.id))[0].metadata).toMatchObject({ rolloutStates: 2 });
    });

    it('role add via update: rollout covers current AND upcoming versions of the added role', async () => {
      await versions.save(
        aVersion({ id: 'v-tos-next', documentId: 'doc-tos-p', status: 'PUBLISHED', validFrom: new Date('2026-08-01T00:00:00Z'), publishedAt: T0 }),
      );
      const created = await service.create(
        { externalRef: 'ext-1', companyName: 'Acme', roles: ['customer'], contactEmails: [] },
        ADMIN,
      );

      await service.update(created.id, { roles: ['customer', 'partner'] }, ADMIN);

      expect((await states.findByCustomerAndVersion(created.id, 'v-tos'))?.state).toBe('PENDING_NOTIFICATION');
      expect((await states.findByCustomerAndVersion(created.id, 'v-tos-next'))?.state).toBe('PENDING_NOTIFICATION');
    });
  });

  describe('onboarding rollout notifications (same RolloutNotifier as publish)', () => {
    beforeEach(async () => {
      await documents.save({ id: 'doc-dpa-c', type: 'dpa', audience: 'customer', name: 'DPA — Customers' });
      await documents.save({ id: 'doc-tos-c', type: 'terms', audience: 'customer', name: 'ToS — Customers' });
      await documents.save({ id: 'doc-tos-p', type: 'terms', audience: 'partner', name: 'ToS — Partners' });
      await versions.save(aVersion({ id: 'v-dpa', documentId: 'doc-dpa-c', status: 'PUBLISHED' }));
      await versions.save(aVersion({ id: 'v-tos-c', documentId: 'doc-tos-c', status: 'PUBLISHED' }));
      await versions.save(aVersion({ id: 'v-tos-p', documentId: 'doc-tos-p', status: 'PUBLISHED' }));
    });

    it('create with NO acceptedVersions: one notification per current AND upcoming published version of the roles', async () => {
      await versions.save(
        aVersion({ id: 'v-dpa-next', documentId: 'doc-dpa-c', status: 'PUBLISHED', validFrom: new Date('2026-08-01T00:00:00Z'), publishedAt: T0 }),
      );

      const created = await service.create(
        { externalRef: 'ext-1', companyName: 'Acme', roles: ['customer'], contactEmails: ['legal@acme.io'] },
        ADMIN,
      );

      expect(notifier.published.map((n) => n.versionId).sort()).toEqual(['v-dpa', 'v-dpa-next', 'v-tos-c']);
      expect(notifier.published.every((n) => n.customerId === created.id)).toBe(true);
    });

    it('create with acceptedVersions covering some versions: notifications only for the uncovered ones', async () => {
      await service.create(
        {
          externalRef: 'ext-1',
          companyName: 'Acme',
          roles: ['customer'],
          contactEmails: ['legal@acme.io'],
          acceptedVersions: [{ versionId: 'v-dpa' }],
        },
        ADMIN,
      );

      expect(notifier.published.map((n) => n.versionId)).toEqual(['v-tos-c']);
    });

    it('create with everything covered by imports: no notification', async () => {
      await service.create(
        {
          externalRef: 'ext-1',
          companyName: 'Acme',
          roles: ['customer'],
          contactEmails: ['legal@acme.io'],
          acceptedVersions: [{ versionId: 'v-dpa' }, { versionId: 'v-tos-c' }],
        },
        ADMIN,
      );

      expect(notifier.published).toEqual([]);
    });

    it('import of an OLD (retired) version does not cover the current one — the current version is notified', async () => {
      await versions.save(
        aVersion({ id: 'v-dpa-old', documentId: 'doc-dpa-c', status: 'RETIRED', validFrom: new Date('2026-01-01T00:00:00Z') }),
      );

      await service.create(
        {
          externalRef: 'ext-1',
          companyName: 'Acme',
          roles: ['customer'],
          contactEmails: ['legal@acme.io'],
          acceptedVersions: [{ versionId: 'v-dpa-old' }, { versionId: 'v-tos-c' }],
        },
        ADMIN,
      );

      expect(notifier.published.map((n) => n.versionId)).toEqual(['v-dpa']);
    });

    it('role add via PATCH: notifications only for the NEWLY rolled-out versions', async () => {
      const created = await service.create(
        { externalRef: 'ext-1', companyName: 'Acme', roles: ['customer'], contactEmails: ['legal@acme.io'] },
        ADMIN,
      );
      notifier.published.length = 0; // only observe the PATCH

      await service.update(created.id, { roles: ['customer', 'partner'] }, ADMIN);

      expect(notifier.published).toEqual([{ customerId: created.id, versionId: 'v-tos-p' }]);
    });

    it('update without a roles change sends no notification', async () => {
      const created = await service.create(
        { externalRef: 'ext-1', companyName: 'Acme', roles: ['customer'], contactEmails: ['legal@acme.io'] },
        ADMIN,
      );
      notifier.published.length = 0;

      await service.update(created.id, { companyName: 'Acme New' }, ADMIN);

      expect(notifier.published).toEqual([]);
    });

    it('empty contactEmails: no crash, no notification, ONE warn log (escalation report covers unreachable customers)', async () => {
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      try {
        const created = await service.create(
          { externalRef: 'ext-1', companyName: 'Acme', roles: ['customer'], contactEmails: [] },
          ADMIN,
        );

        // States are still created — the customer shows up in pending-agreements and the escalation report.
        expect((await states.findByCustomerAndVersion(created.id, 'v-dpa'))?.state).toBe('PENDING_NOTIFICATION');
        expect(notifier.published).toEqual([]);
        expect(warn).toHaveBeenCalledTimes(1);
        expect(warn.mock.calls[0][0]).toContain(created.id);
      } finally {
        warn.mockRestore();
      }
    });

    it('a failing notifier does NOT fail the creation — states and customer are persisted, remaining notifications are attempted', async () => {
      const error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
      const attempted: string[] = [];
      const failing: RolloutNotifier = {
        async notifyVersionPublished(_customer, version) {
          attempted.push(version.id);
          throw new Error('SMTP down');
        },
        async remind() {
          /* not used here */
        },
      };
      try {
        const created = await serviceWithNotifier(failing).create(
          { externalRef: 'ext-1', companyName: 'Acme', roles: ['customer'], contactEmails: ['legal@acme.io'] },
          ADMIN,
        );

        expect(created.id).toBeTruthy();
        expect((await states.findByCustomerAndVersion(created.id, 'v-dpa'))?.state).toBe('PENDING_NOTIFICATION');
        expect((await states.findByCustomerAndVersion(created.id, 'v-tos-c'))?.state).toBe('PENDING_NOTIFICATION');
        // Per-notification try/catch: BOTH versions were attempted despite the first failure.
        expect(attempted.sort()).toEqual(['v-dpa', 'v-tos-c']);
        expect(error).toHaveBeenCalledTimes(2);
        // The audit entry is still written (creation completed normally).
        expect((await audit.findByTarget('Customer', created.id))[0]).toMatchObject({ action: 'CUSTOMER_CREATE' });
      } finally {
        error.mockRestore();
      }
    });
  });

  describe('update', () => {
    it('updates a subset (200) and writes a CUSTOMER_UPDATE audit entry', async () => {
      const created = await service.create({ externalRef: 'ext-1', companyName: 'Old', roles: ['customer'], contactEmails: [] }, ADMIN);
      const updated = await service.update(created.id, { companyName: 'New', roles: ['customer', 'partner'] }, ADMIN);
      expect(updated).toMatchObject({ id: created.id, companyName: 'New', roles: ['customer', 'partner'] });
      expect((await audit.findByTarget('Customer', created.id)).some((l) => l.action === 'CUSTOMER_UPDATE')).toBe(true);
    });

    it('rejects an unknown id with CUSTOMER_NOT_FOUND (404)', async () => {
      await expect(service.update('c-ghost', { companyName: 'x' }, ADMIN)).rejects.toMatchObject({
        code: 'CUSTOMER_NOT_FOUND',
      });
    });

    it('rejects unknown roles with UNKNOWN_AUDIENCE', async () => {
      const created = await service.create({ externalRef: 'ext-1', companyName: 'x', roles: [], contactEmails: [] }, ADMIN);
      await expect(service.update(created.id, { roles: ['ghost'] }, ADMIN)).rejects.toMatchObject({
        code: 'UNKNOWN_AUDIENCE',
      });
    });

    it('rejects an invalid contactEmail with INVALID_STATE', async () => {
      const created = await service.create({ externalRef: 'ext-1', companyName: 'x', roles: [], contactEmails: [] }, ADMIN);
      await expect(service.update(created.id, { contactEmails: ['bad'] }, ADMIN)).rejects.toMatchObject({
        code: 'INVALID_STATE',
      });
    });

    it('rejects adding a role that would create an overlapping externalRef duplicate (INVALID_STATE)', async () => {
      // A customer record and a partner record share externalRef X (allowed: disjoint roles).
      await service.create({ externalRef: 'X', companyName: 'customer', roles: ['customer'], contactEmails: [] }, ADMIN);
      const partner = await service.create({ externalRef: 'X', companyName: 'partner', roles: ['partner'], contactEmails: [] }, ADMIN);
      // Adding role "customer" to the partner record would overlap the existing customer record.
      await expect(service.update(partner.id, { roles: ['partner', 'customer'] }, ADMIN)).rejects.toMatchObject({
        code: 'INVALID_STATE',
      });
    });

    it('allows re-saving the same roles on a customer whose externalRef is shared with a disjoint record', async () => {
      await service.create({ externalRef: 'X', companyName: 'customer', roles: ['customer'], contactEmails: [] }, ADMIN);
      const partner = await service.create({ externalRef: 'X', companyName: 'partner', roles: ['partner'], contactEmails: [] }, ADMIN);
      // The self-record must not count as its own overlapping duplicate.
      const updated = await service.update(partner.id, { roles: ['partner'], companyName: 'Partner Co' }, ADMIN);
      expect(updated).toMatchObject({ id: partner.id, roles: ['partner'], companyName: 'Partner Co' });
    });
  });
});

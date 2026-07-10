import { Logger } from '@nestjs/common';
import { InMemoryAdminAuditRepo } from '../agreements/audit';
import type { RolloutNotifier } from '../agreements/ports';
import { InMemoryRolloutNotifier } from '../agreements/rollout-notifier.inmemory';
import { DomainError } from '../common/errors';
import { PendingAgreementsService } from '../compliance/pending-agreements.service';
import { FakePdfUrlProvider } from '../compliance/testing/fake-pdf-url-provider';
import { FixedClock } from '../domain/clock';
import { anAudience, aState, aVersion } from '../domain/testing/fixtures';
import {
  InMemoryAcceptanceRepo,
  InMemoryAgreementDocumentRepo,
  InMemoryAgreementVersionRepo,
  InMemoryAudienceRepo,
  InMemoryCustomerRepo,
  InMemoryCustomerVersionStateRepo,
  InMemoryEventRepo,
} from '../persistence/inmemory';
import { EventRecorder } from '../events/event-recorder';
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
  let events: InMemoryEventRepo;
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
      new EventRecorder(events, new FixedClock(T0)),
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
    events = new InMemoryEventRepo();
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
      // No documents exist here, so every customer is compliant with nothing outstanding.
      expect(result.items).toEqual([
        { id: 'c-a', externalRef: 'ext-a', firstName: '', lastName: '', companyName: 'Alpha', roles: ['partner'], contactEmails: ['a@x.io'], compliant: true, complianceStatus: 'compliant' },
        { id: 'c-b', externalRef: 'ext-b', firstName: '', lastName: '', companyName: 'Beta', roles: ['customer'], contactEmails: [], compliant: true, complianceStatus: 'compliant' },
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

    describe('compliance filter and indicator', () => {
      // Three documents so documentType/audience scoping can be exercised: DPA + Terms for
      // customers, DPA for partners. One current published version per document.
      beforeEach(async () => {
        await documents.save({ id: 'doc-dpa-c', type: 'dpa', audience: 'customer', name: 'DPA — Customers' });
        await documents.save({ id: 'doc-terms-c', type: 'terms', audience: 'customer', name: 'Terms — Customers' });
        await documents.save({ id: 'doc-dpa-p', type: 'dpa', audience: 'partner', name: 'DPA — Partners' });
        await versions.save(aVersion({ id: 'v-dpa-c', documentId: 'doc-dpa-c', status: 'PUBLISHED' }));
        await versions.save(aVersion({ id: 'v-terms-c', documentId: 'doc-terms-c', status: 'PUBLISHED' }));
        await versions.save(aVersion({ id: 'v-dpa-p', documentId: 'doc-dpa-p', status: 'PUBLISHED' }));

        // One customer per compliance category, all on the customer DPA version.
        await customers.save({ id: 'c-compliant', externalRef: 'ext-ok', firstName: '', lastName: '', companyName: 'A Compliant', roles: ['customer'], contactEmails: [] });
        await customers.save({ id: 'c-pending', externalRef: 'ext-pend', firstName: '', lastName: '', companyName: 'B Pending', roles: ['customer'], contactEmails: [] });
        await customers.save({ id: 'c-blocked', externalRef: 'ext-block', firstName: '', lastName: '', companyName: 'C Blocked', roles: ['customer'], contactEmails: [] });
        await customers.save({ id: 'c-objected', externalRef: 'ext-obj', firstName: '', lastName: '', companyName: 'D Objected', roles: ['customer'], contactEmails: [] });
        await states.save(aState({ id: 's-ok', customerId: 'c-compliant', versionId: 'v-dpa-c', state: 'ACCEPTED' }));
        await states.save(aState({ id: 's-pend', customerId: 'c-pending', versionId: 'v-dpa-c', state: 'NOTIFIED', notifiedAt: T0, deadlineAt: new Date('2026-07-21T09:00:00Z') }));
        await states.save(aState({ id: 's-block', customerId: 'c-blocked', versionId: 'v-dpa-c', state: 'EXPIRED_BLOCKING' }));
        await states.save(aState({ id: 's-obj', customerId: 'c-objected', versionId: 'v-dpa-c', state: 'OBJECTED' }));
      });

      it('attaches a per-row compliance indicator (compliant + complianceStatus) to every row', async () => {
        const byId = new Map((await service.list()).items.map((r) => [r.id, r]));
        expect(byId.get('c-compliant')).toMatchObject({ compliant: true, complianceStatus: 'compliant' });
        expect(byId.get('c-pending')).toMatchObject({ compliant: true, complianceStatus: 'pending' });
        expect(byId.get('c-blocked')).toMatchObject({ compliant: false, complianceStatus: 'blocked' });
        expect(byId.get('c-objected')).toMatchObject({ compliant: true, complianceStatus: 'objected' });
      });

      it('compliance=compliant keeps only customers with nothing outstanding', async () => {
        const { items, total } = await service.list(undefined, undefined, { compliance: 'compliant' });
        expect(items.map((r) => r.id)).toEqual(['c-compliant']);
        expect(total).toBe(1);
      });

      it('compliance=non_compliant keeps only customers whose gate is closed', async () => {
        const { items } = await service.list(undefined, undefined, { compliance: 'non_compliant' });
        expect(items.map((r) => r.id)).toEqual(['c-blocked']);
      });

      it('compliance=pending keeps only customers with a PENDING/NOTIFIED state', async () => {
        const { items } = await service.list(undefined, undefined, { compliance: 'pending' });
        expect(items.map((r) => r.id)).toEqual(['c-pending']);
      });

      it('compliance=blocked keeps only customers with an EXPIRED_BLOCKING state', async () => {
        const { items } = await service.list(undefined, undefined, { compliance: 'blocked' });
        expect(items.map((r) => r.id)).toEqual(['c-blocked']);
      });

      it('compliance=objected keeps only customers with an OBJECTED state', async () => {
        const { items } = await service.list(undefined, undefined, { compliance: 'objected' });
        expect(items.map((r) => r.id)).toEqual(['c-objected']);
      });

      it('combines the compliance filter with search (filter first, then paginate)', async () => {
        const { items, total } = await service.list(undefined, 'Pending', { compliance: 'pending' });
        expect(items.map((r) => r.id)).toEqual(['c-pending']);
        expect(total).toBe(1);
        // A search that excludes the only pending customer yields nothing.
        expect((await service.list(undefined, 'Blocked', { compliance: 'pending' })).total).toBe(0);
      });

      it('documentType scopes the evaluation: a Terms objection is invisible under documentType=dpa', async () => {
        await customers.save({ id: 'c-terms-obj', externalRef: 'ext-tobj', firstName: '', lastName: '', companyName: 'E Terms', roles: ['customer'], contactEmails: [] });
        await states.save(aState({ id: 's-dpa-acc', customerId: 'c-terms-obj', versionId: 'v-dpa-c', state: 'ACCEPTED' }));
        await states.save(aState({ id: 's-terms-obj', customerId: 'c-terms-obj', versionId: 'v-terms-c', state: 'OBJECTED' }));

        const dpaObjected = await service.list(undefined, 'Terms', { documentType: 'dpa', compliance: 'objected' });
        expect(dpaObjected.items.map((r) => r.id)).toEqual([]);
        const termsObjected = await service.list(undefined, 'Terms', { documentType: 'terms', compliance: 'objected' });
        expect(termsObjected.items.map((r) => r.id)).toEqual(['c-terms-obj']);
      });

      it('audience scopes the evaluation to the matching role documents', async () => {
        await customers.save({ id: 'c-both', externalRef: 'ext-both', firstName: '', lastName: '', companyName: 'F Both', roles: ['customer', 'partner'], contactEmails: [] });
        // Compliant as a customer (accepted), blocked as a partner.
        await states.save(aState({ id: 's-both-c', customerId: 'c-both', versionId: 'v-dpa-c', state: 'ACCEPTED' }));
        await states.save(aState({ id: 's-both-p', customerId: 'c-both', versionId: 'v-dpa-p', state: 'EXPIRED_BLOCKING' }));

        const asPartner = await service.list(undefined, 'Both', { audience: 'partner', compliance: 'non_compliant' });
        expect(asPartner.items.map((r) => r.id)).toEqual(['c-both']);
        const asCustomer = await service.list(undefined, 'Both', { audience: 'customer', compliance: 'non_compliant' });
        expect(asCustomer.items.map((r) => r.id)).toEqual([]);
      });

      it('pagination reflects the compliance-filtered total', async () => {
        for (let i = 0; i < 55; i++) {
          const n = String(i).padStart(3, '0');
          await customers.save({ id: `cx-${n}`, externalRef: `bulk-${n}`, firstName: '', lastName: '', companyName: `Bulk ${n}`, roles: ['customer'], contactEmails: [] });
          await states.save(aState({ id: `sx-${n}`, customerId: `cx-${n}`, versionId: 'v-dpa-c', state: 'EXPIRED_BLOCKING' }));
        }
        // 55 bulk blocked customers + the fixture c-blocked = 56.
        const page1 = await service.list(1, undefined, { compliance: 'blocked' });
        expect(page1.items).toHaveLength(50);
        expect(page1.total).toBe(56);
        const page2 = await service.list(2, undefined, { compliance: 'blocked' });
        expect(page2.items).toHaveLength(6);
      });
    });

    describe('row narrowing by documentType/audience (only ASSIGNED customers)', () => {
      // Documents: terms/customer, dpa/customer, terms/partner (no dpa/partner). "Assigned" = the
      // customer's role matches a document's audience.
      beforeEach(async () => {
        await documents.save({ id: 'doc-terms-c', type: 'terms', audience: 'customer', name: 'Terms — Customers' });
        await documents.save({ id: 'doc-dpa-c', type: 'dpa', audience: 'customer', name: 'DPA — Customers' });
        await documents.save({ id: 'doc-terms-p', type: 'terms', audience: 'partner', name: 'Terms — Partners' });

        await customers.save({ id: 'c-cust', externalRef: 'ext-cust', firstName: '', lastName: '', companyName: 'A Customer', roles: ['customer'], contactEmails: [] });
        await customers.save({ id: 'c-part', externalRef: 'ext-part', firstName: '', lastName: '', companyName: 'B Partner', roles: ['partner'], contactEmails: [] });
        await customers.save({ id: 'c-both', externalRef: 'ext-both', firstName: '', lastName: '', companyName: 'C Both', roles: ['customer', 'partner'], contactEmails: [] });
        await customers.save({ id: 'c-none', externalRef: 'ext-none', firstName: '', lastName: '', companyName: 'D None', roles: [], contactEmails: [] });
      });

      const ids = (result: { items: { id: string }[] }): string[] => result.items.map((r) => r.id).sort();

      it('no documentType/audience → no narrowing (all customers returned)', async () => {
        const result = await service.list();
        expect(ids(result)).toEqual(['c-both', 'c-cust', 'c-none', 'c-part']);
        expect(result.total).toBe(4);
      });

      it('documentType=terms returns only customers assigned a type-terms document', async () => {
        // terms/customer + terms/partner exist → customer and partner roles are both assigned.
        const result = await service.list(undefined, undefined, { documentType: 'terms' });
        expect(ids(result)).toEqual(['c-both', 'c-cust', 'c-part']);
        expect(result.total).toBe(3);
      });

      it('documentType=dpa EXCLUDES a partner-only customer (no dpa/partner document) — the core regression', async () => {
        // Only dpa/customer exists; c-part (role partner) matches no dpa document and must be gone.
        const result = await service.list(undefined, undefined, { documentType: 'dpa' });
        expect(ids(result)).toEqual(['c-both', 'c-cust']);
        expect(result.total).toBe(2);
      });

      it('audience=partner returns only customers whose roles include partner', async () => {
        const result = await service.list(undefined, undefined, { audience: 'partner' });
        expect(ids(result)).toEqual(['c-both', 'c-part']);
        expect(result.total).toBe(2);
      });

      it('audience=customer excludes a customer without the customer role', async () => {
        const result = await service.list(undefined, undefined, { audience: 'customer' });
        expect(ids(result)).toEqual(['c-both', 'c-cust']);
        expect(result.total).toBe(2);
      });

      it('both documentType=terms & audience=partner narrows to the intersection', async () => {
        // Role partner present AND a terms document with audience partner exists (terms/partner).
        const result = await service.list(undefined, undefined, { documentType: 'terms', audience: 'partner' });
        expect(ids(result)).toEqual(['c-both', 'c-part']);
        expect(result.total).toBe(2);
      });

      it('both documentType=dpa & audience=partner → empty (no dpa/partner document exists)', async () => {
        const result = await service.list(undefined, undefined, { documentType: 'dpa', audience: 'partner' });
        expect(result.items).toEqual([]);
        expect(result.total).toBe(0);
      });

      it('unknown documentType → empty (no matching document)', async () => {
        const result = await service.list(undefined, undefined, { documentType: 'ghost' });
        expect(result.items).toEqual([]);
        expect(result.total).toBe(0);
      });

      it('unknown audience → empty (no customer has that role)', async () => {
        const result = await service.list(undefined, undefined, { audience: 'ghost' });
        expect(result.items).toEqual([]);
        expect(result.total).toBe(0);
      });

      it('narrowing runs before the compliance filter and pagination (total is the narrowed+filtered count)', async () => {
        await versions.save(aVersion({ id: 'v-dpa-c', documentId: 'doc-dpa-c', status: 'PUBLISHED' }));
        // c-cust is blocked on the customer DPA; c-both is compliant there.
        await states.save(aState({ id: 's-cust-block', customerId: 'c-cust', versionId: 'v-dpa-c', state: 'EXPIRED_BLOCKING' }));
        await states.save(aState({ id: 's-both-ok', customerId: 'c-both', versionId: 'v-dpa-c', state: 'ACCEPTED' }));

        // documentType=dpa narrows to {c-cust, c-both}; compliance=blocked keeps only c-cust.
        const result = await service.list(undefined, undefined, { documentType: 'dpa', compliance: 'blocked' });
        expect(ids(result)).toEqual(['c-cust']);
        expect(result.total).toBe(1);
      });
    });
  });

  describe('get', () => {
    it('returns the full customer row by id', async () => {
      await customers.save({ id: 'c-acme', externalRef: 'crm-1', firstName: 'Jo', lastName: 'Doe', companyName: 'Acme GmbH', roles: ['customer'], contactEmails: ['legal@acme.example'] });
      expect(await service.get('c-acme')).toEqual({
        id: 'c-acme',
        externalRef: 'crm-1',
        firstName: 'Jo',
        lastName: 'Doe',
        companyName: 'Acme GmbH',
        roles: ['customer'],
        contactEmails: ['legal@acme.example'],
      });
    });

    it('CUSTOMER_NOT_FOUND for an unknown id', async () => {
      await expect(service.get('missing')).rejects.toMatchObject({ name: 'DomainError', code: 'CUSTOMER_NOT_FOUND' });
    });

    it('still returns a soft-deleted customer (with deletedAt) so its history stays viewable', async () => {
      const deletedAt = new Date('2026-07-08T00:00:00Z');
      await customers.save({ id: 'c-del', externalRef: 'crm-9', firstName: 'Jo', lastName: 'Doe', roles: ['customer'], contactEmails: [], source: 'metergrid', deletedAt });
      const row = await service.get('c-del');
      expect(row.id).toBe('c-del');
      expect(row.deletedAt).toEqual(deletedAt);
    });
  });

  describe('soft-delete handling', () => {
    it('list EXCLUDES soft-deleted customers', async () => {
      await customers.save({ id: 'c-active', externalRef: 'a', firstName: '', lastName: '', companyName: 'Active', roles: ['customer'], contactEmails: [] });
      await customers.save({ id: 'c-deleted', externalRef: 'd', firstName: '', lastName: '', companyName: 'Deleted', roles: ['customer'], contactEmails: [], source: 'metergrid', deletedAt: new Date('2026-07-08T00:00:00Z') });

      const result = await service.list();
      expect(result.total).toBe(1);
      expect(result.items.map((r) => r.id)).toEqual(['c-active']);
    });

    it('update() rejects a soft-deleted customer (it must not silently reappear as active)', async () => {
      await customers.save({ id: 'c-del', externalRef: 'crm-9', firstName: 'Jo', lastName: 'Doe', roles: ['customer'], contactEmails: [], source: 'metergrid', deletedAt: new Date('2026-07-08T00:00:00Z') });
      await expect(service.update('c-del', { firstName: 'X' }, ADMIN)).rejects.toMatchObject({ code: 'INVALID_STATE' });
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

    it('create: emits OBLIGATION_ROLLED_OUT (CONSENT, ADMIN) once per created state', async () => {
      const created = await service.create(
        { externalRef: 'ext-1', companyName: 'Acme', roles: ['customer'], contactEmails: [] },
        ADMIN,
      );

      const obligations = (await events.query({})).items.filter((e) => e.type === 'OBLIGATION_ROLLED_OUT');
      expect(obligations).toHaveLength(1);
      expect(obligations[0]).toMatchObject({
        category: 'CONSENT',
        actorKind: 'ADMIN',
        customerId: created.id,
        versionId: 'v-dpa',
        documentType: 'dpa',
        summary: expect.stringContaining('put under obligation'),
      });
    });

    it('integration source: OBLIGATION_ROLLED_OUT is a SYSTEM action', async () => {
      const created = await service.create(
        { externalRef: 'ext-1', companyName: 'Acme', roles: ['customer'], contactEmails: [] },
        ADMIN,
        'integration',
      );

      const obligations = (await events.query({})).items.filter((e) => e.type === 'OBLIGATION_ROLLED_OUT');
      expect(obligations).toHaveLength(1);
      expect(obligations[0].actorKind).toBe('SYSTEM');
      expect(obligations[0].customerId).toBe(created.id);
    });

    it('emits NO OBLIGATION_ROLLED_OUT when a state already exists (no new rollout)', async () => {
      const created = await service.create(
        { externalRef: 'ext-1', companyName: 'Acme', roles: ['customer'], contactEmails: [] },
        ADMIN,
      );
      // Second update with no added role → no new states, no new obligation events.
      const before = (await events.query({})).items.filter((e) => e.type === 'OBLIGATION_ROLLED_OUT').length;
      await service.update(created.id, { companyName: 'Acme 2' }, ADMIN);
      const after = (await events.query({})).items.filter((e) => e.type === 'OBLIGATION_ROLLED_OUT').length;
      expect(after).toBe(before);
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

  describe('event recording', () => {
    it('records a CUSTOMER_CREATED event on success', async () => {
      const created = await service.create(
        { externalRef: 'ext-1', companyName: 'Acme', roles: ['customer'], contactEmails: [] },
        ADMIN,
      );
      const { items } = await events.query({ customerId: created.id });
      expect(items.some((e) => e.type === 'CUSTOMER_CREATED' && e.actorKind === 'ADMIN')).toBe(true);
    });

    it('records a CUSTOMER_UPDATED event on success', async () => {
      const created = await service.create(
        { externalRef: 'ext-1', companyName: 'Acme', roles: ['customer'], contactEmails: [] },
        ADMIN,
      );
      await service.update(created.id, { companyName: 'Acme 2' }, ADMIN);
      const { items } = await events.query({ customerId: created.id });
      expect(items.some((e) => e.type === 'CUSTOMER_UPDATED')).toBe(true);
    });

    it('records NO event when create validation fails', async () => {
      await expect(
        service.create({ externalRef: 'ext-1', roles: ['ghost'], contactEmails: [] }, ADMIN),
      ).rejects.toMatchObject({ code: 'UNKNOWN_AUDIENCE' });
      expect((await events.query({})).total).toBe(0);
    });
  });

  describe('inbound upsert/deactivate by externalRef (integration push)', () => {
    const SYSTEM = { userId: 'mainportal-svc' };
    const eventsOfType = async (type: string): Promise<number> =>
      (await events.query({})).items.filter((e) => e.type === type).length;

    describe('upsertByExternalRef', () => {
      it('creates a source-tagged customer and records CUSTOMER_CREATED (SYSTEM) when no match exists', async () => {
        const row = await service.upsertByExternalRef(
          { externalRef: 'crm-1', companyName: 'Acme', roles: ['customer'], contactEmails: ['legal@acme.io'], source: 'mainportal' },
          SYSTEM,
        );
        expect(row).toMatchObject({ externalRef: 'crm-1', companyName: 'Acme', roles: ['customer'], contactEmails: ['legal@acme.io'] });
        expect(row).not.toHaveProperty('importedAcceptances');

        const stored = (await customers.findBySource('mainportal')).find((c) => c.externalRef === 'crm-1');
        expect(stored?.source).toBe('mainportal');

        const created = (await events.query({ customerId: row.id })).items.filter((e) => e.type === 'CUSTOMER_CREATED');
        expect(created).toHaveLength(1);
        expect(created[0].actorKind).toBe('SYSTEM');
      });

      it('defaults the source to "external" when omitted', async () => {
        const row = await service.upsertByExternalRef(
          { externalRef: 'crm-1', companyName: 'Acme', roles: ['customer'], contactEmails: [] },
          SYSTEM,
        );
        const stored = await customers.findById(row.id);
        expect(stored?.source).toBe('external');
      });

      it('updates only the changed fields on an active match and records CUSTOMER_UPDATED', async () => {
        const created = await service.upsertByExternalRef(
          { externalRef: 'crm-1', companyName: 'Old', roles: ['customer'], contactEmails: [], source: 'mainportal' },
          SYSTEM,
        );
        const updated = await service.upsertByExternalRef(
          { externalRef: 'crm-1', companyName: 'New', roles: ['customer'], contactEmails: [], source: 'mainportal' },
          SYSTEM,
        );
        expect(updated.id).toBe(created.id);
        expect(updated.companyName).toBe('New');
        expect(await eventsOfType('CUSTOMER_UPDATED')).toBe(1);
      });

      it('is idempotent: re-sending an identical payload does NOT write and records NO event', async () => {
        await service.upsertByExternalRef(
          { externalRef: 'crm-1', firstName: 'Jane', companyName: 'Acme', roles: ['customer'], contactEmails: ['a@x.io'], source: 'mainportal' },
          SYSTEM,
        );
        await service.upsertByExternalRef(
          { externalRef: 'crm-1', firstName: 'Jane', companyName: 'Acme', roles: ['customer'], contactEmails: ['a@x.io'], source: 'mainportal' },
          SYSTEM,
        );
        expect(await eventsOfType('CUSTOMER_UPDATED')).toBe(0);
        expect(await eventsOfType('CUSTOMER_CREATED')).toBe(1);
      });

      it('ignores a mere reordering of roles/contactEmails (no update)', async () => {
        await service.upsertByExternalRef(
          { externalRef: 'crm-1', roles: ['customer', 'partner'], contactEmails: ['a@x.io', 'b@x.io'], source: 'mainportal' },
          SYSTEM,
        );
        await service.upsertByExternalRef(
          { externalRef: 'crm-1', roles: ['partner', 'customer'], contactEmails: ['b@x.io', 'a@x.io'], source: 'mainportal' },
          SYSTEM,
        );
        expect(await eventsOfType('CUSTOMER_UPDATED')).toBe(0);
      });

      it('reactivates a soft-deleted match (clears deletedAt, applies fields) and records CUSTOMER_UPDATED', async () => {
        const created = await service.upsertByExternalRef(
          { externalRef: 'crm-1', companyName: 'Acme', roles: ['customer'], contactEmails: [], source: 'mainportal' },
          SYSTEM,
        );
        await service.deactivateByExternalRef('crm-1', 'customer', SYSTEM);
        expect((await customers.findById(created.id))?.deletedAt).toBeDefined();

        const reactivated = await service.upsertByExternalRef(
          { externalRef: 'crm-1', companyName: 'Acme Reborn', roles: ['customer'], contactEmails: [], source: 'mainportal' },
          SYSTEM,
        );
        expect(reactivated.id).toBe(created.id);
        expect(reactivated.companyName).toBe('Acme Reborn');
        expect((await customers.findById(created.id))?.deletedAt).toBeUndefined();

        const updates = (await events.query({})).items.filter((e) => e.type === 'CUSTOMER_UPDATED');
        expect(updates.some((e) => e.metadata?.reactivated === true && e.actorKind === 'SYSTEM')).toBe(true);
      });

      it('scopes by audience: a different-audience customer sharing the externalRef is left untouched (separate record)', async () => {
        // A record with the SAME externalRef but a DISJOINT audience (partner) must not be matched
        // when pushing the customer-audience record — externalRef is only unique per audience.
        const partner = await service.create(
          { externalRef: 'crm-1', companyName: 'Partner', roles: ['partner'], contactEmails: [], source: 'othersource' },
          ADMIN,
          'integration',
        );
        const pushed = await service.upsertByExternalRef(
          { externalRef: 'crm-1', companyName: 'Portal', roles: ['customer'], contactEmails: [], source: 'mainportal' },
          SYSTEM,
        );
        expect(pushed.id).not.toBe(partner.id);
        // The partner-audience record is untouched (different audience).
        expect(await customers.findById(partner.id)).toMatchObject({ companyName: 'Partner', roles: ['partner'] });
        // Both coexist under the same externalRef.
        expect(await customers.findAllByExternalRef('crm-1')).toHaveLength(2);
      });

      it('resolves by audience regardless of source: updates an existing same-audience record even if it carries a different source', async () => {
        // The BUG FIX: resolution is by (externalRef, audience), NOT (source, externalRef). A record
        // created under one source is updated by an inbound push carrying a different source.
        const existing = await service.create(
          { externalRef: 'crm-1', companyName: 'Old', roles: ['customer'], contactEmails: [], source: 'othersource' },
          ADMIN,
          'integration',
        );
        const upserted = await service.upsertByExternalRef(
          { externalRef: 'crm-1', companyName: 'New', roles: ['customer'], contactEmails: [], source: 'mainportal' },
          SYSTEM,
        );
        expect(upserted.id).toBe(existing.id);
        expect(upserted.companyName).toBe('New');
        // No duplicate created — the same (externalRef, audience) record was updated in place.
        expect(await customers.findAllByExternalRef('crm-1')).toHaveLength(1);
      });

      it('rejects an unknown role with UNKNOWN_AUDIENCE (no write)', async () => {
        await expect(
          service.upsertByExternalRef({ externalRef: 'crm-1', roles: ['ghost'], contactEmails: [], source: 'mainportal' }, SYSTEM),
        ).rejects.toMatchObject({ code: 'UNKNOWN_AUDIENCE' });
        expect((await events.query({})).total).toBe(0);
      });

      it('rejects an invalid contact e-mail with INVALID_STATE (no write)', async () => {
        await expect(
          service.upsertByExternalRef(
            { externalRef: 'crm-1', roles: ['customer'], contactEmails: ['not-an-email'], source: 'mainportal' },
            SYSTEM,
          ),
        ).rejects.toMatchObject({ code: 'INVALID_STATE' });
      });

      it('rejects a blank externalRef with INVALID_STATE', async () => {
        await expect(
          service.upsertByExternalRef({ externalRef: '  ', roles: ['customer'], contactEmails: [], source: 'mainportal' }, SYSTEM),
        ).rejects.toMatchObject({ code: 'INVALID_STATE' });
      });
    });

    describe('deactivateByExternalRef', () => {
      it('soft-deletes the matching customer and records CUSTOMER_DELETED (SYSTEM)', async () => {
        const created = await service.upsertByExternalRef(
          { externalRef: 'crm-1', companyName: 'Acme', roles: ['customer'], contactEmails: [], source: 'mainportal' },
          SYSTEM,
        );
        await service.deactivateByExternalRef('crm-1', 'customer', SYSTEM);

        expect((await customers.findById(created.id))?.deletedAt).toBeDefined();
        const deleted = (await events.query({})).items.filter((e) => e.type === 'CUSTOMER_DELETED');
        expect(deleted).toHaveLength(1);
        expect(deleted[0].actorKind).toBe('SYSTEM');
      });

      it('is idempotent: a second deactivate (already soft-deleted) records NO event', async () => {
        await service.upsertByExternalRef(
          { externalRef: 'crm-1', roles: ['customer'], contactEmails: [], source: 'mainportal' },
          SYSTEM,
        );
        await service.deactivateByExternalRef('crm-1', 'customer', SYSTEM);
        await service.deactivateByExternalRef('crm-1', 'customer', SYSTEM);
        expect(await eventsOfType('CUSTOMER_DELETED')).toBe(1);
      });

      it('is a no-op for an unknown externalRef (no event)', async () => {
        await service.deactivateByExternalRef('ghost', 'customer', SYSTEM);
        expect(await eventsOfType('CUSTOMER_DELETED')).toBe(0);
      });

      it('is a no-op for an audience that matches no record carrying the externalRef (no event)', async () => {
        const created = await service.upsertByExternalRef(
          { externalRef: 'crm-1', roles: ['customer'], contactEmails: [] },
          SYSTEM,
        );
        // Audience 'partner' matches no record for crm-1 → no-op; the customer record stays active.
        await service.deactivateByExternalRef('crm-1', 'partner', SYSTEM);
        expect((await customers.findById(created.id))?.deletedAt).toBeUndefined();
        expect(await eventsOfType('CUSTOMER_DELETED')).toBe(0);
      });

      it('scopes by audience: soft-deletes only the record of the given audience, leaving a different-audience sibling active', async () => {
        const customer = await service.upsertByExternalRef(
          { externalRef: 'crm-1', roles: ['customer'], contactEmails: [], source: 'mainportal' },
          SYSTEM,
        );
        const partner = await service.upsertByExternalRef(
          { externalRef: 'crm-1', roles: ['partner'], contactEmails: [], source: 'mainportal' },
          SYSTEM,
        );
        // Deactivate the partner audience only.
        await service.deactivateByExternalRef('crm-1', 'partner', SYSTEM);
        expect((await customers.findById(partner.id))?.deletedAt).toBeDefined();
        expect((await customers.findById(customer.id))?.deletedAt).toBeUndefined();
        // Then the customer audience.
        await service.deactivateByExternalRef('crm-1', 'customer', SYSTEM);
        expect((await customers.findById(customer.id))?.deletedAt).toBeDefined();
      });
    });
  });
});

import { NotFoundException } from '@nestjs/common';
import { InMemoryAdminAuditRepo } from '../agreements/audit.js';
import { DomainError } from '../common/errors.js';
import { FixedClock } from '../domain/clock.js';
import { anAudience, aCustomer, aDocument } from '../domain/testing/fixtures.js';
import { InMemoryAgreementDocumentRepo, InMemoryAudienceRepo, InMemoryCustomerRepo } from '../persistence/inmemory/index.js';
import { AudienceAdminService } from './audience-admin.service.js';

const T0 = new Date('2026-07-07T09:00:00Z');

describe('AudienceAdminService', () => {
  let audiences: InMemoryAudienceRepo;
  let documents: InMemoryAgreementDocumentRepo;
  let customers: InMemoryCustomerRepo;
  let audit: InMemoryAdminAuditRepo;
  let service: AudienceAdminService;

  beforeEach(() => {
    documents = new InMemoryAgreementDocumentRepo();
    customers = new InMemoryCustomerRepo();
    audiences = new InMemoryAudienceRepo(documents, customers);
    audit = new InMemoryAdminAuditRepo();
    service = new AudienceAdminService(audiences, audit, new FixedClock(T0));
  });

  describe('list', () => {
    it('returns all audiences sorted by key', async () => {
      await audiences.save(anAudience({ id: 'aud-2', key: 'partner', name: 'Partners' }));
      await audiences.save(anAudience({ id: 'aud-1', key: 'customer', name: 'Customers' }));

      expect(await service.list()).toEqual([
        { id: 'aud-1', key: 'customer', name: 'Customers' },
        { id: 'aud-2', key: 'partner', name: 'Partners' },
      ]);
    });

    it('returns an empty list when there are none', async () => {
      expect(await service.list()).toEqual([]);
    });
  });

  describe('create', () => {
    it('creates an audience and writes an audit log entry', async () => {
      const created = await service.create({ key: 'customer', name: 'Customers' }, 'admin-1');

      expect(created).toMatchObject({ key: 'customer', name: 'Customers' });
      expect(created.id).toBeTruthy();
      const logs = await audit.findByTarget('Audience', created.id);
      expect(logs).toHaveLength(1);
      expect(logs[0]).toMatchObject({
        action: 'AUDIENCE_CREATE',
        actor: 'admin-1',
        targetType: 'Audience',
        targetId: created.id,
        createdAt: T0,
      });
    });

    it('rejects an invalid slug key with INVALID_STATE, no audit entry', async () => {
      await expect(service.create({ key: 'Not A Slug', name: 'x' }, 'admin-1')).rejects.toMatchObject({
        code: 'INVALID_STATE',
      });
      expect(await audit.findAll()).toHaveLength(0);
    });

    it('rejects a duplicate key with INVALID_STATE', async () => {
      await service.create({ key: 'customer', name: 'Customers' }, 'admin-1');
      await expect(service.create({ key: 'customer', name: 'Other' }, 'admin-1')).rejects.toBeInstanceOf(
        DomainError,
      );
    });

    it('rejects a missing name with INVALID_STATE', async () => {
      await expect(service.create({ key: 'customer', name: '' }, 'admin-1')).rejects.toMatchObject({
        code: 'INVALID_STATE',
      });
    });
  });

  describe('update', () => {
    it('renames an audience (200) and writes an audit log entry', async () => {
      const created = await service.create({ key: 'customer', name: 'Customers' }, 'admin-1');

      const updated = await service.update(created.id, { name: 'End customers' }, 'admin-2');

      expect(updated).toEqual({ id: created.id, key: 'customer', name: 'End customers' });
      const logs = await audit.findByTarget('Audience', created.id);
      expect(logs.some((l) => l.action === 'AUDIENCE_UPDATE' && l.actor === 'admin-2')).toBe(true);
    });

    it('rejects a body containing key with INVALID_STATE "key is immutable"', async () => {
      const created = await service.create({ key: 'customer', name: 'Customers' }, 'admin-1');

      await expect(service.update(created.id, { key: 'partner', name: 'x' }, 'admin-1')).rejects.toMatchObject({
        code: 'INVALID_STATE',
        message: 'key is immutable',
      });
      expect(await audiences.findByKey('customer')).toBeDefined();
    });

    it('throws NotFoundException for an unknown id', async () => {
      await expect(service.update('aud-ghost', { name: 'x' }, 'admin-1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('remove', () => {
    it('deletes an unreferenced audience (writes an audit log entry)', async () => {
      const created = await service.create({ key: 'customer', name: 'Customers' }, 'admin-1');

      await service.remove(created.id, 'admin-1');

      expect(await audiences.findByKey('customer')).toBeUndefined();
      const logs = await audit.findByTarget('Audience', created.id);
      expect(logs.some((l) => l.action === 'AUDIENCE_DELETE')).toBe(true);
    });

    it('refuses deletion while referenced by a document → INVALID_STATE, no audit entry', async () => {
      const created = await service.create({ key: 'customer', name: 'Customers' }, 'admin-1');
      await documents.save(aDocument({ audience: 'customer' }));

      await expect(service.remove(created.id, 'admin-1')).rejects.toMatchObject({
        code: 'INVALID_STATE',
        message: 'audience is still in use',
      });
      expect(await audiences.findByKey('customer')).toBeDefined();
      expect((await audit.findByTarget('Audience', created.id)).some((l) => l.action === 'AUDIENCE_DELETE')).toBe(
        false,
      );
    });

    it('refuses deletion while referenced by a customer role → INVALID_STATE', async () => {
      const created = await service.create({ key: 'customer', name: 'Customers' }, 'admin-1');
      await customers.save(aCustomer({ roles: ['customer'] }));

      await expect(service.remove(created.id, 'admin-1')).rejects.toMatchObject({ code: 'INVALID_STATE' });
    });

    it('throws NotFoundException for an unknown id', async () => {
      await expect(service.remove('aud-ghost', 'admin-1')).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});

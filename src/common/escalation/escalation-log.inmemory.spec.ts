import { InMemoryEscalationLog } from './escalation-log.inmemory';
import type { EscalationEntry } from './escalation-log';

const anEntry = (overrides: Partial<EscalationEntry> = {}): EscalationEntry => ({
  id: 'esc-1',
  kind: 'EMAIL_BOUNCE',
  customerId: 'c-123',
  versionId: 'v-1',
  recipient: 'max@customer.example',
  occurredAt: new Date('2026-07-07T09:00:00Z'),
  inactivatedEmail: false,
  ...overrides,
});

describe('InMemoryEscalationLog', () => {
  it('record + findAll returns all entries', async () => {
    const log = new InMemoryEscalationLog();
    await log.record(anEntry());
    await log.record(anEntry({ id: 'esc-2', inactivatedEmail: true }));

    const all = await log.findAll();

    expect(all).toHaveLength(2);
    expect(all.find((e) => e.id === 'esc-2')?.inactivatedEmail).toBe(true);
  });

  it('findByCustomer filters by customer', async () => {
    const log = new InMemoryEscalationLog();
    await log.record(anEntry());
    await log.record(anEntry({ id: 'esc-2', kind: 'OBJECTION_AFTER_PERIOD', customerId: 'c-999' }));

    const forCustomer = await log.findByCustomer('c-999');

    expect(forCustomer).toHaveLength(1);
    expect(forCustomer[0]).toMatchObject({ id: 'esc-2', kind: 'OBJECTION_AFTER_PERIOD' });
  });

  it('returns copies — mutating the return value does not change the store', async () => {
    const log = new InMemoryEscalationLog();
    await log.record(anEntry());
    const [entry] = await log.findAll();
    entry.recipient = 'mutated@customer.example';
    const [again] = await log.findAll();
    expect(again.recipient).toBe('max@customer.example');
  });
});

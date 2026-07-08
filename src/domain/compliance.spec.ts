import { computeCompliance, type CurrentVersionEntry } from './compliance';
import { aCustomer, aDocument, aState, aVersion, anActiveVersion } from './testing/fixtures';
import type { CustomerVersionState } from './types';

const T0 = new Date('2026-07-07T09:00:00Z');
const DEADLINE = new Date('2026-07-21T09:00:00Z');

const dpaCustomer: CurrentVersionEntry = {
  document: aDocument({ id: 'doc-dpa-c', type: 'dpa', audience: 'customer' }),
  version: aVersion({ id: 'v-dpa-c', documentId: 'doc-dpa-c', versionLabel: 'June 2026 edition' }),
};
const dpaCustomerActive: CurrentVersionEntry = {
  document: dpaCustomer.document,
  version: anActiveVersion({ id: 'v-dpa-c', documentId: 'doc-dpa-c' }),
};
const termsPartner: CurrentVersionEntry = {
  document: aDocument({ id: 'doc-terms-p', type: 'terms', audience: 'partner' }),
  version: aVersion({ id: 'v-terms-p', documentId: 'doc-terms-p' }),
};

const stateFor = (entry: CurrentVersionEntry, overrides: Partial<CustomerVersionState>): CustomerVersionState =>
  aState({ id: `cvs-${entry.version.id}`, versionId: entry.version.id, ...overrides });

describe('computeCompliance — semantics table', () => {
  it('case 1: current version accepted → compliant', () => {
    const result = computeCompliance(
      aCustomer(),
      [dpaCustomer],
      [stateFor(dpaCustomer, { state: 'ACCEPTED' })],
      'customer',
    );
    expect(result.compliant).toBe(true);
    expect(result.details['DPA_CUSTOMER']).toMatchObject({
      requiredVersionId: 'v-dpa-c',
      requiredVersionLabel: 'June 2026 edition',
      state: 'ACCEPTED',
      compliant: true,
    });
  });

  it('case 2: PASSIVE published, period still running → compliant (pending)', () => {
    const result = computeCompliance(
      aCustomer(),
      [dpaCustomer],
      [stateFor(dpaCustomer, { state: 'NOTIFIED', notifiedAt: T0, deadlineAt: DEADLINE })],
      'customer',
    );
    expect(result.compliant).toBe(true);
    expect(result.details['DPA_CUSTOMER']).toMatchObject({
      state: 'NOTIFIED',
      pendingMode: 'PASSIVE',
      deadlineAt: DEADLINE,
      compliant: true,
    });
  });

  it('case 3: PASSIVE period expired without objection (sweeper has not run yet) → compliant (TACIT will be recorded)', () => {
    // State is still NOTIFIED, deadlineAt lies in the past — still no block.
    const result = computeCompliance(
      aCustomer(),
      [dpaCustomer],
      [stateFor(dpaCustomer, { state: 'NOTIFIED', notifiedAt: T0, deadlineAt: new Date('2026-01-01T00:00:00Z') })],
      'customer',
    );
    expect(result.compliant).toBe(true);
  });

  it('case 4: ACTIVE published, grace period still running → compliant (popup forces a decision)', () => {
    const result = computeCompliance(
      aCustomer(),
      [dpaCustomerActive],
      [stateFor(dpaCustomerActive, { state: 'NOTIFIED', notifiedAt: T0, deadlineAt: DEADLINE })],
      'customer',
    );
    expect(result.compliant).toBe(true);
    expect(result.details['DPA_CUSTOMER']).toMatchObject({ pendingMode: 'ACTIVE', compliant: true });
  });

  it('case 5: ACTIVE grace period expired without consent (EXPIRED_BLOCKING) → NOT compliant', () => {
    const result = computeCompliance(
      aCustomer(),
      [dpaCustomerActive],
      [stateFor(dpaCustomerActive, { state: 'EXPIRED_BLOCKING', notifiedAt: T0, deadlineAt: DEADLINE })],
      'customer',
    );
    expect(result.compliant).toBe(false);
    expect(result.details['DPA_CUSTOMER']).toMatchObject({ state: 'EXPIRED_BLOCKING', compliant: false });
  });

  it('case 6: objection raised (OBJECTED) → compliant, no block', () => {
    const result = computeCompliance(
      aCustomer(),
      [dpaCustomer],
      [stateFor(dpaCustomer, { state: 'OBJECTED', notifiedAt: T0, deadlineAt: DEADLINE })],
      'customer',
    );
    expect(result.compliant).toBe(true);
    expect(result.details['DPA_CUSTOMER']).toMatchObject({ state: 'OBJECTED', compliant: true });
  });

  it('case 7: no provable delivery (PENDING_NOTIFICATION, deadline never started) → compliant', () => {
    const result = computeCompliance(
      aCustomer(),
      [dpaCustomer],
      [stateFor(dpaCustomer, { state: 'PENDING_NOTIFICATION' })],
      'customer',
    );
    expect(result.compliant).toBe(true);
    expect(result.details['DPA_CUSTOMER']).toMatchObject({ state: 'PENDING_NOTIFICATION', compliant: true });
  });

  // A document update does not lift existing blocks.
  describe('block carry-over', () => {
    it('blocked customer stays non-compliant after the successor version is published (PENDING_NOTIFICATION + carryOverBlocking)', () => {
      const result = computeCompliance(
        aCustomer(),
        [dpaCustomerActive],
        [stateFor(dpaCustomerActive, { state: 'PENDING_NOTIFICATION', carryOverBlocking: true })],
        'customer',
      );
      expect(result.compliant).toBe(false);
      expect(result.details['DPA_CUSTOMER']).toMatchObject({ state: 'PENDING_NOTIFICATION', compliant: false });
    });

    it('stays non-compliant even after delivery (NOTIFIED + carryOverBlocking) until they accept', () => {
      const notified = computeCompliance(
        aCustomer(),
        [dpaCustomerActive],
        [stateFor(dpaCustomerActive, { state: 'NOTIFIED', notifiedAt: T0, deadlineAt: T0, carryOverBlocking: true })],
        'customer',
      );
      expect(notified.compliant).toBe(false);

      const accepted = computeCompliance(
        aCustomer(),
        [dpaCustomerActive],
        [stateFor(dpaCustomerActive, { state: 'ACCEPTED', notifiedAt: T0, carryOverBlocking: true })],
        'customer',
      );
      expect(accepted.compliant).toBe(true);
    });

    it('regular customer (no carry-over) stays compliant during the grace period', () => {
      const result = computeCompliance(
        aCustomer(),
        [dpaCustomerActive],
        [stateFor(dpaCustomerActive, { state: 'NOTIFIED', notifiedAt: T0, deadlineAt: DEADLINE })],
        'customer',
      );
      expect(result.compliant).toBe(true);
    });
  });

  it('missing CustomerVersionState (rollout has not run yet) → compliant', () => {
    const result = computeCompliance(aCustomer(), [dpaCustomer], [], 'customer');
    expect(result.compliant).toBe(true);
    expect(result.details['DPA_CUSTOMER']).toMatchObject({ requiredVersionId: 'v-dpa-c', compliant: true });
  });

  it('customer without any role (sync gap): compliant=true, roles: [], no details — never blocked by master data', () => {
    const result = computeCompliance(aCustomer({ roles: [] }), [dpaCustomer, termsPartner], []);
    expect(result.compliant).toBe(true);
    expect(result.roles).toEqual([]);
    expect(result.details).toEqual({});
  });
});

describe('computeCompliance — roles & aggregation', () => {
  const dualRole = aCustomer({ roles: ['customer', 'partner'] });

  it('audience filter: only documents of the requested audience count (independent gates)', () => {
    const blockedPartnerState = stateFor(termsPartner, { state: 'EXPIRED_BLOCKING' });
    const result = computeCompliance(
      dualRole,
      [dpaCustomer, termsPartner],
      [stateFor(dpaCustomer, { state: 'ACCEPTED' }), blockedPartnerState],
      'customer',
    );
    expect(result.compliant).toBe(true); // the partner block does not affect the customer gate
    expect(result.details['TERMS_PARTNER']).toBeUndefined();
    expect(result.audience).toBe('customer');
    expect(result.roles).toEqual(['customer', 'partner']);
  });

  it('aggregation without audience: AND across all roles, TYPE_AUDIENCE keys are collision-free', () => {
    const result = computeCompliance(
      dualRole,
      [dpaCustomer, termsPartner],
      [stateFor(dpaCustomer, { state: 'ACCEPTED' }), stateFor(termsPartner, { state: 'EXPIRED_BLOCKING' })],
    );
    expect(result.compliant).toBe(false);
    expect(Object.keys(result.details).sort()).toEqual(['DPA_CUSTOMER', 'TERMS_PARTNER']);
    expect(result.details['DPA_CUSTOMER'].compliant).toBe(true);
    expect(result.details['TERMS_PARTNER'].compliant).toBe(false);
    expect(result.audience).toBeUndefined();
  });

  it('requested audience the customer does not have: only their roles count → compliant, no details', () => {
    const customerOnly = aCustomer({ roles: ['customer'] });
    const result = computeCompliance(
      customerOnly,
      [dpaCustomer, termsPartner],
      [stateFor(termsPartner, { state: 'EXPIRED_BLOCKING' })],
      'partner',
    );
    expect(result.compliant).toBe(true);
    expect(result.details).toEqual({});
    expect(result.roles).toEqual(['customer']);
  });

  it('versions for audiences the customer has no role in are also excluded from the aggregation', () => {
    const customerOnly = aCustomer({ roles: ['customer'] });
    const result = computeCompliance(
      customerOnly,
      [dpaCustomer, termsPartner],
      [stateFor(dpaCustomer, { state: 'ACCEPTED' }), stateFor(termsPartner, { state: 'EXPIRED_BLOCKING' })],
    );
    expect(result.compliant).toBe(true);
    expect(Object.keys(result.details)).toEqual(['DPA_CUSTOMER']);
  });

  it('overall compliant is AND across all document types of the audience', () => {
    const termsCustomer: CurrentVersionEntry = {
      document: aDocument({ id: 'doc-terms-c', type: 'terms', audience: 'customer' }),
      version: aVersion({ id: 'v-terms-c', documentId: 'doc-terms-c' }),
    };
    const result = computeCompliance(
      aCustomer(),
      [dpaCustomerActive, termsCustomer],
      [
        stateFor(dpaCustomerActive, { state: 'EXPIRED_BLOCKING' }),
        stateFor(termsCustomer, { state: 'ACCEPTED' }),
      ],
      'customer',
    );
    expect(result.compliant).toBe(false);
    expect(result.details['TERMS_CUSTOMER'].compliant).toBe(true);
  });

  it('customerId is passed through', () => {
    const result = computeCompliance(aCustomer({ id: 'c-999' }), [], [], 'customer');
    expect(result.customerId).toBe('c-999');
  });
});

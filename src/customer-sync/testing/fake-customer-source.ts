import type { CustomerSource, CustomerSourceSnapshot } from '../../plugin-sdk';

/**
 * Test double for a {@link CustomerSource}: returns a snapshot set via {@link setSnapshot}. Lets the
 * reconcile-engine tests drive create / update / soft-delete / reactivate scenarios without any HTTP.
 */
export class FakeCustomerSource implements CustomerSource {
  private snapshot: CustomerSourceSnapshot = { customers: [] };
  /** Set to make the next fetchAll throw (whole-run failure test). */
  public failNext = false;

  setSnapshot(snapshot: CustomerSourceSnapshot): void {
    this.snapshot = snapshot;
  }

  async fetchAll(): Promise<CustomerSourceSnapshot> {
    if (this.failNext) {
      throw new Error('source unreachable');
    }
    return this.snapshot;
  }
}

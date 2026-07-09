import type { CustomerSource, CustomerSourceSnapshot } from '../../../plugin-sdk';

/**
 * Default customer source (the sync is effectively disabled): reports an empty snapshot, so the
 * reconcile engine has nothing to create, update or delete. Selected whenever CUSTOMER_SOURCE is
 * unset or `none` — the concrete adapter (e.g. metergrid) is a separate plugin.
 */
export class NoneCustomerSource implements CustomerSource {
  async fetchAll(): Promise<CustomerSourceSnapshot> {
    return { customers: [] };
  }
}

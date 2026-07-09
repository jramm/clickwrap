import { definePlugin } from '../../plugin-sdk';
import { NoneCustomerSource } from '../customer-source/none/none.source';

/** Default customer source: reports no customers, so the scheduled sync is a full no-op. */
export const noneCustomerSourcePlugin = definePlugin({
  kind: 'customer-source',
  key: 'none',
  create: () => new NoneCustomerSource(),
});

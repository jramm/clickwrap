import { definePlugin } from '../../plugin-sdk/index.js';
import { DefaultAcceptancePageRenderer } from '../acceptance-page/default/default-acceptance-page.renderer.js';

/** Default acceptance page: the current server-rendered HTML page (behaviour unchanged). */
export const defaultAcceptancePagePlugin = definePlugin({
  kind: 'acceptance-page',
  key: 'default',
  create: () => new DefaultAcceptancePageRenderer(),
});

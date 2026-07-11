import { definePlugin } from '../../plugin-sdk/index.js';
import { SlackAdminNotifier } from '../notifications/slack-admin-notifier.js';

/** Slack admin notifications via an incoming webhook (env SLACK_WEBHOOK_URL). */
export const slackAdminNotificationPlugin = definePlugin({
  kind: 'admin-notification',
  key: 'slack',
  create: (ctx) => new SlackAdminNotifier(ctx.requireEnv('SLACK_WEBHOOK_URL'), ctx.logger),
});

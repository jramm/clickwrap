import { Module } from '@nestjs/common';
import { definePlugin } from '../../plugin-sdk/index.js';
import { FallbackPollingJob } from '../email/postmark/fallback-polling.job.js';
import { PostmarkEmailProvider } from '../email/postmark/postmark.provider.js';
import { PostmarkWebhookController } from '../email/postmark/postmark-webhook.controller.js';

/** Carrier class for the plugin module fragment (its controllers/providers are merged by the host). */
@Module({})
class PostmarkTrackingModule {}

/**
 * Postmark e-mail provider — the only built-in with delivery tracking. Its `module()` ships the
 * delivery/bounce webhook controller and the fallback-polling job; the host mounts it ONLY while
 * EMAIL_PROVIDER=postmark.
 */
export const postmarkEmailPlugin = definePlugin({
  kind: 'email-provider',
  key: 'postmark',
  create: (ctx) => new PostmarkEmailProvider(ctx.env('POSTMARK_API_TOKEN', '') as string, ctx.requireEnv('EMAIL_FROM')),
  module: () => ({
    module: PostmarkTrackingModule,
    controllers: [PostmarkWebhookController],
    providers: [FallbackPollingJob],
  }),
});

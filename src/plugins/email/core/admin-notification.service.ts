/**
 * Host side of the `admin-notification` plugin kind. {@link AdminNotificationService} fans a single
 * {@link AdminNotification} out to every ACTIVE notifier (env `ADMIN_NOTIFICATIONS`, ordered,
 * default `email`) and isolates failures per notifier — a broken Slack/HubSpot/e-mail call never
 * affects the others or the caller (the objection still succeeds).
 *
 * The active list is built by {@link createSelectedAdminNotifiers}: the built-in `email` transport
 * is constructed host-side because it reuses the injected {@link EmailDeliveryProvider}; every other
 * key (slack, hubspot, external packages) comes from the plugin registry via `create(ctx)`.
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { AdminNotification, AdminNotifier, EmailDeliveryProvider } from '../../../plugin-sdk/index.js';
import { createPluginContext } from '../../registry/plugin-context.js';
import { getPluginRegistry } from '../../registry/plugin-registry.js';
import { selectedAdminNotificationKeys } from '../../registry/selection.js';
import { EmailAdminNotifier } from './email-admin-notifier.js';

/** DI token for the ordered list of active admin notifiers. */
export const ADMIN_NOTIFIERS = Symbol('AdminNotifiers');

const EMAIL_KEY = 'email';

/**
 * Builds the ORDERED active admin-notifier list from env `ADMIN_NOTIFICATIONS`. `email` is wired
 * host-side with the active EmailDeliveryProvider (skipped with a warning when
 * ADMIN_NOTIFICATION_EMAIL is unset); any other key is resolved from the plugin registry (unknown
 * key → boot error listing the available admin-notification plugins).
 */
export const createSelectedAdminNotifiers = (emailProvider: EmailDeliveryProvider): AdminNotifier[] => {
  const logger = new Logger('AdminNotifications');
  const notifiers: AdminNotifier[] = [];
  for (const key of selectedAdminNotificationKeys()) {
    if (key === EMAIL_KEY) {
      const recipient = (process.env.ADMIN_NOTIFICATION_EMAIL ?? '').trim();
      if (!recipient) {
        logger.warn('admin-notification "email" is active but ADMIN_NOTIFICATION_EMAIL is unset — skipping it');
        continue;
      }
      notifiers.push(new EmailAdminNotifier(emailProvider, recipient, logger));
      logger.log(`admin-notification "email" active (recipient ${recipient})`);
      continue;
    }
    // slack / hubspot / external packages — resolved lazily from the registry (only bootstrapped
    // when a registry-backed notifier is actually active).
    const plugin = getPluginRegistry().select('admin-notification', key, 'ADMIN_NOTIFICATIONS');
    notifiers.push(plugin.create(createPluginContext(plugin)));
    logger.log(`admin-notification "${key}" active`);
  }
  return notifiers;
};

@Injectable()
export class AdminNotificationService {
  private readonly logger = new Logger(AdminNotificationService.name);

  constructor(@Inject(ADMIN_NOTIFIERS) private readonly notifiers: AdminNotifier[]) {}

  /** Fan out to every active notifier; a failing notifier is logged and never propagates. */
  async notify(notification: AdminNotification): Promise<void> {
    await Promise.all(
      this.notifiers.map(async (notifier) => {
        try {
          await notifier.notify(notification);
        } catch (error) {
          this.logger.warn(`admin notifier failed: ${error instanceof Error ? error.message : String(error)}`);
        }
      }),
    );
  }
}

/**
 * Core contract of the pluggable e-mail delivery system.
 *
 * The interfaces live in the plugin SDK (src/plugin-sdk) — the core imports FROM the SDK and
 * re-exports them here so provider-agnostic services keep a stable local import path. The
 * `EmailDeliveryProvider` is the only provider-specific seam; everything else in this module
 * (AgreementEmailService, DeliveryEventService, OutboundEmailRepo) is provider-agnostic and
 * correlates delivery/bounce events back to a send via the `providerRef`.
 *
 * Third-party providers ship as plugin packages — see docs/PLUGINS.md.
 */
export type { DeliveryStatus, EmailDeliveryProvider, OutboundMail, SendResult } from '../../../plugin-sdk/index.js';

/**
 * DI tokens for the e-mail plugin's own ports (not part of src/persistence/tokens.ts).
 *  - EmailDeliveryProvider: bound by EmailModule.forRoot() from env EMAIL_PROVIDER (plugin registry).
 *  - OutboundEmailRepo: bound by the global RepositoryModule (in-memory or Prisma).
 */
export const EMAIL_TOKENS = {
  EmailDeliveryProvider: Symbol('EmailDeliveryProvider'),
  OutboundEmailRepo: Symbol('OutboundEmailRepo'),
  /** Static config for rendered rollout/reminder mails (appName, public base URL, link secret). */
  NotificationConfig: Symbol('NotificationConfig'),
} as const;

/**
 * Static configuration for the rendered rollout/reminder mails, bound by EmailModule.forRoot()
 * from the environment. `publicBaseUrl` is '' when PUBLIC_BASE_URL is unset — the acceptanceLink /
 * documentPdfUrl variables then render empty. `acceptanceLinkSecret` derives the per-customer
 * permanent acceptance link (see src/domain/acceptance-links.ts).
 */
export interface NotificationConfig {
  appName: string;
  publicBaseUrl: string;
  acceptanceLinkSecret: string;
}

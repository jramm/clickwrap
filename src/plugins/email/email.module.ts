/**
 * Pluggable e-mail delivery module.
 *
 * `EmailModule.forRoot()` selects the delivery plugin from env EMAIL_PROVIDER (default noop) via
 * the plugin REGISTRY — built-ins (postmark | smtp | noop) and installed third-party packages go
 * through the same mechanism (see docs/PLUGINS.md). The selected plugin's `create(ctx)` result is
 * bound to EMAIL_TOKENS.EmailDeliveryProvider; an unknown key is a boot error listing the
 * available keys. The provider-agnostic core (AgreementEmailService, DeliveryEventService,
 * AgreementRolloutNotifier) is always available; OutboundEmailRepo + ESCALATION_LOG + domain
 * tokens come from the global RepositoryModule.
 *
 * The module is @Global (like RepositoryModule) and instantiated exactly once via forRoot() in the
 * AppModule — feature modules (agreements, sweeper) consume its exported services without re-importing.
 *
 * A plugin's optional `module()` (webhook controller, polling job — e.g. postmark, the only
 * built-in with delivery tracking) is mounted ONLY while that plugin is active: its controllers,
 * providers and imports are merged into this dynamic module. Providers without delivery tracking
 * send but do not track; in those modes objection deadlines start exclusively via portal-popup
 * access. Webhook-style plugins consume the host's DeliveryEventService through the SDK sink
 * token (PLUGIN_DI_TOKENS.InboundDeliveryEventSink) bound here.
 *
 * Adding a provider no longer touches this file: ship a plugin package (or a built-in under
 * src/plugins/builtins/) — see docs/PLUGINS.md.
 */
import { Module, type DynamicModule, type Provider } from '@nestjs/common';
import { PLUGIN_DI_TOKENS, type EmailDeliveryProvider } from '../../plugin-sdk';
import { createPluginContext } from '../registry/plugin-context';
import { getPluginRegistry } from '../registry/plugin-registry';
import { selectedEmailProviderKey } from '../registry/selection';
import { AcceptanceConfirmationService } from './core/acceptance-confirmation.service';
import { AgreementEmailService } from './core/agreement-email.service';
import { AgreementRolloutNotifier } from './core/agreement-rollout-notifier';
import { DeliveryEventService } from './core/delivery-event.service';
import { EmailContentService } from './core/email-content.service';
import { EMAIL_TOKENS, type NotificationConfig } from './core/email-delivery-provider';
import { PermanentAcceptanceLinkService } from './core/permanent-acceptance-link.service';

/** Reads and validates EMAIL_PROVIDER against the registry (default: noop — dev/tests send nothing). */
export const emailProvider = (): string => {
  const key = selectedEmailProviderKey();
  getPluginRegistry().select('email-provider', key, 'EMAIL_PROVIDER');
  return key;
};

/**
 * Static config for the rendered rollout/reminder mails, read from the environment. Falls back to
 * a clearly-marked dev secret for the permanent-link derivation when ACCEPTANCE_LINK_SECRET is
 * unset — production deployments MUST set a real secret (see docs/INTEGRATION.md).
 */
export const notificationConfig = (): NotificationConfig => ({
  appName: (process.env.APP_NAME ?? '').trim() || 'clickwrap-server',
  publicBaseUrl: (process.env.PUBLIC_BASE_URL ?? '').trim(),
  acceptanceLinkSecret:
    (process.env.ACCEPTANCE_LINK_SECRET ?? '').trim() || 'dev-insecure-acceptance-link-secret',
});

/** Builds the selected EmailDeliveryProvider via the registry plugin's create(ctx). */
export const emailDeliveryProviderFactory = (): EmailDeliveryProvider => {
  const plugin = getPluginRegistry().select('email-provider', selectedEmailProviderKey(), 'EMAIL_PROVIDER');
  return plugin.create(createPluginContext(plugin));
};

@Module({})
export class EmailModule {
  static forRoot(): DynamicModule {
    const plugin = getPluginRegistry().select('email-provider', selectedEmailProviderKey(), 'EMAIL_PROVIDER');
    const fragment = plugin.module?.();
    const providers: Provider[] = [
      { provide: EMAIL_TOKENS.EmailDeliveryProvider, useFactory: emailDeliveryProviderFactory },
      { provide: EMAIL_TOKENS.NotificationConfig, useFactory: notificationConfig },
      // SDK seam for webhook-style plugins: inbound events feed the provider-agnostic handling.
      { provide: PLUGIN_DI_TOKENS.InboundDeliveryEventSink, useExisting: DeliveryEventService },
      PermanentAcceptanceLinkService,
      EmailContentService,
      AgreementEmailService,
      AcceptanceConfirmationService,
      DeliveryEventService,
      AgreementRolloutNotifier,
      ...((fragment?.providers ?? []) as Provider[]),
    ];
    return {
      module: EmailModule,
      global: true,
      imports: fragment?.imports ?? [],
      controllers: fragment?.controllers ?? [],
      providers,
      exports: [
        AgreementEmailService,
        AcceptanceConfirmationService,
        DeliveryEventService,
        AgreementRolloutNotifier,
        EmailContentService,
        PermanentAcceptanceLinkService,
      ],
    };
  }
}

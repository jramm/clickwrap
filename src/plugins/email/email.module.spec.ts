import { NoopEmailProvider } from './noop/noop.provider';
import { PostmarkEmailProvider } from './postmark/postmark.provider';
import { PostmarkWebhookController } from './postmark/postmark-webhook.controller';
import { FallbackPollingJob } from './postmark/fallback-polling.job';
import { SmtpEmailProvider } from './smtp/smtp.provider';
import {
  EmailModule,
  emailDeliveryProviderFactory,
  emailProvider,
} from './email.module';

/** Restores the relevant env after each test so cases do not leak into each other. */
const withEnv = (env: Record<string, string | undefined>, run: () => void): void => {
  const keys = ['EMAIL_PROVIDER', 'EMAIL_FROM', 'POSTMARK_API_TOKEN', 'SMTP_HOST'];
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  try {
    for (const [k, v] of Object.entries(env)) {
      if (v === undefined) {
        delete process.env[k];
      } else {
        process.env[k] = v;
      }
    }
    run();
  } finally {
    for (const k of keys) {
      if (saved[k] === undefined) {
        delete process.env[k];
      } else {
        process.env[k] = saved[k];
      }
    }
  }
};

describe('emailProvider', () => {
  it('defaults to noop when EMAIL_PROVIDER is unset', () => {
    withEnv({ EMAIL_PROVIDER: undefined }, () => {
      expect(emailProvider()).toBe('noop');
    });
  });

  it('is case-insensitive', () => {
    withEnv({ EMAIL_PROVIDER: 'Postmark' }, () => {
      expect(emailProvider()).toBe('postmark');
    });
  });

  it('throws on an unknown provider', () => {
    withEnv({ EMAIL_PROVIDER: 'sendgrid' }, () => {
      expect(() => emailProvider()).toThrow(/Unknown EMAIL_PROVIDER/);
    });
  });
});

describe('emailDeliveryProviderFactory', () => {
  it('builds a NoopEmailProvider by default', () => {
    withEnv({ EMAIL_PROVIDER: 'noop' }, () => {
      expect(emailDeliveryProviderFactory()).toBeInstanceOf(NoopEmailProvider);
    });
  });

  it('builds a PostmarkEmailProvider when EMAIL_FROM is set', () => {
    withEnv({ EMAIL_PROVIDER: 'postmark', EMAIL_FROM: 'legal@example.org', POSTMARK_API_TOKEN: '' }, () => {
      expect(emailDeliveryProviderFactory()).toBeInstanceOf(PostmarkEmailProvider);
    });
  });

  it('builds an SmtpEmailProvider when EMAIL_FROM is set', () => {
    withEnv({ EMAIL_PROVIDER: 'smtp', EMAIL_FROM: 'legal@example.org', SMTP_HOST: 'localhost' }, () => {
      expect(emailDeliveryProviderFactory()).toBeInstanceOf(SmtpEmailProvider);
    });
  });

  it('requires EMAIL_FROM for the postmark provider', () => {
    withEnv({ EMAIL_PROVIDER: 'postmark', EMAIL_FROM: undefined }, () => {
      expect(() => emailDeliveryProviderFactory()).toThrow(/EMAIL_FROM is required/);
    });
  });

  it('requires EMAIL_FROM for the smtp provider', () => {
    withEnv({ EMAIL_PROVIDER: 'smtp', EMAIL_FROM: undefined }, () => {
      expect(() => emailDeliveryProviderFactory()).toThrow(/EMAIL_FROM is required/);
    });
  });

  it('does not require EMAIL_FROM for the noop provider', () => {
    withEnv({ EMAIL_PROVIDER: 'noop', EMAIL_FROM: undefined }, () => {
      expect(() => emailDeliveryProviderFactory()).not.toThrow();
    });
  });
});

describe('EmailModule.forRoot webhook/polling gating', () => {
  it('registers the Postmark webhook controller and fallback-polling job only for postmark', () => {
    withEnv({ EMAIL_PROVIDER: 'postmark', EMAIL_FROM: 'legal@example.org' }, () => {
      const module = EmailModule.forRoot();
      expect(module.controllers).toContain(PostmarkWebhookController);
      expect(module.providers).toContain(FallbackPollingJob);
      expect(module.global).toBe(true);
    });
  });

  it('registers no webhook controller / polling job for noop', () => {
    withEnv({ EMAIL_PROVIDER: 'noop', EMAIL_FROM: undefined }, () => {
      const module = EmailModule.forRoot();
      expect(module.controllers).toEqual([]);
      expect(module.providers).not.toContain(FallbackPollingJob);
    });
  });

  it('registers no webhook controller / polling job for smtp', () => {
    withEnv({ EMAIL_PROVIDER: 'smtp', EMAIL_FROM: 'legal@example.org' }, () => {
      const module = EmailModule.forRoot();
      expect(module.controllers).toEqual([]);
      expect(module.providers).not.toContain(FallbackPollingJob);
    });
  });
});

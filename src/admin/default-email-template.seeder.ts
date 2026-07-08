/**
 * Ensures the two built-in default e-mail templates exist as real, editable rows (fixed ids
 * tpl-default-*). Runs once on application bootstrap for whatever persistence driver is active
 * (in-memory or Prisma). Idempotent: an existing row (possibly edited by an admin) is never
 * overwritten — only missing defaults are created.
 */
import { Inject, Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import type { Clock } from '../domain/clock';
import { defaultEmailTemplates } from '../domain/email-template';
import type { EmailTemplateRepo } from '../domain/ports';
import { TOKENS } from '../persistence/tokens';

@Injectable()
export class DefaultEmailTemplateSeeder implements OnApplicationBootstrap {
  private readonly logger = new Logger(DefaultEmailTemplateSeeder.name);

  constructor(
    @Inject(TOKENS.EmailTemplateRepo) private readonly templates: EmailTemplateRepo,
    @Inject(TOKENS.Clock) private readonly clock: Clock,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.ensureDefaults();
  }

  /** Creates any missing default template rows; leaves existing (edited) rows untouched. */
  async ensureDefaults(): Promise<void> {
    for (const template of defaultEmailTemplates(this.clock)) {
      const existing = await this.templates.findById(template.id);
      if (!existing) {
        await this.templates.save(template);
        this.logger.log(`Seeded default e-mail template "${template.name}" (${template.id})`);
      }
    }
  }
}

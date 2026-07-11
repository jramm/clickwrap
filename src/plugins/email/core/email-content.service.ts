/**
 * Resolves the applicable {@link EmailTemplate} for a rollout/reminder mail, builds the template
 * variables and renders subject/html/text.
 *
 * Template resolution order: the document's DocumentTypeDef assignment
 * (notificationTemplateId / reminderTemplateId) → the built-in default row → the in-code default
 * (safety net if the default row was never seeded).
 *
 * The `acceptanceLink` variable is the customer's lazily-created PERMANENT acceptance link;
 * `documentPdfUrl` is the stable public latest-PDF URL. Both are '' when PUBLIC_BASE_URL is unset.
 */
import { Inject, Injectable } from '@nestjs/common';
import type { Clock } from '../../../domain/clock.js';
import { customerDisplayName } from '../../../domain/customer.js';
import {
  defaultEmailTemplates,
  defaultTemplateIdForKind,
  emptyTemplateVars,
  renderTemplate,
  type RenderedTemplate,
  type TemplateVars,
} from '../../../domain/email-template.js';
import type {
  AgreementDocumentRepo,
  AudienceRepo,
  DocumentTypeRepo,
  EmailTemplateRepo,
} from '../../../domain/ports.js';
import type {
  AgreementVersion,
  Customer,
  EmailTemplate,
  EmailTemplateKind,
} from '../../../domain/types.js';
import { TOKENS } from '../../../persistence/tokens.js';
import { EMAIL_TOKENS, type NotificationConfig } from './email-delivery-provider.js';
import { PermanentAcceptanceLinkService } from './permanent-acceptance-link.service.js';

const isoDate = (date: Date): string => date.toISOString().slice(0, 10);

@Injectable()
export class EmailContentService {
  constructor(
    @Inject(TOKENS.AgreementDocumentRepo) private readonly documents: AgreementDocumentRepo,
    @Inject(TOKENS.DocumentTypeRepo) private readonly documentTypes: DocumentTypeRepo,
    @Inject(TOKENS.AudienceRepo) private readonly audiences: AudienceRepo,
    @Inject(TOKENS.EmailTemplateRepo) private readonly templates: EmailTemplateRepo,
    @Inject(TOKENS.Clock) private readonly clock: Clock,
    @Inject(EMAIL_TOKENS.NotificationConfig) private readonly config: NotificationConfig,
    private readonly permanentLinks: PermanentAcceptanceLinkService,
  ) {}

  /** Renders the mail content for a version using the resolved template. */
  async renderFor(
    kind: EmailTemplateKind,
    customer: Customer,
    version: AgreementVersion,
    deadlineAt?: Date,
    acceptedAt?: Date,
  ): Promise<RenderedTemplate> {
    // Structural guard (belt-and-suspenders): a REMINDER's copy always references the deadline
    // ("The deadline is {{deadlineAt}}."), so rendering one without a deadline would emit a
    // dangling "The deadline is ." — the confirmed bug. Every caller must already guarantee a
    // deadline (sendReminder requires it; the notifier and the admin remind path fall back to the
    // VERSION_NOTIFICATION template when none is running), so this can only fire as an assertion.
    if (kind === 'REMINDER' && deadlineAt === undefined) {
      throw new Error(
        'Refusing to render a REMINDER e-mail without a deadline: send a VERSION_NOTIFICATION instead.',
      );
    }
    const template = await this.resolveTemplate(kind, version);
    const vars = await this.buildVars(customer, version, deadlineAt, acceptedAt);
    return renderTemplate(template, vars);
  }

  private async resolveTemplate(
    kind: EmailTemplateKind,
    version: AgreementVersion,
  ): Promise<EmailTemplate> {
    const assignedId = await this.assignedTemplateId(kind, version);
    if (assignedId !== undefined) {
      const assigned = await this.templates.findById(assignedId);
      if (assigned) {
        return assigned;
      }
    }
    const fallbackId = defaultTemplateIdForKind(kind);
    const defaultRow = await this.templates.findById(fallbackId);
    if (defaultRow) {
      return defaultRow;
    }
    // Safety net: default row not seeded (e.g. a bespoke wiring) — use the in-code default.
    const inCode = defaultEmailTemplates(this.clock).find((t) => t.id === fallbackId);
    if (!inCode) {
      throw new Error(`No default e-mail template for kind ${kind}`);
    }
    return inCode;
  }

  private async assignedTemplateId(
    kind: EmailTemplateKind,
    version: AgreementVersion,
  ): Promise<string | undefined> {
    const document = await this.documents.findById(version.documentId);
    if (!document) {
      return undefined;
    }
    const documentType = await this.documentTypes.findByKey(document.type);
    if (!documentType) {
      return undefined;
    }
    return kind === 'VERSION_NOTIFICATION'
      ? documentType.notificationTemplateId
      : documentType.reminderTemplateId;
  }

  private async buildVars(
    customer: Customer,
    version: AgreementVersion,
    deadlineAt?: Date,
    acceptedAt?: Date,
  ): Promise<TemplateVars> {
    const document = await this.documents.findById(version.documentId);
    const documentType = document ? await this.documentTypes.findByKey(document.type) : undefined;
    const audience = document ? await this.audiences.findByKey(document.audience) : undefined;

    const acceptanceLink = await this.resolveAcceptanceLink(customer.id);
    const documentPdfUrl = this.resolveDocumentPdfUrl(document?.type, document?.audience);

    return {
      ...emptyTemplateVars(),
      customerName: customerDisplayName(customer),
      firstName: customer.firstName ?? '',
      lastName: customer.lastName ?? '',
      companyName: customer.companyName ?? '',
      documentName: document?.name ?? '',
      documentType: documentType?.name ?? document?.type ?? '',
      audience: audience?.name ?? document?.audience ?? '',
      versionLabel: version.versionLabel,
      changeSummary: version.changeSummary,
      validFrom: isoDate(version.validFrom),
      deadlineAt: deadlineAt ? isoDate(deadlineAt) : '',
      acceptedAt: acceptedAt ? acceptedAt.toISOString() : '',
      acceptanceLink,
      documentPdfUrl,
      appName: this.config.appName,
    };
  }

  /** Lazily ensures the customer's permanent link exists, then returns its URL (or '' if no base). */
  private async resolveAcceptanceLink(customerId: string): Promise<string> {
    const url = this.permanentLinks.urlFor(customerId);
    if (url === '') {
      return '';
    }
    await this.permanentLinks.ensureForCustomer(customerId);
    return url;
  }

  private resolveDocumentPdfUrl(typeKey?: string, audienceKey?: string): string {
    const base = this.config.publicBaseUrl.replace(/\/+$/, '');
    if (base === '' || typeKey === undefined || audienceKey === undefined) {
      return '';
    }
    return `${base}/documents/${typeKey}/${audienceKey}/latest.pdf`;
  }
}

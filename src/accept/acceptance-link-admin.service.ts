/**
 * Admin-side minting of hosted acceptance links (POST /admin/customers/:id/acceptance-links).
 * The URL token is a capability: it is generated here, returned ONCE inside the URL and only its
 * SHA-256 is persisted. Every mint writes an ACCEPTANCE_LINK_CREATE audit entry.
 */
import { Inject, Injectable, Optional } from '@nestjs/common';
import { ADMIN_AUDIT_TOKEN, type AdminAuditRepo } from '../agreements/audit';
import { newId } from '../agreements/ids';
import { EventRecorder } from '../events/event-recorder';
import { DomainError } from '../common/errors';
import {
  acceptanceLinkTokenHash,
  DEFAULT_LINK_EXPIRY_DAYS,
  MAX_LINK_EXPIRY_DAYS,
  newAcceptanceLinkToken,
} from '../domain/acceptance-links';
import type { Clock } from '../domain/clock';
import type { AcceptanceLinkRepo, AudienceRepo, CustomerRepo } from '../domain/ports';
import { TOKENS } from '../persistence/tokens';

export interface CreateAcceptanceLinkInput {
  /** Optional scope: restrict the hosted page to documents of this audience. */
  audienceKey?: string;
  /** Default 30, max 365. */
  expiresInDays?: number;
}

export interface CreateAcceptanceLinkResult {
  linkId: string;
  /** `${PUBLIC_BASE_URL}/accept/<token>` — the only place the raw token ever appears. */
  url: string;
  expiresAt: Date;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

@Injectable()
export class AcceptanceLinkAdminService {
  constructor(
    @Inject(TOKENS.CustomerRepo) private readonly customers: CustomerRepo,
    @Inject(TOKENS.AudienceRepo) private readonly audiences: AudienceRepo,
    @Inject(TOKENS.AcceptanceLinkRepo) private readonly links: AcceptanceLinkRepo,
    @Inject(ADMIN_AUDIT_TOKEN) private readonly audit: AdminAuditRepo,
    @Inject(TOKENS.Clock) private readonly clock: Clock,
    @Optional() private readonly recorder?: EventRecorder,
  ) {}

  async create(
    customerId: string,
    input: CreateAcceptanceLinkInput,
    adminUserId: string,
  ): Promise<CreateAcceptanceLinkResult> {
    const baseUrl = this.requirePublicBaseUrl();
    const customer = await this.customers.findById(customerId);
    if (!customer) {
      throw new DomainError('CUSTOMER_NOT_FOUND', `Customer ${customerId} not found`);
    }
    if (input.audienceKey !== undefined && !(await this.audiences.findByKey(input.audienceKey))) {
      throw new DomainError('UNKNOWN_AUDIENCE', `Unknown audience: ${input.audienceKey}`);
    }
    const expiresInDays = this.resolveExpiryDays(input.expiresInDays);

    const createdAt = this.clock.now();
    const expiresAt = new Date(createdAt.getTime() + expiresInDays * MS_PER_DAY);
    const token = newAcceptanceLinkToken();
    const link = await this.links.create({
      id: newId('al'),
      tokenHash: acceptanceLinkTokenHash(token),
      customerId,
      kind: 'STANDARD',
      audienceKey: input.audienceKey,
      createdBy: adminUserId,
      createdAt,
      expiresAt,
    });

    await this.audit.append({
      id: newId('audit'),
      action: 'ACCEPTANCE_LINK_CREATE',
      actor: adminUserId,
      targetType: 'AcceptanceLink',
      targetId: link.id,
      // The token/tokenHash never appear in the audit log — the linkId is enough to correlate.
      metadata: { customerId, audienceKey: input.audienceKey, expiresAt: expiresAt.toISOString() },
      createdAt,
    });

    await this.recorder?.record({
      type: 'ACCEPTANCE_LINK_CREATED',
      category: 'ADMINISTRATION',
      actorKind: 'ADMIN',
      actorLabel: adminUserId,
      customerId,
      audience: input.audienceKey,
      channel: 'LINK',
      summary: 'Acceptance link created',
      metadata: { linkId: link.id, audienceKey: input.audienceKey, expiresAt: expiresAt.toISOString() },
    });

    return { linkId: link.id, url: `${baseUrl}/accept/${token}`, expiresAt };
  }

  /** The hosted page needs an absolute URL the recipient can open — refuse to mint without it. */
  private requirePublicBaseUrl(): string {
    const raw = (process.env.PUBLIC_BASE_URL ?? '').trim();
    if (raw === '') {
      throw new DomainError(
        'INVALID_STATE',
        'PUBLIC_BASE_URL is not configured — acceptance links need an absolute public URL. ' +
          'Set PUBLIC_BASE_URL (e.g. https://clickwrap.example.org) and retry.',
      );
    }
    return raw.replace(/\/+$/, '');
  }

  private resolveExpiryDays(requested: number | undefined): number {
    if (requested === undefined) {
      return DEFAULT_LINK_EXPIRY_DAYS;
    }
    if (!Number.isInteger(requested) || requested < 1 || requested > MAX_LINK_EXPIRY_DAYS) {
      throw new DomainError(
        'INVALID_STATE',
        `expiresInDays must be an integer between 1 and ${MAX_LINK_EXPIRY_DAYS}`,
      );
    }
    return requested;
  }
}

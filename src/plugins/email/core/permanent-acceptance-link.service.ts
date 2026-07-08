/**
 * Lazily manages the ONE permanent acceptance link per customer that rollout/reminder mails link
 * to. The URL token is derived deterministically (HMAC of a server secret + customer id) so the
 * same URL can be re-injected into every mail without ever persisting the raw token — only its
 * SHA-256 is stored, exactly like standard links. The link never expires (kind=PERMANENT) but is
 * revocable; a revoked link stays dead (deterministic token → same, revoked row).
 */
import { Inject, Injectable } from '@nestjs/common';
import { newId } from '../../../agreements/ids';
import { DomainError } from '../../../common/errors';
import {
  acceptanceLinkTokenHash,
  permanentAcceptanceLinkToken,
} from '../../../domain/acceptance-links';
import type { Clock } from '../../../domain/clock';
import type { AcceptanceLinkRepo } from '../../../domain/ports';
import type { AcceptanceLink } from '../../../domain/types';
import { TOKENS } from '../../../persistence/tokens';
import { EMAIL_TOKENS, type NotificationConfig } from './email-delivery-provider';

@Injectable()
export class PermanentAcceptanceLinkService {
  constructor(
    @Inject(TOKENS.AcceptanceLinkRepo) private readonly links: AcceptanceLinkRepo,
    @Inject(TOKENS.Clock) private readonly clock: Clock,
    @Inject(EMAIL_TOKENS.NotificationConfig) private readonly config: NotificationConfig,
  ) {}

  /** The deterministic URL token for the customer's permanent link (never persisted raw). */
  private tokenFor(customerId: string): string {
    return permanentAcceptanceLinkToken(this.config.acceptanceLinkSecret, customerId);
  }

  /**
   * Get-or-create the customer's permanent link row (so it can be revoked). Idempotent and
   * concurrency-safe: a duplicate tokenHash from a race is caught and the existing row returned.
   */
  async ensureForCustomer(customerId: string): Promise<AcceptanceLink> {
    const tokenHash = acceptanceLinkTokenHash(this.tokenFor(customerId));
    const existing = await this.links.findByTokenHash(tokenHash);
    if (existing) {
      return existing;
    }
    try {
      return await this.links.create({
        id: newId('al'),
        tokenHash,
        customerId,
        kind: 'PERMANENT',
        createdBy: 'system',
        createdAt: this.clock.now(),
        expiresAt: undefined,
      });
    } catch (err) {
      if (err instanceof DomainError && err.code === 'INVALID_STATE') {
        const raced = await this.links.findByTokenHash(tokenHash);
        if (raced) {
          return raced;
        }
      }
      throw err;
    }
  }

  /**
   * Absolute acceptance URL for a customer, or '' when PUBLIC_BASE_URL is unconfigured. Does NOT
   * persist a row — callers that need the link to be valid/revocable must call
   * {@link ensureForCustomer} first.
   */
  urlFor(customerId: string): string {
    const baseUrl = this.config.publicBaseUrl.replace(/\/+$/, '');
    if (baseUrl === '') {
      return '';
    }
    return `${baseUrl}/accept/${this.tokenFor(customerId)}`;
  }
}

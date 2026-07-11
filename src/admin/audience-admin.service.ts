import { Inject, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { ADMIN_AUDIT_TOKEN, type AdminAuditRepo } from '../agreements/audit.js';
import { newId } from '../agreements/ids.js';
import { EventRecorder } from '../events/event-recorder.js';
import type { Clock } from '../domain/clock.js';
import { DomainError } from '../common/errors.js';
import type { AudienceRepo } from '../domain/ports.js';
import type { Audience } from '../domain/types.js';
import { TOKENS } from '../persistence/tokens.js';

export interface CreateAudienceInput {
  key: string;
  name: string;
}

/** `key` is deliberately NOT part of this type — it is immutable, see `update()`. */
export interface UpdateAudienceInput {
  name?: string;
}

/**
 * Admin CRUD for the dynamic Audience entity. Thin orchestration over
 * `AudienceRepo` (slug validation + uniqueness + reference checks live there); this service
 * adds id-based lookup, the key-immutability rule and the mandatory audit trail.
 */
@Injectable()
export class AudienceAdminService {
  constructor(
    @Inject(TOKENS.AudienceRepo) private readonly audiences: AudienceRepo,
    @Inject(ADMIN_AUDIT_TOKEN) private readonly audit: AdminAuditRepo,
    @Inject(TOKENS.Clock) private readonly clock: Clock,
    @Optional() private readonly recorder?: EventRecorder,
  ) {}

  async list(): Promise<Audience[]> {
    const all = await this.audiences.findAll();
    return all.sort((a, b) => a.key.localeCompare(b.key));
  }

  async create(input: CreateAudienceInput, actor: string): Promise<Audience> {
    if (!input.name || input.name.trim() === '') {
      throw new DomainError('INVALID_STATE', 'name is required');
    }
    const saved = await this.audiences.save({ id: newId('aud'), key: input.key, name: input.name });
    await this.audit.append({
      id: newId('audit'),
      action: 'AUDIENCE_CREATE',
      actor,
      targetType: 'Audience',
      targetId: saved.id,
      metadata: { key: saved.key, name: saved.name },
      createdAt: this.clock.now(),
    });
    await this.recorder?.record({
      type: 'AUDIENCE_CREATED',
      category: 'ADMINISTRATION',
      actorKind: 'ADMIN',
      actorLabel: actor,
      audience: saved.key,
      summary: `Audience "${saved.name}" created`,
      metadata: { key: saved.key, name: saved.name },
    });
    return saved;
  }

  /**
   * `body` is untyped on purpose (the controller passes the raw JSON body): the presence of a
   * `key` property — even set to the current value — is rejected, since only the DTO shape
   * (UpdateAudienceInput) guarantees `key` cannot be sent at the type level.
   */
  async update(id: string, body: Record<string, unknown>, actor: string): Promise<Audience> {
    if (Object.prototype.hasOwnProperty.call(body, 'key')) {
      throw new DomainError('INVALID_STATE', 'key is immutable');
    }
    const existing = await this.findByIdOrThrow(id);
    const name = typeof body.name === 'string' && body.name.trim() !== '' ? body.name : existing.name;
    const updated = await this.audiences.save({ ...existing, name });
    await this.audit.append({
      id: newId('audit'),
      action: 'AUDIENCE_UPDATE',
      actor,
      targetType: 'Audience',
      targetId: id,
      metadata: { name: updated.name },
      createdAt: this.clock.now(),
    });
    await this.recorder?.record({
      type: 'AUDIENCE_UPDATED',
      category: 'ADMINISTRATION',
      actorKind: 'ADMIN',
      actorLabel: actor,
      audience: updated.key,
      summary: `Audience "${updated.name}" updated`,
      metadata: { name: updated.name },
    });
    return updated;
  }

  async remove(id: string, actor: string): Promise<void> {
    const existing = await this.findByIdOrThrow(id);
    const deleted = await this.audiences.deleteIfUnused(existing.key);
    if (!deleted) {
      throw new DomainError('INVALID_STATE', 'audience is still in use');
    }
    await this.audit.append({
      id: newId('audit'),
      action: 'AUDIENCE_DELETE',
      actor,
      targetType: 'Audience',
      targetId: id,
      metadata: { key: existing.key },
      createdAt: this.clock.now(),
    });
    await this.recorder?.record({
      type: 'AUDIENCE_DELETED',
      category: 'ADMINISTRATION',
      actorKind: 'ADMIN',
      actorLabel: actor,
      audience: existing.key,
      summary: `Audience "${existing.name}" deleted`,
      metadata: { key: existing.key },
    });
  }

  private async findByIdOrThrow(id: string): Promise<Audience> {
    const found = (await this.audiences.findAll()).find((a) => a.id === id);
    if (!found) {
      throw new NotFoundException(`Audience ${id} not found`);
    }
    return found;
  }
}

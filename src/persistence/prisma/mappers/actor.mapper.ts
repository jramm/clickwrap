/**
 * Actor (src/common/auth/actor.ts) ↔ the four `actor*` columns on Acceptance/Objection.
 * Shared mapper because both models use exactly the same pattern.
 */
import type { Actor } from '../../../common/auth/actor.js';
import { nullToUndefined } from './null.js';

export interface ActorColumns {
  actorUserId: string;
  actorName: string | null;
  actorEmail: string | null;
  actorPortalRole: string | null;
}

export const embedActor = (actor: Actor): ActorColumns => ({
  actorUserId: actor.userId,
  actorName: actor.name ?? null,
  actorEmail: actor.email ?? null,
  actorPortalRole: actor.portalRole ?? null,
});

export const extractActor = (columns: ActorColumns): Actor => ({
  userId: columns.actorUserId,
  name: nullToUndefined(columns.actorName),
  email: nullToUndefined(columns.actorEmail),
  portalRole: nullToUndefined(columns.actorPortalRole),
});

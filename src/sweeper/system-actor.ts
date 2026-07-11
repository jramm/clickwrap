import type { Actor } from '../common/auth/actor.js';

/** Actor for acceptances recorded automatically, without human involvement (method=TACIT, channel=SYSTEM). */
export const SWEEPER_SYSTEM_ACTOR: Actor = {
  userId: 'system:deadline-sweeper',
  name: 'Deadline-Sweeper',
};

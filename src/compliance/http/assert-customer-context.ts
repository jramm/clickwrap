/**
 * The path `customerId` must match the ServiceGuard auth context — otherwise FORBIDDEN
 * (the actor/customer comes exclusively from the auth context, never from the body or path).
 */
import type { Request } from 'express';
import { DomainError } from '../../common/errors.js';
import type { CustomerContext } from '../../common/auth/actor.js';

export const assertCustomerMatchesContext = (req: Request, customerId: string): CustomerContext => {
  const context = (req as Request & { customerContext?: CustomerContext }).customerContext;
  if (!context || context.customerId !== customerId) {
    throw new DomainError('FORBIDDEN', 'Path customerId does not match the auth context');
  }
  return context;
};

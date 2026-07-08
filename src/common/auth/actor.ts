/** Authenticated actor — ALWAYS taken from the auth context, never from the request body. */
export interface Actor {
  userId: string;
  name?: string;
  email?: string;
  /** Role of the user at the customer — logged alongside the evidence record. */
  portalRole?: string;
}

export interface CustomerContext {
  customerId: string;
  actor: Actor;
  ipAddress?: string;
  userAgent?: string;
}

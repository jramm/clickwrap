/**
 * Shared customer resolution for the integration API. Every customer-scoped integration endpoint
 * addresses the customer by query parameter — EITHER `customerId` OR `externalRef` (+ `audience`),
 * exactly one of the two. This replaces the older split between path `/{customerId}` routes
 * (ServiceGuard + forwarded x-customer-id) and `/by-external-ref/{externalRef}` routes: all
 * customer-scoped routes now use ServiceTokenGuard and resolve here.
 *
 * `externalRef` is only unique in combination with an audience, so `audience` is REQUIRED whenever
 * `externalRef` is used (it is the resolution discriminator). With `customerId`, `audience` is
 * ignored for resolution (the id is already unique) — callers may still pass it as an operation
 * scope where the endpoint supports one (compliance / pending-agreements).
 */
import { BadRequestException } from '@nestjs/common';
import { DomainError } from '../errors.js';
import { resolveAudienceKey } from '../../compliance/audience.js';
import type { AudienceRepo, CustomerRepo } from '../../domain/ports.js';
import type { Customer } from '../../domain/types.js';

export interface CustomerSelector {
  customerId?: string;
  externalRef?: string;
  audience?: string;
}

/**
 * Resolves the active customer addressed by (`customerId` XOR `externalRef` + `audience`).
 *  - neither or both → 400 (BadRequest).
 *  - `customerId`: looked up by id; unknown or soft-deleted → CUSTOMER_NOT_FOUND (404).
 *  - `externalRef`: `audience` required (400 when missing); unknown audience → UNKNOWN_AUDIENCE
 *    (422, validated first so it is never masked as a 404); then the active record carrying
 *    `externalRef` whose roles include `audience` — else CUSTOMER_NOT_FOUND (404).
 */
export async function resolveIntegrationCustomer(
  customers: CustomerRepo,
  audiences: AudienceRepo,
  selector: CustomerSelector,
): Promise<Customer> {
  const customerId = selector.customerId?.trim();
  const externalRef = selector.externalRef?.trim();

  if (Boolean(customerId) === Boolean(externalRef)) {
    throw new BadRequestException('Provide exactly one of the "customerId" or "externalRef" query parameters');
  }

  if (customerId) {
    const customer = await customers.findById(customerId);
    if (!customer || customer.deletedAt !== undefined) {
      throw new DomainError('CUSTOMER_NOT_FOUND', `No active customer with id "${customerId}"`);
    }
    return customer;
  }

  const audience = selector.audience?.trim();
  if (!audience) {
    throw new BadRequestException('The "audience" query parameter is required when addressing by externalRef');
  }
  // Validate the audience FIRST (422 UNKNOWN_AUDIENCE) so an unknown key is never masked as a 404.
  await resolveAudienceKey(audiences, audience);

  const matches = await customers.findAllByExternalRef(externalRef as string);
  const customer = matches.find((c) => c.deletedAt === undefined && c.roles.includes(audience));
  if (!customer) {
    throw new DomainError(
      'CUSTOMER_NOT_FOUND',
      `No active customer for externalRef "${externalRef as string}" and audience "${audience}"`,
    );
  }
  return customer;
}

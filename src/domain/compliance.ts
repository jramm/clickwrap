/**
 * Compliance computation for the tool gate — pure function.
 * A customer is blocked on EXPIRED_BLOCKING and on block carry-over (carryOverBlocking=true,
 * as long as the successor version has not been accepted); all other pending states are
 * compliant.
 */
import { detailKey } from './keys';
import { isBlocking } from './state-machine';
import type {
  AcceptanceMode,
  AgreementDocument,
  AgreementVersion,
  Customer,
  CustomerVersionState,
  CustomerVersionStateValue,
} from './types';

/** Applicable revision per (type key, audience key) including its document bracket. */
export interface CurrentVersionEntry {
  document: AgreementDocument;
  version: AgreementVersion;
}

export interface ComplianceDetail {
  requiredVersionId: string;
  requiredVersionLabel: string;
  /** Missing when the rollout has not created a state for the customer yet. */
  state?: CustomerVersionStateValue;
  compliant: boolean;
  /** Only while pending: mode of the outstanding version. */
  pendingMode?: AcceptanceMode;
  deadlineAt?: Date;
}

/** Detail keys are uniformly `TYPE_AUDIENCE` (see detailKey) — collision-free even for multi-role aggregation. */
export interface ComplianceResult {
  customerId: string;
  /** Audience key the query was restricted to (if any). */
  audience?: string;
  /** Audience keys of the customer. */
  roles: string[];
  compliant: boolean;
  details: Record<string, ComplianceDetail>;
}

const OPEN_STATES: readonly CustomerVersionStateValue[] = ['NOTIFIED', 'EXPIRED_BLOCKING'];

/**
 * Answers "may the customer enter the respective tool?".
 * With audience: only documents of that audience, intersected with the customer's roles.
 * Without audience: aggregation (AND) across all roles of the customer.
 * Customer without any role: compliant=true, roles: [] — never blocked by missing master data.
 * Soft-deleted customer (deletedAt set): compliant=true, no details — a removed (sync-deleted)
 * customer is never blocking/pending.
 */
export const computeCompliance = (
  customer: Customer,
  currentVersions: readonly CurrentVersionEntry[],
  states: readonly CustomerVersionState[],
  audience?: string,
): ComplianceResult => {
  if (customer.deletedAt !== undefined) {
    return { customerId: customer.id, audience, roles: [...customer.roles], compliant: true, details: {} };
  }
  const relevantAudiences = audience
    ? customer.roles.filter((role) => role === audience)
    : customer.roles;

  const details: Record<string, ComplianceDetail> = {};
  let compliant = true;

  for (const { document, version } of currentVersions) {
    if (!relevantAudiences.includes(document.audience)) {
      continue;
    }
    const state = states.find((s) => s.customerId === customer.id && s.versionId === version.id);
    const detailCompliant = state === undefined || !isBlocking(state);
    compliant = compliant && detailCompliant;

    const isOpen = state !== undefined && OPEN_STATES.includes(state.state);
    details[detailKey(document.type, document.audience)] = {
      requiredVersionId: version.id,
      requiredVersionLabel: version.versionLabel,
      state: state?.state,
      compliant: detailCompliant,
      pendingMode: isOpen ? version.acceptanceMode : undefined,
      deadlineAt: isOpen ? state.deadlineAt : undefined,
    };
  }

  return { customerId: customer.id, audience, roles: [...customer.roles], compliant, details };
};

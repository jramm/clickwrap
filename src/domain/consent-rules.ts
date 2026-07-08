/**
 * Rules around consent, evidence chain and publish validation.
 * Pure functions; node:crypto is allowed (no Nest/Prisma).
 */
import { createHash } from 'node:crypto';
import { DomainError } from '../common/errors';
import type {
  AcceptanceChannel,
  AcceptanceMethod,
  AgreementVersion,
  Customer,
} from './types';

/**
 * Allowed method×channel combinations:
 * ACTIVE_CONSENT×PORTAL (popup) · ACTIVE_CONSENT×LINK (hosted acceptance page, self-declared
 * signer) · ACTIVE_CONSENT/IMPORT×ADMIN (manual recording) · TACIT×SYSTEM (sweeper).
 */
const ALLOWED_CHANNELS: Record<AcceptanceMethod, readonly AcceptanceChannel[]> = {
  ACTIVE_CONSENT: ['PORTAL', 'ADMIN', 'LINK'],
  IMPORT: ['ADMIN'],
  TACIT: ['SYSTEM'],
};

export const assertMethodChannelAllowed = (method: AcceptanceMethod, channel: AcceptanceChannel): void => {
  if (!ALLOWED_CHANNELS[method].includes(channel)) {
    throw new DomainError('INVALID_STATE', `Combination ${method}×${channel} is not allowed`);
  }
};

export const sha256Hex = (input: string): string => createHash('sha256').update(input, 'utf8').digest('hex');

/**
 * consentTextHash for the evidence chain — ALWAYS computed over the server-side versioned
 * AgreementVersion.consentText, never over client-provided text.
 */
export const consentTextHashFor = (version: AgreementVersion): string => {
  if (version.consentText === undefined) {
    throw new DomainError('CONSENT_TEXT_REQUIRED', `Version ${version.id} has no consentText`);
  }
  return `sha256:${sha256Hex(version.consentText)}`;
};

/**
 * Cross-check: the text displayed by the portal must exactly match the server-side consentText
 * (the evidence is bound to the plain text) — otherwise CONSENT_TEXT_MISMATCH.
 */
export const assertDisplayedConsentTextMatches = (
  version: AgreementVersion,
  displayedConsentText: string,
): void => {
  if (version.consentText === undefined) {
    throw new DomainError('CONSENT_TEXT_REQUIRED', `Version ${version.id} has no consentText`);
  }
  if (displayedConsentText !== version.consentText) {
    throw new DomainError('CONSENT_TEXT_MISMATCH');
  }
};

/**
 * Consent to the current revision OR to ANY upcoming one (PUBLISHED with validFrom in the
 * future) — acceptance may be collected in advance of the flip, for the nearest future version
 * or a far-future one alike (several futures may be scheduled at once). Anything else (retired
 * versions, drafts, stale popup content) → VERSION_NOT_CURRENT (portal reloads pending items).
 */
export const assertVersionCurrent = (
  version: AgreementVersion,
  currentVersion: AgreementVersion | undefined,
  now: Date,
): void => {
  if (currentVersion !== undefined && version.id === currentVersion.id) {
    return;
  }
  if (version.status === 'PUBLISHED' && version.validFrom.getTime() > now.getTime()) {
    return; // upcoming published version — advance acceptance is valid
  }
  throw new DomainError('VERSION_NOT_CURRENT');
};

/** Consent only to documents of an audience whose role (audience key) the customer holds. */
export const assertCustomerHasRole = (customer: Customer, audienceKey: string): void => {
  if (!customer.roles.includes(audienceKey)) {
    throw new DomainError('ROLE_MISMATCH', `Customer ${customer.id} does not have the role ${audienceKey}`);
  }
};

/** Only DRAFTs are mutable/deletable; PUBLISHED/RETIRED are immutable. */
export const assertDraftMutable = (version: AgreementVersion): void => {
  if (version.status !== 'DRAFT') {
    throw new DomainError('VERSION_IMMUTABLE', `Version ${version.id} is ${version.status}`);
  }
};

const isBlank = (value: string | undefined): boolean => value === undefined || value.trim() === '';

/**
 * Publish validation: only DRAFTs; changeSummary is required (popup); consentText is
 * required for ACTIVE; PASSIVE needs a determinable objection period.
 */
export const validateForPublish = (version: AgreementVersion): void => {
  assertDraftMutable(version);
  if (isBlank(version.changeSummary)) {
    throw new DomainError('CHANGE_SUMMARY_REQUIRED');
  }
  if (version.acceptanceMode === 'ACTIVE' && isBlank(version.consentText)) {
    throw new DomainError('CONSENT_TEXT_REQUIRED');
  }
  if (version.acceptanceMode === 'PASSIVE' && version.objectionPeriodDays === undefined) {
    throw new DomainError('INVALID_STATE', 'PASSIVE version without objectionPeriodDays — deadline cannot be determined');
  }
};

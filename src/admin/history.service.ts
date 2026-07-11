import { Inject, Injectable } from '@nestjs/common';
import { DomainError } from '../common/errors.js';
import { TOKENS } from '../persistence/tokens.js';
import type { Actor } from '../common/auth/actor.js';
import type {
  AcceptanceRepo,
  AgreementDocumentRepo,
  AgreementVersionRepo,
  CustomerRepo,
  CustomerVersionStateRepo,
  NotificationEventRepo,
  ObjectionRepo,
  SignedDocumentRepo,
} from '../domain/ports.js';
import type {
  AcceptanceChannel,
  AcceptanceMethod,
  CustomerVersionState,
  NotificationChannel,
  Objection,
  SignedDocument,
} from '../domain/types.js';

export interface HistoryAcceptance {
  versionId: string;
  /** Document type key. */
  documentType?: string;
  versionLabel?: string;
  method: AcceptanceMethod;
  channel: AcceptanceChannel;
  acceptedAt: Date;
  actor: Actor;
  isEffective: boolean;
  evidence: {
    ipAddress?: string;
    userAgent?: string;
    consentText?: string;
    consentTextHash?: string;
    contentHash?: string;
    /** IMPORT only: reference to the signed offer / CRM deal that carried the signature. */
    evidenceNote?: string;
  };
}

export interface HistoryNotification {
  versionId: string;
  channel: NotificationChannel;
  deliveredAt: Date;
}

/** Rollout state including its ID — the admin UI needs the ID for PATCH/:remind (operations actions). */
export interface HistoryState {
  id: string;
  versionId: string;
  /** Document type key. */
  documentType?: string;
  versionLabel?: string;
  state: CustomerVersionState['state'];
  notifiedAt?: Date;
  deadlineAt?: Date;
  remindersSent: number;
  carryOverBlocking?: boolean;
}

/**
 * Externally-signed document in the customer history (evidence archive). The internal storageKey
 * is never exposed; the PDF is fetched via GET /admin/signed-documents/:id/pdf. NOT part of the
 * compliance gate.
 */
export interface HistorySignedDocument {
  id: string;
  documentTypeKey: string;
  audience?: string;
  fileName: string;
  contentHash: string;
  fileSize: number;
  signedAt: Date;
  signerName?: string;
  reference?: string;
  note?: string;
  uploadedBy: string;
  uploadedAt: Date;
}

export interface CustomerHistory {
  acceptances: HistoryAcceptance[];
  objections: Objection[];
  notifications: HistoryNotification[];
  states: HistoryState[];
  /** Externally-signed documents (newest first) — pure evidence, never part of the compliance gate. */
  signedDocuments: HistorySignedDocument[];
}

/** Complete history of a customer including evidence data (legal admins only). */
@Injectable()
export class HistoryService {
  constructor(
    @Inject(TOKENS.CustomerRepo) private readonly customers: CustomerRepo,
    @Inject(TOKENS.AcceptanceRepo) private readonly acceptances: AcceptanceRepo,
    @Inject(TOKENS.ObjectionRepo) private readonly objections: ObjectionRepo,
    @Inject(TOKENS.NotificationEventRepo) private readonly notifications: NotificationEventRepo,
    @Inject(TOKENS.CustomerVersionStateRepo) private readonly states: CustomerVersionStateRepo,
    @Inject(TOKENS.AgreementVersionRepo) private readonly versions: AgreementVersionRepo,
    @Inject(TOKENS.AgreementDocumentRepo) private readonly documents: AgreementDocumentRepo,
    @Inject(TOKENS.SignedDocumentRepo) private readonly signedDocuments: SignedDocumentRepo,
  ) {}

  async history(customerId: string): Promise<CustomerHistory> {
    const customer = await this.customers.findById(customerId);
    if (!customer) {
      throw new DomainError('CUSTOMER_NOT_FOUND');
    }

    const rawAcceptances = await this.acceptances.findByCustomer(customerId);
    const acceptances: HistoryAcceptance[] = [];
    for (const acceptance of rawAcceptances) {
      const version = await this.versions.findById(acceptance.versionId);
      const document = version ? await this.documents.findById(version.documentId) : undefined;
      acceptances.push({
        versionId: acceptance.versionId,
        documentType: document?.type,
        versionLabel: version?.versionLabel,
        method: acceptance.method,
        channel: acceptance.channel,
        acceptedAt: acceptance.acceptedAt,
        actor: acceptance.actor,
        isEffective: acceptance.isEffective,
        evidence: {
          ipAddress: acceptance.ipAddress,
          userAgent: acceptance.userAgent,
          consentText: acceptance.consentText,
          consentTextHash: acceptance.consentTextHash,
          contentHash: acceptance.contentHash,
          evidenceNote: acceptance.evidenceNote,
        },
      });
    }

    const objections = await this.objections.findByCustomer(customerId);

    const customerStates = await this.states.findByCustomer(customerId);
    const notifications: HistoryNotification[] = [];
    for (const state of customerStates) {
      for (const event of await this.notifications.findByState(state.id)) {
        notifications.push({ versionId: state.versionId, channel: event.channel, deliveredAt: event.occurredAt });
      }
    }
    notifications.sort((a, b) => a.deliveredAt.getTime() - b.deliveredAt.getTime());

    const historyStates: HistoryState[] = [];
    for (const state of customerStates) {
      const version = await this.versions.findById(state.versionId);
      const document = version ? await this.documents.findById(version.documentId) : undefined;
      historyStates.push({
        id: state.id,
        versionId: state.versionId,
        documentType: document?.type,
        versionLabel: version?.versionLabel,
        state: state.state,
        notifiedAt: state.notifiedAt,
        deadlineAt: state.deadlineAt,
        remindersSent: state.remindersSent,
        carryOverBlocking: state.carryOverBlocking,
      });
    }

    const rawSignedDocuments = await this.signedDocuments.findByCustomer(customerId);
    const signedDocuments: HistorySignedDocument[] = rawSignedDocuments.map(toHistorySignedDocument);

    return { acceptances, objections, notifications, states: historyStates, signedDocuments };
  }
}

const toHistorySignedDocument = (document: SignedDocument): HistorySignedDocument => ({
  id: document.id,
  documentTypeKey: document.documentTypeKey,
  audience: document.audience,
  fileName: document.fileName,
  contentHash: document.contentHash,
  fileSize: document.fileSize,
  signedAt: document.signedAt,
  signerName: document.signerName,
  reference: document.reference,
  note: document.note,
  uploadedBy: document.uploadedBy,
  uploadedAt: document.uploadedAt,
});

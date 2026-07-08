/** DI tokens for the domain ports (wiring: repository.module.ts; tests: direct instantiation with fakes). */
export const TOKENS = {
  AudienceRepo: Symbol('AudienceRepo'),
  DocumentTypeRepo: Symbol('DocumentTypeRepo'),
  EmailTemplateRepo: Symbol('EmailTemplateRepo'),
  AgreementDocumentRepo: Symbol('AgreementDocumentRepo'),
  AgreementVersionRepo: Symbol('AgreementVersionRepo'),
  CustomerRepo: Symbol('CustomerRepo'),
  CustomerVersionStateRepo: Symbol('CustomerVersionStateRepo'),
  AcceptanceRepo: Symbol('AcceptanceRepo'),
  ObjectionRepo: Symbol('ObjectionRepo'),
  NotificationEventRepo: Symbol('NotificationEventRepo'),
  AcceptanceLinkRepo: Symbol('AcceptanceLinkRepo'),
  SignedDocumentRepo: Symbol('SignedDocumentRepo'),
  Clock: Symbol('Clock'),
} as const;

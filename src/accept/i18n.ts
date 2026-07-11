/**
 * UI strings of the hosted acceptance page (en + de). Language: `?lang=` query parameter wins,
 * then the Accept-Language header, default English.
 */
import type { AcceptancePageLang } from '../plugin-sdk/index.js';

/** The page language lives in the plugin SDK (the renderer contract's lang type); this is an alias. */
export type AcceptPageLang = AcceptancePageLang;

export interface AcceptPageStrings {
  htmlLang: string;
  pageTitle: string;
  heading: string;
  intro: string;
  identityNote: string;
  /** Shown above the signer block when a company/organisation is known ("On behalf of {company}"). */
  companyContext: string;
  signerName: string;
  signerEmail: string;
  versionLabel: string;
  changeSummary: string;
  openPdf: string;
  deadline: string;
  /** Scheduled effectiveness: "Valid from {date}" note on an upcoming (not yet effective) card. */
  upcomingValidFrom: string;
  blockingWarning: string;
  passiveInfo: string;
  /** Button on a PASSIVE item to opt in early, before the objection deadline (no consent checkbox). */
  passiveAcceptButton: string;
  /** PASSIVE only — objection ("Widerspruch") UI on the acceptance page (#30). */
  objectButton: string;
  objectionReasonLabel: string;
  objectionReasonPlaceholder: string;
  objectionConsequenceLabel: string;
  objectedBadge: string;
  errorObjectionReasonRequired: string;
  acceptButton: string;
  acceptedBadge: string;
  allDoneTitle: string;
  allDoneBody: string;
  notFoundTitle: string;
  notFoundBody: string;
  errorMissingSigner: string;
  errorInvalidEmail: string;
  errorConsentRequired: string;
  errorAlreadyAccepted: string;
  errorVersionNotCurrent: string;
  errorRateLimited: string;
  errorGeneric: string;
}

export const ACCEPT_PAGE_STRINGS: Record<AcceptPageLang, AcceptPageStrings> = {
  en: {
    htmlLang: 'en',
    pageTitle: 'Review & accept documents',
    heading: 'Documents awaiting your review',
    intro: 'Please review the following document(s) for {customerName} and confirm your acceptance.',
    identityNote:
      'Your name and e-mail address are recorded together with your consent, along with the time and your device details.',
    companyContext: 'On behalf of {company}',
    signerName: 'Your full name',
    signerEmail: 'Your e-mail address',
    versionLabel: 'Version',
    changeSummary: 'What changed',
    openPdf: 'Open document (PDF)',
    deadline: 'Deadline',
    upcomingValidFrom: 'Valid from {date} — the current version remains in effect until then.',
    blockingWarning: 'Access is currently blocked until this document is accepted.',
    passiveInfo:
      'This document takes effect automatically unless an objection is raised before the deadline. No action is required here.',
    passiveAcceptButton: 'Accept now',
    objectButton: 'Object to this document',
    objectionReasonLabel: 'Reason for your objection (required)',
    objectionReasonPlaceholder: 'Please state why you object…',
    objectionConsequenceLabel: 'What objecting means',
    objectedBadge: 'Objection recorded — thank you.',
    errorObjectionReasonRequired: 'Please state a reason for your objection.',
    acceptButton: 'I agree — accept',
    acceptedBadge: 'Accepted — thank you!',
    allDoneTitle: 'Everything is accepted',
    allDoneBody: 'There are currently no documents waiting for acceptance. You can close this page.',
    notFoundTitle: 'Link not available',
    notFoundBody:
      'This link is not available. It may have expired or been revoked. Please contact the person who sent it to you to request a new link.',
    errorMissingSigner: 'Please enter your full name and e-mail address first.',
    errorInvalidEmail: 'Please enter a valid e-mail address.',
    errorConsentRequired: 'Please confirm the checkbox to accept.',
    errorAlreadyAccepted: 'This document has already been accepted.',
    errorVersionNotCurrent: 'A newer version of this document exists — please reload the page.',
    errorRateLimited: 'Too many requests — please wait a minute and try again.',
    errorGeneric: 'Something went wrong. Please reload the page and try again.',
  },
  de: {
    htmlLang: 'de',
    pageTitle: 'Dokumente prüfen & akzeptieren',
    heading: 'Dokumente zur Prüfung',
    intro: 'Bitte prüfen Sie die folgenden Dokumente für {customerName} und bestätigen Sie Ihre Zustimmung.',
    identityNote:
      'Ihr Name und Ihre E-Mail-Adresse werden zusammen mit Ihrer Zustimmung erfasst, ebenso Zeitpunkt und Geräteinformationen.',
    companyContext: 'Im Namen von {company}',
    signerName: 'Ihr vollständiger Name',
    signerEmail: 'Ihre E-Mail-Adresse',
    versionLabel: 'Version',
    changeSummary: 'Was hat sich geändert',
    openPdf: 'Dokument öffnen (PDF)',
    deadline: 'Frist',
    upcomingValidFrom: 'Gültig ab {date} — bis dahin bleibt die aktuelle Version in Kraft.',
    blockingWarning: 'Der Zugang ist derzeit gesperrt, bis dieses Dokument akzeptiert wurde.',
    passiveInfo:
      'Dieses Dokument tritt automatisch in Kraft, sofern nicht vor Ablauf der Frist widersprochen wird. Hier ist keine Aktion erforderlich.',
    passiveAcceptButton: 'Jetzt akzeptieren',
    objectButton: 'Diesem Dokument widersprechen',
    objectionReasonLabel: 'Grund für Ihren Widerspruch (erforderlich)',
    objectionReasonPlaceholder: 'Bitte begründen Sie Ihren Widerspruch…',
    objectionConsequenceLabel: 'Was ein Widerspruch bedeutet',
    objectedBadge: 'Widerspruch erfasst — vielen Dank.',
    errorObjectionReasonRequired: 'Bitte geben Sie einen Grund für Ihren Widerspruch an.',
    acceptButton: 'Ich stimme zu — akzeptieren',
    acceptedBadge: 'Akzeptiert — vielen Dank!',
    allDoneTitle: 'Alles akzeptiert',
    allDoneBody: 'Derzeit warten keine Dokumente auf eine Zustimmung. Sie können diese Seite schließen.',
    notFoundTitle: 'Link nicht verfügbar',
    notFoundBody:
      'Dieser Link ist nicht verfügbar. Er ist möglicherweise abgelaufen oder wurde zurückgezogen. Bitte wenden Sie sich an die Person, die Ihnen den Link geschickt hat, um einen neuen Link zu erhalten.',
    errorMissingSigner: 'Bitte geben Sie zuerst Ihren vollständigen Namen und Ihre E-Mail-Adresse ein.',
    errorInvalidEmail: 'Bitte geben Sie eine gültige E-Mail-Adresse ein.',
    errorConsentRequired: 'Bitte bestätigen Sie die Checkbox, um zu akzeptieren.',
    errorAlreadyAccepted: 'Dieses Dokument wurde bereits akzeptiert.',
    errorVersionNotCurrent: 'Es gibt eine neuere Version dieses Dokuments — bitte laden Sie die Seite neu.',
    errorRateLimited: 'Zu viele Anfragen — bitte warten Sie eine Minute und versuchen Sie es erneut.',
    errorGeneric: 'Etwas ist schiefgelaufen. Bitte laden Sie die Seite neu und versuchen Sie es erneut.',
  },
};

/** `?lang=` wins, then the first supported language in Accept-Language, default en. */
export const resolveAcceptPageLang = (queryLang?: string, acceptLanguageHeader?: string): AcceptPageLang => {
  const query = queryLang?.trim().toLowerCase();
  if (query === 'de' || query === 'en') {
    return query;
  }
  for (const part of (acceptLanguageHeader ?? '').split(',')) {
    const tag = part.split(';')[0]?.trim().toLowerCase() ?? '';
    if (tag === 'de' || tag.startsWith('de-')) {
      return 'de';
    }
    if (tag === 'en' || tag.startsWith('en-')) {
      return 'en';
    }
  }
  return 'en';
};

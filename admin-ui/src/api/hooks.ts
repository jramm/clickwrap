import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from './client';
import {
  adminControllerCreateAcceptanceLink,
  adminControllerCreateCustomer,
  adminControllerCreateEmailTemplate,
  adminControllerDashboardQueryOptions,
  adminControllerDeleteEmailTemplate,
  adminControllerListEmailTemplates,
  adminControllerListEmailTemplatesQueryKey,
  adminControllerPreviewEmailTemplate,
  adminControllerUpdateEmailTemplate,
  adminControllerHistoryQueryKey,
  adminControllerHistoryQueryOptions,
  adminControllerGetCustomerQueryOptions,
  adminControllerListAudiences,
  adminControllerListAudiencesQueryKey,
  adminControllerListCustomersQueryKey,
  adminControllerListCustomersQueryOptions,
  adminControllerListDocumentTypes,
  adminControllerListDocumentTypesQueryKey,
  adminControllerManualAcceptance,
  adminControllerPatchState,
  adminControllerPublish,
  adminControllerRemind,
  adminControllerUpdateCustomer,
  adminControllerVersionCustomersQueryOptions,
  eventsControllerListEventsQueryOptions,
  agreementsAdminControllerCreateDocument,
  agreementsAdminControllerDeleteVersion,
  agreementsAdminControllerListDocumentsQueryKey,
  agreementsAdminControllerListDocumentsQueryOptions,
  agreementsAdminControllerListVersionsQueryKey,
  agreementsAdminControllerListVersionsQueryOptions,
  createVersionResponseModelSchema,
  signedDocumentModelSchema,
  signedDocumentsAdminControllerListQueryKey,
  signedDocumentsAdminControllerListQueryOptions,
} from '../gen';
import type {
  AdminControllerListCustomersQueryParams,
  AdminControllerListCustomersQueryParamsComplianceEnum as ComplianceFilter,
  AdminControllerVersionCustomersQueryParams,
  EventsControllerListEventsQueryParams,
  EventsControllerListEventsQueryParamsCategoryEnum as EventCategory,
  CreateAcceptanceLinkResponseModel,
  CreateCustomerBodyModel,
  CreateDocumentBodyModel,
  CreateEmailTemplateBodyModel,
  CreateVersionResponseModel,
  ManualAcceptanceBodyModel,
  SignedDocumentModel,
  UpdateCustomerBodyModel,
  UpdateEmailTemplateBodyModel,
} from '../gen';

/**
 * Thin react-query wrappers over the kubb-generated hooks (src/gen). All types
 * and zod validation come from the generated client; these wrappers only add
 * ergonomic call signatures and targeted cache invalidation after mutations.
 * The multipart "create version" upload reuses the shared fetcher (client.ts)
 * with the generated response schema (kubb models FormData uploads awkwardly).
 */

// --- Friendly type aliases (all sourced from the generated client) ---------
export type { EventCategory };
export type {
  EventModel as Event,
  EventModelTypeEnum as EventType,
  EventModelActorKindEnum as EventActorKind,
  EventListResponseModel as EventList,
  CustomerHistoryResponseModel as CustomerHistory,
  CustomerRowModel as CustomerRow,
  CustomerRowModelComplianceStatusEnum as ComplianceStatus,
  DocumentListEntryModel as AgreementDocument,
  DocumentTypeModel as DocumentType,
  EmailTemplateModel as EmailTemplate,
  EmailTemplateModelKindEnum as EmailTemplateKind,
  EmailTemplatePreviewResponseModel as EmailTemplatePreview,
  HistoryAcceptanceModel as Acceptance,
  HistoryNotificationModel as Notification,
  HistoryObjectionModel as Objection,
  HistoryStateModel as HistoryState,
  NamedEntityModel as Category,
  SignedDocumentModel as SignedDocument,
  HistoryStateModelStateEnum as CellState,
  PublishResponseModel as PublishResult,
  VersionModel as Version,
  VersionStatsModel as VersionStats,
  VersionAcceptanceStatsModel as VersionAcceptanceStats,
  VersionCustomerRowModel as VersionCustomerRow,
  VersionCustomerRowModelStateEnum as VersionCustomerState,
  VersionCustomerAcceptanceModel as VersionCustomerAcceptance,
  VersionCustomersResponseModel as VersionCustomers,
} from '../gen';

export type CategoryKind = 'audiences' | 'document-types';

// --- Categories (audiences & document types) -----------------------------
export function useCategories(kind: CategoryKind) {
  return useQuery({
    queryKey: categoryKey(kind),
    queryFn: ({ signal }) =>
      kind === 'audiences'
        ? adminControllerListAudiences({ signal })
        : adminControllerListDocumentTypes({ signal }),
  });
}

export function useAudiences() {
  return useCategories('audiences');
}

export function useDocumentTypes() {
  return useCategories('document-types');
}

function categoryKey(kind: CategoryKind) {
  return kind === 'audiences'
    ? adminControllerListAudiencesQueryKey()
    : adminControllerListDocumentTypesQueryKey();
}

// Audiences and document types are READ-ONLY in the admin UI — they are declared in the
// legal-entities config file (config/legal-entities.json) and reconciled into the store at boot.
// There are deliberately no create/rename/delete/assign-template hooks here anymore.

// --- Dashboard (per-version acceptance stats) ----------------------------
export function useDashboard() {
  return useQuery(adminControllerDashboardQueryOptions());
}

// --- Per-version customer status list (drill-down) -----------------------
export interface VersionCustomersParams {
  /** accepted | pending | blocked | objected (omit for all). */
  state?: string;
  search?: string;
  page?: number;
}

/**
 * Per-version customer list (`GET /admin/versions/:id/customers`). Every row reports the customer's
 * state and acceptance FOR THIS version (rather than only the currently effective one).
 */
export function useVersionCustomers(versionId: string, params: VersionCustomersParams) {
  const queryParams: AdminControllerVersionCustomersQueryParams = {
    state: params.state as AdminControllerVersionCustomersQueryParams['state'],
    search: params.search,
    page: params.page !== undefined ? String(params.page) : undefined,
  };
  return useQuery(adminControllerVersionCustomersQueryOptions({ id: versionId, params: queryParams }));
}

// --- Hosted acceptance links ----------------------------------------------
export interface CreateAcceptanceLinkInput {
  customerId: string;
  /** Optional scope; omitted = whole customer (all roles). */
  audienceKey?: string;
  /** Default 30 (backend), max 365. */
  expiresInDays?: number;
}

export type AcceptanceLinkResult = CreateAcceptanceLinkResponseModel;

/** Mints a hosted acceptance link (`POST /admin/customers/:id/acceptance-links`). */
export function useCreateAcceptanceLink() {
  return useMutation({
    mutationFn: (input: CreateAcceptanceLinkInput) =>
      adminControllerCreateAcceptanceLink({
        id: input.customerId,
        data: { audienceKey: input.audienceKey, expiresInDays: input.expiresInDays },
      }),
  });
}

// --- Customer detail -----------------------------------------------------
export function useCustomerHistory(customerId: string) {
  return useQuery({
    ...adminControllerHistoryQueryOptions({ id: customerId }),
    enabled: Boolean(customerId),
  });
}

/** Single customer record (`GET /admin/customers/:id`) — powers the detail-page header. */
export function useCustomer(customerId: string) {
  return useQuery({
    ...adminControllerGetCustomerQueryOptions({ id: customerId }),
    enabled: Boolean(customerId),
  });
}

// --- Signed documents (externally-signed evidence archive) ----------------
/** A customer's externally-signed documents (`GET /admin/customers/:id/signed-documents`), newest first. */
export function useSignedDocuments(customerId: string) {
  return useQuery({
    ...signedDocumentsAdminControllerListQueryOptions({ id: customerId }),
    enabled: Boolean(customerId),
    select: (data) => data.items,
  });
}

export interface UploadSignedDocumentInput {
  customerId: string;
  file: File;
  documentTypeKey: string;
  /** ISO date-time string. */
  signedAt: string;
  signerName?: string;
  reference?: string;
  audience?: string;
  note?: string;
}

/**
 * Uploads an externally-signed document (multipart, field `file`). Like the version upload, this
 * bypasses the generated hook (kubb models FormData awkwardly) and uses the shared fetcher with
 * the generated response schema.
 */
export function useUploadSignedDocument() {
  const qc = useQueryClient();
  return useMutation<SignedDocumentModel, unknown, UploadSignedDocumentInput>({
    mutationFn: (input) => {
      const form = new FormData();
      form.set('file', input.file);
      form.set('documentTypeKey', input.documentTypeKey);
      form.set('signedAt', input.signedAt);
      if (input.signerName) form.set('signerName', input.signerName);
      if (input.reference) form.set('reference', input.reference);
      if (input.audience) form.set('audience', input.audience);
      if (input.note) form.set('note', input.note);
      return apiRequest(`/admin/customers/${input.customerId}/signed-documents`, {
        method: 'POST',
        form,
        schema: signedDocumentModelSchema,
      });
    },
    onSuccess: (_data, input) => {
      void qc.invalidateQueries({ queryKey: signedDocumentsAdminControllerListQueryKey({ id: input.customerId }) });
      void qc.invalidateQueries({ queryKey: adminControllerHistoryQueryKey({ id: input.customerId }) });
    },
  });
}

// --- Documents & versions ------------------------------------------------
export function useDocuments() {
  return useQuery({
    ...agreementsAdminControllerListDocumentsQueryOptions(),
    select: (data) => data.items,
  });
}

export function useCreateDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateDocumentBodyModel) =>
      agreementsAdminControllerCreateDocument({ data: input }),
    onSuccess: () =>
      void qc.invalidateQueries({ queryKey: agreementsAdminControllerListDocumentsQueryKey() }),
  });
}

export function useVersions(documentId: string, enabled = true) {
  return useQuery({
    ...agreementsAdminControllerListVersionsQueryOptions({ id: documentId }),
    enabled: enabled && Boolean(documentId),
    select: (data) => data.items,
  });
}

/**
 * Version lists for MULTIPLE documents at once (manual-acceptance dialog with "show older
 * versions"). Returns a map documentId → versions; documents whose list has not loaded yet map
 * to [].
 */
export function useVersionsForDocuments(documentIds: string[], enabled = true) {
  return useQueries({
    queries: documentIds.map((id) => ({
      ...agreementsAdminControllerListVersionsQueryOptions({ id }),
      enabled: enabled && Boolean(id),
    })),
    combine: (results) => ({
      isLoading: results.some((result) => result.isLoading),
      versionsByDocument: new Map(documentIds.map((id, index) => [id, results[index]?.data?.items ?? []])),
    }),
  });
}

// --- Create version (multipart, field `file`) ----------------------------
export interface CreateVersionInput {
  documentId: string;
  file: File;
  versionLabel: string;
  changeSummary: string;
  acceptanceMode: 'ACTIVE' | 'PASSIVE';
  validFrom: string;
  consentText?: string;
  objectionPeriodDays?: number;
  /** ACTIVE only: absolute acceptance deadline as a full ISO date-time (>= validFrom). */
  hardDeadlineAt?: string;
}

function invalidateDocsAndVersions(qc: ReturnType<typeof useQueryClient>, documentId: string) {
  void qc.invalidateQueries({
    queryKey: agreementsAdminControllerListVersionsQueryKey({ id: documentId }),
  });
  void qc.invalidateQueries({ queryKey: agreementsAdminControllerListDocumentsQueryKey() });
}

export function useCreateVersion() {
  const qc = useQueryClient();
  return useMutation<CreateVersionResponseModel, unknown, CreateVersionInput>({
    mutationFn: (input) => {
      const form = new FormData();
      form.set('file', input.file);
      form.set('versionLabel', input.versionLabel);
      form.set('changeSummary', input.changeSummary);
      form.set('acceptanceMode', input.acceptanceMode);
      form.set('validFrom', input.validFrom);
      if (input.consentText) form.set('consentText', input.consentText);
      if (input.objectionPeriodDays !== undefined)
        form.set('objectionPeriodDays', String(input.objectionPeriodDays));
      if (input.hardDeadlineAt !== undefined) form.set('hardDeadlineAt', input.hardDeadlineAt);
      return apiRequest(`/admin/documents/${input.documentId}/versions`, {
        method: 'POST',
        form,
        schema: createVersionResponseModelSchema,
      });
    },
    onSuccess: (_data, input) => invalidateDocsAndVersions(qc, input.documentId),
  });
}

export function useDeleteVersion(documentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (versionId: string) => agreementsAdminControllerDeleteVersion({ id: versionId }),
    onSuccess: () => invalidateDocsAndVersions(qc, documentId),
  });
}

export function usePublishVersion(documentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (versionId: string) => adminControllerPublish({ id: versionId }),
    onSuccess: () => invalidateDocsAndVersions(qc, documentId),
  });
}

// --- Extend deadline / suspend block -------------------------------------
export interface PatchStateInput {
  stateId: string;
  deadlineAt?: string;
  suspendBlock?: boolean;
  reason: string;
}

export function usePatchCustomerVersionState(customerId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: PatchStateInput) =>
      adminControllerPatchState({
        id: input.stateId,
        data: { deadlineAt: input.deadlineAt, suspendBlock: input.suspendBlock, reason: input.reason },
      }),
    onSuccess: () =>
      void qc.invalidateQueries({ queryKey: adminControllerHistoryQueryKey({ id: customerId }) }),
  });
}

export function useRemind(customerId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (stateId: string) => adminControllerRemind({ id: stateId }),
    onSuccess: () =>
      void qc.invalidateQueries({ queryKey: adminControllerHistoryQueryKey({ id: customerId }) }),
  });
}

// --- Manual acceptance (evidence PDF as base64) --------------------------
export function useManualAcceptance(customerId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ManualAcceptanceBodyModel) =>
      adminControllerManualAcceptance({ id: customerId, data: input }),
    onSuccess: () =>
      void qc.invalidateQueries({ queryKey: adminControllerHistoryQueryKey({ id: customerId }) }),
  });
}

// --- Customers -----------------------------------------------------------
export type { ComplianceFilter };

export interface CustomerListFilters {
  audience?: string;
  documentType?: string;
  compliance?: ComplianceFilter;
}

export function useCustomers(page?: number, search?: string, filters: CustomerListFilters = {}) {
  const params: AdminControllerListCustomersQueryParams = {};
  if (page !== undefined) params.page = String(page);
  if (search) params.search = search;
  if (filters.audience) params.audience = filters.audience;
  if (filters.documentType) params.documentType = filters.documentType;
  if (filters.compliance) params.compliance = filters.compliance;
  return useQuery(
    adminControllerListCustomersQueryOptions({
      params: Object.keys(params).length > 0 ? params : undefined,
    }),
  );
}

// --- Events (legal audit log) --------------------------------------------
export interface EventFilters {
  customerId?: string;
  /** Full ISO date-time (widened from the date input — see EventsPage). */
  from?: string;
  to?: string;
  category?: EventCategory;
  documentType?: string;
  versionId?: string;
}

/**
 * Aggregated legal event log (`GET /admin/events`), newest-first, 50/page. The query key includes
 * every filter (react-query resets/refetches on change); reset the page to 1 on any filter change
 * in the consuming component.
 */
export function useEvents(page: number, filters: EventFilters = {}) {
  const params: EventsControllerListEventsQueryParams = { page: String(page) };
  if (filters.customerId) params.customerId = filters.customerId;
  if (filters.from) params.from = filters.from;
  if (filters.to) params.to = filters.to;
  if (filters.category) params.category = filters.category;
  if (filters.documentType) params.documentType = filters.documentType;
  if (filters.versionId) params.versionId = filters.versionId;
  return useQuery(eventsControllerListEventsQueryOptions({ params }));
}

export function useCreateCustomer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateCustomerBodyModel) => adminControllerCreateCustomer({ data: input }),
    onSuccess: () =>
      void qc.invalidateQueries({ queryKey: adminControllerListCustomersQueryKey() }),
  });
}

export interface UpdateCustomerInput {
  id: string;
  data: UpdateCustomerBodyModel;
}

export function useUpdateCustomer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateCustomerInput) =>
      adminControllerUpdateCustomer({ id: input.id, data: input.data }),
    onSuccess: () =>
      void qc.invalidateQueries({ queryKey: adminControllerListCustomersQueryKey() }),
  });
}

// --- E-mail templates ----------------------------------------------------
export function useEmailTemplates() {
  return useQuery({
    queryKey: adminControllerListEmailTemplatesQueryKey(),
    queryFn: ({ signal }) => adminControllerListEmailTemplates({ signal }),
  });
}

export function useCreateEmailTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateEmailTemplateBodyModel) =>
      adminControllerCreateEmailTemplate({ data: input }),
    onSuccess: () =>
      void qc.invalidateQueries({ queryKey: adminControllerListEmailTemplatesQueryKey() }),
  });
}

export interface UpdateEmailTemplateInput {
  id: string;
  data: UpdateEmailTemplateBodyModel;
}

export function useUpdateEmailTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateEmailTemplateInput) =>
      adminControllerUpdateEmailTemplate({ id: input.id, data: input.data }),
    onSuccess: () =>
      void qc.invalidateQueries({ queryKey: adminControllerListEmailTemplatesQueryKey() }),
  });
}

export function useDeleteEmailTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => adminControllerDeleteEmailTemplate({ id }),
    onSuccess: () =>
      void qc.invalidateQueries({ queryKey: adminControllerListEmailTemplatesQueryKey() }),
  });
}

/** Renders a template with sample values (used by the live preview). */
export function usePreviewEmailTemplate() {
  return useMutation({
    mutationFn: (input: { id: string; documentTypeKey?: string }) =>
      adminControllerPreviewEmailTemplate({
        id: input.id,
        data: { documentTypeKey: input.documentTypeKey },
      }),
  });
}

// Document-type e-mail template assignments are configured via the legal-entities config file
// (config/legal-entities.json: notificationTemplateId / reminderTemplateId /
// acceptanceConfirmationTemplateId per document type), no longer via the admin UI.

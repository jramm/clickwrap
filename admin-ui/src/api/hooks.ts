import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from './client';
import {
  adminControllerCreateAcceptanceLink,
  adminControllerCreateAudience,
  adminControllerCreateCustomer,
  adminControllerCreateDocumentType,
  adminControllerCreateEmailTemplate,
  adminControllerDashboardQueryOptions,
  adminControllerDeleteAudience,
  adminControllerDeleteDocumentType,
  adminControllerDeleteEmailTemplate,
  adminControllerListEmailTemplates,
  adminControllerListEmailTemplatesQueryKey,
  adminControllerPreviewEmailTemplate,
  adminControllerUpdateEmailTemplate,
  adminControllerHistoryQueryKey,
  adminControllerHistoryQueryOptions,
  adminControllerListAudiences,
  adminControllerListAudiencesQueryKey,
  adminControllerListCustomersQueryKey,
  adminControllerListCustomersQueryOptions,
  adminControllerListDocumentTypes,
  adminControllerListDocumentTypesQueryKey,
  adminControllerManualAcceptance,
  adminControllerOverviewQueryOptions,
  adminControllerPatchState,
  adminControllerPublish,
  adminControllerRemind,
  adminControllerUpdateAudience,
  adminControllerUpdateCustomer,
  adminControllerUpdateDocumentType,
  adminControllerVersionCustomersQueryOptions,
  agreementsAdminControllerCreateDocument,
  agreementsAdminControllerDeleteVersion,
  agreementsAdminControllerListDocumentsQueryKey,
  agreementsAdminControllerListDocumentsQueryOptions,
  agreementsAdminControllerListVersionsQueryKey,
  agreementsAdminControllerListVersionsQueryOptions,
  createVersionResponseModelSchema,
} from '../gen';
import type {
  AdminControllerOverviewQueryParams,
  AdminControllerVersionCustomersQueryParams,
  CreateAcceptanceLinkResponseModel,
  CreateCustomerBodyModel,
  CreateDocumentBodyModel,
  CreateEmailTemplateBodyModel,
  CreateNamedEntityBodyModel,
  CreateVersionResponseModel,
  ManualAcceptanceBodyModel,
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
export type {
  CustomerHistoryResponseModel as CustomerHistory,
  CustomerRowModel as CustomerRow,
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
  OverviewCellModel as OverviewCell,
  OverviewCellModelStateEnum as CellState,
  OverviewRowModel as OverviewItem,
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

export function useCreateCategory(kind: CategoryKind) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateNamedEntityBodyModel) =>
      kind === 'audiences'
        ? adminControllerCreateAudience({ data: input })
        : adminControllerCreateDocumentType({ data: input }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: categoryKey(kind) }),
  });
}

export interface RenameCategoryInput {
  id: string;
  name: string;
}

export function useRenameCategory(kind: CategoryKind) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: RenameCategoryInput) =>
      kind === 'audiences'
        ? adminControllerUpdateAudience({ id: input.id, data: { name: input.name } })
        : adminControllerUpdateDocumentType({ id: input.id, data: { name: input.name } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: categoryKey(kind) }),
  });
}

export function useDeleteCategory(kind: CategoryKind) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      kind === 'audiences'
        ? adminControllerDeleteAudience({ id })
        : adminControllerDeleteDocumentType({ id }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: categoryKey(kind) }),
  });
}

// --- Overview ------------------------------------------------------------
export interface OverviewParams {
  documentType?: string;
  audience?: string;
  filter?: string;
  search?: string;
  page?: number;
}

export function useOverview(params: OverviewParams) {
  const queryParams: AdminControllerOverviewQueryParams = {
    documentType: params.documentType,
    audience: params.audience,
    filter: params.filter as AdminControllerOverviewQueryParams['filter'],
    search: params.search,
    page: params.page !== undefined ? String(params.page) : undefined,
  };
  return useQuery(adminControllerOverviewQueryOptions({ params: queryParams }));
}

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
 * state and acceptance FOR THIS version — the version dimension the compliance overview drops.
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
  gracePeriodDays?: number;
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
      if (input.gracePeriodDays !== undefined)
        form.set('gracePeriodDays', String(input.gracePeriodDays));
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
export function useCustomers(page?: number, search?: string) {
  const params: { page?: string; search?: string } = {};
  if (page !== undefined) params.page = String(page);
  if (search) params.search = search;
  return useQuery(
    adminControllerListCustomersQueryOptions({
      params: Object.keys(params).length > 0 ? params : undefined,
    }),
  );
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

// --- Document type template assignments -----------------------------------
export interface AssignDocumentTypeTemplatesInput {
  id: string;
  /** string = assign, null = clear, undefined = keep. */
  notificationTemplateId?: string | null;
  reminderTemplateId?: string | null;
}

export function useAssignDocumentTypeTemplates() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: AssignDocumentTypeTemplatesInput) =>
      adminControllerUpdateDocumentType({
        id: input.id,
        data: {
          notificationTemplateId: input.notificationTemplateId,
          reminderTemplateId: input.reminderTemplateId,
        },
      }),
    onSuccess: () =>
      void qc.invalidateQueries({ queryKey: adminControllerListDocumentTypesQueryKey() }),
  });
}

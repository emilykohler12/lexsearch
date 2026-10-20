import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client';
import type {
  CaseInput,
  CaseStatus,
  ClientFields,
  CreateDraftInput,
  DeadlineInput,
  DeadlineStatus,
  DocumentCategory,
  FindingInput,
  NormativeAlertStatus,
  ProceedingInput,
  SearchFilters,
} from './types';

export const queryKeys = {
  health: ['health'] as const,
  auth: ['auth'] as const,
  // Everything about documents starts with 'documents': one invalidation refreshes the library and the ones of an expediente.
  documents: ['documents'] as const,
  documentList: (filters: { caseId?: string | undefined }) => ['documents', 'list', filters] as const,
  interactions: ['interactions'] as const,
  interaction: (id: string) => ['interactions', id] as const,
  // Lists share a prefix, so invalidating `drafts` also refreshes the ones filtered by client.
  drafts: ['drafts', 'list'] as const,
  draftsByClient: (clientId: string) => ['drafts', 'list', { clientId }] as const,
  draft: (id: string) => ['drafts', 'detail', id] as const,
  clients: ['clients', 'list'] as const,
  client: (id: string) => ['clients', 'detail', id] as const,
  // Everything about expedientes starts with 'cases': one invalidation refreshes lists, details and timelines.
  cases: ['cases'] as const,
  caseList: (filters: { status?: CaseStatus | undefined; clientId?: string | undefined }) => ['cases', 'list', filters] as const,
  case: (id: string) => ['cases', 'detail', id] as const,
  caseTimeline: (id: string) => ['cases', 'timeline', id] as const,
  contradictions: (caseId: string) => ['cases', 'contradictions', caseId] as const,
  // Everything about deadlines starts with 'deadlines': one invalidation refreshes lists, details and previews.
  deadlines: ['deadlines'] as const,
  deadlineList: (filters: { status?: DeadlineStatus | undefined; clientId?: string | undefined }) =>
    ['deadlines', 'list', filters] as const,
  deadline: (id: string) => ['deadlines', 'detail', id] as const,
  dueDate: (term: Pick<DeadlineInput, 'notificationDate' | 'days' | 'dayType'>) => ['deadlines', 'due-date', term] as const,
  calendar: (year: number) => ['calendar', year] as const,
  notifications: ['notifications'] as const,
  // Everything about the normative watch starts with 'normative': one invalidation refreshes alerts, norms and counts.
  normative: ['normative'] as const,
  normativeStatus: ['normative', 'status'] as const,
  normativeAlerts: (status: string) => ['normative', 'alerts', status] as const,
  normativeUnread: ['normative', 'unread'] as const,
  normativeItems: (filters: { source?: string | undefined; date?: string | undefined; q?: string | undefined; category?: string | undefined }) =>
    ['normative', 'items', filters] as const,
  normativeTopics: ['normative', 'topics'] as const,
  // Everything about the practices of audiencia starts with 'hearings': the list and each practice.
  hearings: ['hearings'] as const,
  hearing: (id: string) => ['hearings', id] as const,
  estimates: ['estimates'] as const,
  estimate: (id: string) => ['estimates', id] as const,
};

export function useHealth() {
  return useQuery({
    queryKey: queryKeys.health,
    queryFn: api.health,
    // Poll faster while the embedding model is still loading.
    refetchInterval: (query) => (query.state.data?.embeddings.status === 'loading' ? 3_000 : 20_000),
    retry: false,
  });
}

/** The whole library, or only the documents of one expediente. */
export function useDocuments(filters: { caseId?: string } = {}) {
  return useQuery({
    queryKey: queryKeys.documentList(filters),
    queryFn: () => api.listDocuments(filters),
    // While something is being indexed, refresh often to show progress.
    refetchInterval: (query) =>
      query.state.data?.some((d) => d.status === 'PENDING' || d.status === 'PROCESSING') ? 2_000 : false,
  });
}

export function useUploadDocuments() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ files, category, caseId }: { files: File[]; category: DocumentCategory; caseId?: string }) =>
      api.uploadDocuments(files, category, caseId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.documents }),
  });
}

export function useUpdateDocument() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: { id: string; title?: string; category?: DocumentCategory; caseId?: string | null }) =>
      api.updateDocument(id, data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.documents });
      // A renamed document is renamed in the findings that point at it.
      void queryClient.invalidateQueries({ queryKey: ['cases', 'contradictions'] });
    },
  });
}

export function useDeleteDocument() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: api.deleteDocument,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.documents }),
  });
}

export function useReprocessDocument() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: api.reprocessDocument,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.documents }),
  });
}

export function useSearch() {
  return useMutation({
    mutationFn: ({ query, filters }: { query: string; filters: SearchFilters }) => api.search(query, filters),
  });
}

export function useAsk() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ question, filters }: { question: string; filters: SearchFilters }) => api.ask(question, filters),
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.interactions }),
  });
}

export function useInteractions() {
  return useQuery({ queryKey: queryKeys.interactions, queryFn: api.listInteractions });
}

export function useInteraction(id: string | undefined) {
  return useQuery({
    queryKey: queryKeys.interaction(id ?? ''),
    queryFn: () => api.getInteraction(id!),
    enabled: Boolean(id),
  });
}

export function useDrafts() {
  return useQuery({ queryKey: queryKeys.drafts, queryFn: () => api.listDrafts() });
}

/** The drafts written for one client. */
export function useClientDrafts(clientId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.draftsByClient(clientId ?? ''),
    queryFn: () => api.listDrafts(clientId),
    enabled: Boolean(clientId),
  });
}

export function useDraft(id: string | undefined) {
  return useQuery({
    queryKey: queryKeys.draft(id ?? ''),
    queryFn: () => api.getDraft(id!),
    enabled: Boolean(id),
  });
}

export function useCreateDraft() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateDraftInput) => api.createDraft(input),
    onSuccess: (draft) => {
      queryClient.setQueryData(queryKeys.draft(draft.id), draft);
      void queryClient.invalidateQueries({ queryKey: queryKeys.drafts });
    },
  });
}

export function useUpdateDraft() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: { id: string; title?: string; content?: string }) => api.updateDraft(id, data),
    onSuccess: (draft) => {
      queryClient.setQueryData(queryKeys.draft(draft.id), draft);
      void queryClient.invalidateQueries({ queryKey: queryKeys.drafts });
    },
  });
}

export function useDeleteDraft() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: api.deleteDraft,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.drafts }),
  });
}

export function useClients() {
  return useQuery({ queryKey: queryKeys.clients, queryFn: api.listClients });
}

export function useClient(id: string | undefined) {
  return useQuery({
    queryKey: queryKeys.client(id ?? ''),
    queryFn: () => api.getClient(id!),
    enabled: Boolean(id),
  });
}

export function useCreateClient() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: ClientFields) => api.createClient(data),
    onSuccess: (client) => {
      queryClient.setQueryData(queryKeys.client(client.id), client);
      void queryClient.invalidateQueries({ queryKey: queryKeys.clients });
    },
  });
}

export function useUpdateClient() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: { id: string } & Partial<ClientFields>) => api.updateClient(id, data),
    onSuccess: (client) => {
      queryClient.setQueryData(queryKeys.client(client.id), client);
      void queryClient.invalidateQueries({ queryKey: queryKeys.clients });
      // Drafts and expedientes show the name of their client.
      void queryClient.invalidateQueries({ queryKey: queryKeys.drafts });
      void queryClient.invalidateQueries({ queryKey: queryKeys.cases });
    },
  });
}

export function useDeleteClient() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: api.deleteClient,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.clients });
      void queryClient.invalidateQueries({ queryKey: queryKeys.drafts });
      void queryClient.invalidateQueries({ queryKey: queryKeys.cases });
    },
  });
}

/** Reads the notes of a first meeting and proposes a client file; saves nothing. */
export function useAnalyzeNotes() {
  return useMutation({ mutationFn: api.analyzeNotes });
}

export function useCases(filters: { status?: CaseStatus; clientId?: string } = {}) {
  return useQuery({ queryKey: queryKeys.caseList(filters), queryFn: () => api.listCases(filters) });
}

export function useCase(id: string | undefined) {
  return useQuery({
    queryKey: queryKeys.case(id ?? ''),
    queryFn: () => api.getCase(id!),
    enabled: Boolean(id),
  });
}

/** The actuaciones and the deadlines of an expediente, oldest first. */
export function useCaseTimeline(id: string | undefined) {
  return useQuery({
    queryKey: queryKeys.caseTimeline(id ?? ''),
    queryFn: () => api.getCaseTimeline(id!),
    enabled: Boolean(id),
  });
}

export function useCreateCase() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CaseInput) => api.createCase(data),
    onSuccess: (created) => {
      queryClient.setQueryData(queryKeys.case(created.id), created);
      void queryClient.invalidateQueries({ queryKey: queryKeys.cases });
    },
  });
}

export function useUpdateCase() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: { id: string } & Partial<CaseInput>) => api.updateCase(id, data),
    onSuccess: (updated) => {
      queryClient.setQueryData(queryKeys.case(updated.id), updated);
      void queryClient.invalidateQueries({ queryKey: queryKeys.cases });
      // Deadlines show the title of their expediente.
      void queryClient.invalidateQueries({ queryKey: queryKeys.deadlines });
    },
  });
}

export function useDeleteCase() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: api.deleteCase,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.cases });
      // Its deadlines stay, without the link.
      void queryClient.invalidateQueries({ queryKey: queryKeys.deadlines });
    },
  });
}

/** Every change to the actuaciones of an expediente refreshes its timeline and the summaries. */
function useRefreshCases() {
  const queryClient = useQueryClient();
  return () => void queryClient.invalidateQueries({ queryKey: queryKeys.cases });
}

export function useAddProceedings() {
  const refresh = useRefreshCases();
  return useMutation({
    mutationFn: ({ caseId, items }: { caseId: string; items: ProceedingInput[] }) => api.addProceedings(caseId, items),
    onSuccess: refresh,
  });
}

export function useUpdateProceeding() {
  const refresh = useRefreshCases();
  return useMutation({
    mutationFn: ({ caseId, id, ...data }: { caseId: string; id: string } & Partial<ProceedingInput>) =>
      api.updateProceeding(caseId, id, data),
    onSuccess: refresh,
  });
}

export function useDeleteProceeding() {
  const refresh = useRefreshCases();
  return useMutation({
    mutationFn: ({ caseId, id }: { caseId: string; id: string }) => api.deleteProceeding(caseId, id),
    onSuccess: refresh,
  });
}

/** Reads a text or a file and proposes the actuaciones in it; saves nothing. */
export function useAnalyzeProceedings() {
  return useMutation({
    mutationFn: ({ caseId, source }: { caseId: string; source: { text: string } | { file: File } }) =>
      api.analyzeProceedings(caseId, source),
  });
}

export function useContradictions(caseId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.contradictions(caseId ?? ''),
    queryFn: () => api.listContradictions(caseId!),
    enabled: Boolean(caseId),
  });
}

/** Compares the chosen documents of an expediente and proposes the contradictions; saves nothing. */
export function useAnalyzeContradictions() {
  return useMutation({
    mutationFn: ({ caseId, documentIds, focus }: { caseId: string; documentIds: string[]; focus: string }) =>
      api.analyzeContradictions(caseId, { documentIds, focus }),
  });
}

export function useSaveContradictions() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ caseId, items }: { caseId: string; items: FindingInput[] }) => api.saveContradictions(caseId, items),
    onSuccess: (_saved, { caseId }) => queryClient.invalidateQueries({ queryKey: queryKeys.contradictions(caseId) }),
  });
}

export function useUpdateContradictionNote() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ caseId, id, note }: { caseId: string; id: string; note: string }) => api.updateContradictionNote(caseId, id, note),
    onSuccess: (_updated, { caseId }) => queryClient.invalidateQueries({ queryKey: queryKeys.contradictions(caseId) }),
  });
}

export function useDeleteContradiction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ caseId, id }: { caseId: string; id: string }) => api.deleteContradiction(caseId, id),
    onSuccess: (_deleted, { caseId }) => queryClient.invalidateQueries({ queryKey: queryKeys.contradictions(caseId) }),
  });
}

export function useDeadlines(filters: { status?: DeadlineStatus; clientId?: string } = {}) {
  return useQuery({ queryKey: queryKeys.deadlineList(filters), queryFn: () => api.listDeadlines(filters) });
}

export function useDeadline(id: string | undefined) {
  return useQuery({
    queryKey: queryKeys.deadline(id ?? ''),
    queryFn: () => api.getDeadline(id!),
    enabled: Boolean(id),
  });
}

/** Saving, completing or deleting a deadline also changes the warnings about it. */
function useRefreshDeadlines() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.deadlines });
    void queryClient.invalidateQueries({ queryKey: queryKeys.notifications });
    // The timeline and the summary of an expediente include its deadlines.
    void queryClient.invalidateQueries({ queryKey: queryKeys.cases });
  };
}

export function useCreateDeadlines() {
  const refresh = useRefreshDeadlines();
  return useMutation({ mutationFn: (items: DeadlineInput[]) => api.createDeadlines(items), onSuccess: refresh });
}

export function useUpdateDeadline() {
  const refresh = useRefreshDeadlines();
  return useMutation({
    mutationFn: ({ id, ...data }: { id: string } & Partial<DeadlineInput> & { status?: DeadlineStatus }) =>
      api.updateDeadline(id, data),
    onSuccess: refresh,
  });
}

export function useDeleteDeadline() {
  const refresh = useRefreshDeadlines();
  return useMutation({ mutationFn: api.deleteDeadline, onSuccess: refresh });
}

/** The due date a term would have: the editor shows it as the lawyer types (null while the term is incomplete). */
export function useDueDate(term: Pick<DeadlineInput, 'notificationDate' | 'days' | 'dayType'> | null) {
  return useQuery({
    queryKey: term ? queryKeys.dueDate(term) : ['deadlines', 'due-date', 'none'],
    queryFn: () => api.calculateDueDate(term!),
    enabled: term !== null,
    placeholderData: keepPreviousData,
    // The days left change with the date, not with the term.
    staleTime: 60_000,
  });
}

/** Reads a cédula or resolution and proposes its terms; saves nothing. */
export function useAnalyzeDeadlineDocument() {
  return useMutation({ mutationFn: api.analyzeDeadlineDocument });
}

export function useCalendar(year: number) {
  return useQuery({ queryKey: queryKeys.calendar(year), queryFn: () => api.getCalendar(year) });
}

/** The lawyer's non-working days move the due date of pending deadlines. */
function useRefreshCalendar() {
  const queryClient = useQueryClient();
  const refreshDeadlines = useRefreshDeadlines();
  return () => {
    void queryClient.invalidateQueries({ queryKey: ['calendar'] });
    refreshDeadlines();
  };
}

export function useAddNonWorkingDay() {
  const refresh = useRefreshCalendar();
  return useMutation({ mutationFn: api.addNonWorkingDay, onSuccess: refresh });
}

export function useDeleteNonWorkingDay() {
  const refresh = useRefreshCalendar();
  return useMutation({ mutationFn: api.deleteNonWorkingDay, onSuccess: refresh });
}

/** Unread warnings; checked every minute so a deadline that becomes urgent shows up while the page is open. */
export function useNotifications() {
  return useQuery({
    queryKey: queryKeys.notifications,
    queryFn: api.listNotifications,
    refetchInterval: 60_000,
    retry: false,
  });
}

export function useMarkNotificationRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: api.markNotificationRead,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.notifications }),
  });
}

export function useMarkAllNotificationsRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: api.markAllNotificationsRead,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.notifications }),
  });
}

// ── Normativa ───────────────────────────────────────────────────────────────

/** Where the watch is: followed closely while it is checking the bulletin, calmly otherwise. */
export function useNormativeStatus() {
  return useQuery({
    queryKey: queryKeys.normativeStatus,
    queryFn: api.normativeStatus,
    refetchInterval: (query) => (query.state.data?.running ? 2_000 : 60_000),
    retry: false,
  });
}

export function useRefreshNormative() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: api.refreshNormative,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.normativeStatus }),
  });
}

export function useNormativeAlerts(status: 'ACTIVE' | NormativeAlertStatus) {
  return useQuery({ queryKey: queryKeys.normativeAlerts(status), queryFn: () => api.listNormativeAlerts(status) });
}

/** Alerts not seen yet; the menu shows them as a red badge. */
export function useNormativeUnread() {
  return useQuery({ queryKey: queryKeys.normativeUnread, queryFn: api.normativeUnreadCount, refetchInterval: 60_000, retry: false });
}

export function useUpdateNormativeAlert() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: NormativeAlertStatus }) => api.updateNormativeAlert(id, status),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.normative }),
  });
}

export function useMarkAllNormativeSeen() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: api.markAllNormativeSeen,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.normative }),
  });
}

export function useNormativeItems(filters: { source?: string | undefined; date?: string | undefined; q?: string | undefined; category?: string | undefined }) {
  return useQuery({
    queryKey: queryKeys.normativeItems(filters),
    queryFn: () => api.listNormativeItems(filters),
    placeholderData: keepPreviousData,
  });
}

export function useNormativeTopics() {
  return useQuery({ queryKey: queryKeys.normativeTopics, queryFn: api.listNormativeTopics });
}

/** A topic that changes also changes what is checked: everything normative is refreshed. */
function useRefreshNormativeData() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: queryKeys.normative });
}

export function useCreateNormativeTopic() {
  const refresh = useRefreshNormativeData();
  return useMutation({ mutationFn: api.createNormativeTopic, onSuccess: refresh });
}

export function useUpdateNormativeTopic() {
  const refresh = useRefreshNormativeData();
  return useMutation({
    mutationFn: ({ id, ...data }: { id: string; name?: string; keywords?: string[]; description?: string; active?: boolean }) =>
      api.updateNormativeTopic(id, data),
    onSuccess: refresh,
  });
}

export function useDeleteNormativeTopic() {
  const refresh = useRefreshNormativeData();
  return useMutation({ mutationFn: api.deleteNormativeTopic, onSuccess: refresh });
}

// ── Audiencia ───────────────────────────────────────────────────────────────

export function useHearings() {
  return useQuery({ queryKey: queryKeys.hearings, queryFn: api.listHearings });
}

export function useHearing(id: string | undefined) {
  return useQuery({ queryKey: queryKeys.hearing(id ?? ''), queryFn: () => api.getHearing(id ?? ''), enabled: Boolean(id) });
}

export function useCreateHearing() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: api.createHearing,
    onSuccess: (hearing) => {
      queryClient.setQueryData(queryKeys.hearing(hearing.id), hearing);
      void queryClient.invalidateQueries({ queryKey: queryKeys.hearings, exact: true });
    },
  });
}

/**
 * What changes one practice (an answer, a retry, the end) gives the whole practice back: it replaces what the
 * screen has. The answer of the lawyer is saved before the model is asked, so after a failure the screen reads
 * what was saved.
 */
function useHearingChange(id: string, mutationFn: () => Promise<Awaited<ReturnType<typeof api.getHearing>>>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: (hearing) => {
      queryClient.setQueryData(queryKeys.hearing(id), hearing);
      void queryClient.invalidateQueries({ queryKey: queryKeys.hearings, exact: true });
    },
    onError: () => queryClient.invalidateQueries({ queryKey: queryKeys.hearing(id), exact: true }),
  });
}

export function useSendHearingTurn(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (content: string) => api.sendHearingTurn(id, content),
    onSuccess: (hearing) => {
      queryClient.setQueryData(queryKeys.hearing(id), hearing);
      void queryClient.invalidateQueries({ queryKey: queryKeys.hearings, exact: true });
    },
    onError: () => queryClient.invalidateQueries({ queryKey: queryKeys.hearing(id), exact: true }),
  });
}

export function useReplyHearing(id: string) {
  return useHearingChange(id, () => api.replyHearing(id));
}

export function useFinishHearing(id: string) {
  return useHearingChange(id, () => api.finishHearing(id));
}

export function useDeleteHearing() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: api.deleteHearing,
    onSuccess: (_data, id) => {
      queryClient.removeQueries({ queryKey: queryKeys.hearing(id), exact: true });
      void queryClient.invalidateQueries({ queryKey: queryKeys.hearings, exact: true });
    },
  });
}

export function useEstimates() {
  return useQuery({ queryKey: queryKeys.estimates, queryFn: api.listEstimates });
}

export function useEstimate(id: string | undefined) {
  return useQuery({ queryKey: queryKeys.estimate(id ?? ''), queryFn: () => api.getEstimate(id ?? ''), enabled: Boolean(id) });
}

export function useAnalyzeEstimate() {
  return useMutation({ mutationFn: api.analyzeEstimate });
}

export function useSaveEstimate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: api.saveEstimate,
    onSuccess: (estimate) => {
      queryClient.setQueryData(queryKeys.estimate(estimate.id), estimate);
      void queryClient.invalidateQueries({ queryKey: queryKeys.estimates, exact: true });
    },
  });
}

export function useUpdateEstimateNote(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (note: string) => api.updateEstimateNote(id, note),
    onSuccess: (estimate) => {
      queryClient.setQueryData(queryKeys.estimate(id), estimate);
      void queryClient.invalidateQueries({ queryKey: queryKeys.estimates, exact: true });
    },
  });
}

export function useDeleteEstimate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: api.deleteEstimate,
    onSuccess: (_data, id) => {
      queryClient.removeQueries({ queryKey: queryKeys.estimate(id), exact: true });
      void queryClient.invalidateQueries({ queryKey: queryKeys.estimates, exact: true });
    },
  });
}

/** Whether the lawyer has to log in and whether she already did. */
export function useAuth() {
  return useQuery({ queryKey: queryKeys.auth, queryFn: api.authState, retry: false, refetchOnWindowFocus: false, refetchInterval: (query) => (query.state.status === 'error' ? 10_000 : false) });
}

export function useLogin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: api.login,
    onSuccess: (state) => {
      // Whatever failed with 401 before the login is asked again.
      queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== 'auth' });
      queryClient.setQueryData(queryKeys.auth, state);
    },
  });
}

export function useLogout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: api.logout,
    onSettled: () => {
      // Nothing of the lawyer's stays in the memory of the page.
      queryClient.setQueryData(queryKeys.auth, (old: object | undefined) => ({ totpRequired: false, ...old, authRequired: true, authenticated: false, username: null, security: undefined }));
      queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== 'auth' });
    },
  });
}

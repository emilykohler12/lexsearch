import type {
  AuthState,
  Estimate,
  EstimateAnalyzeInput,
  EstimateProposal,
  EstimateSaveInput,
  EstimateSummary,
  AppNotification,
  AskResult,
  CalendarOverview,
  Case,
  CaseInput,
  CaseStatus,
  CaseSummary,
  CaseTimeline,
  Client,
  ClientFields,
  ClientProposal,
  ClientSummary,
  Contradiction,
  ContradictionProposal,
  CreateDraftInput,
  Deadline,
  DeadlineInput,
  DeadlineProposal,
  DeadlineStatus,
  DocumentCategory,
  DueDateCalculation,
  Draft,
  DraftSummary,
  FindingInput,
  Health,
  InteractionDetail,
  InteractionSummary,
  LibraryDocument,
  NormativeAlert,
  NormativeAlertStatus,
  NormativeEdition,
  NormativeStatus,
  NormativeTopic,
  NormativeTopicInput,
  Hearing,
  HearingInput,
  HearingSummary,
  ProceedingInput,
  SearchFilters,
  SearchHit,
  TimelineProposal,
  UploadResult,
} from './types';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** The system is unreachable. The banner of the menu already says so: a screen doesn't repeat it (see Alert). */
export const NETWORK_ERROR_MESSAGE = 'Sistema caído: no hay conexión con el servidor. Probá de nuevo en unos minutos.';

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const isJson = typeof init.body === 'string';
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      ...init,
      headers: { ...(isJson ? { 'Content-Type': 'application/json' } : {}), ...init.headers },
    });
  } catch {
    throw new ApiError(0, 'NETWORK', NETWORK_ERROR_MESSAGE);
  }

  if (response.status === 204) return undefined as T;
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = (body as { error?: { code?: string; message?: string } } | null)?.error;
    // The server (or the proxy in front of it) is not answering: nginx and the dev server say 502, 503 or 504 with no body of ours.
    if (!error && [502, 503, 504].includes(response.status)) throw new ApiError(response.status, 'NETWORK', NETWORK_ERROR_MESSAGE);
    throw new ApiError(
      response.status,
      error?.code ?? 'HTTP_ERROR',
      error?.message ?? `El servidor respondió con un error (${response.status}).`,
    );
  }
  return body as T;
}

const json = (data: unknown) => JSON.stringify(data);

export const api = {
  async health(): Promise<Health> {
    // 503 still carries the status body (e.g. database down), so read it either way.
    const response = await fetch('/api/health').catch(() => null);
    if (!response) throw new ApiError(0, 'NETWORK', NETWORK_ERROR_MESSAGE);
    const health = (await response.json().catch(() => null)) as Health | null;
    // Anything else (a "too many requests" answer, say) is not the status of the system.
    if (!health?.embeddings) throw new ApiError(response.status, 'NETWORK', NETWORK_ERROR_MESSAGE);
    return health;
  },

  listDocuments: (filters: { caseId?: string } = {}) =>
    request<{ documents: LibraryDocument[] }>(`/documents${filters.caseId ? `?caseId=${filters.caseId}` : ''}`).then((r) => r.documents),

  uploadDocuments(files: File[], category: DocumentCategory, caseId?: string) {
    const form = new FormData();
    for (const file of files) form.append('files', file);
    form.append('category', category);
    if (caseId) form.append('caseId', caseId);
    return request<{ results: UploadResult[] }>('/documents', { method: 'POST', body: form }).then((r) => r.results);
  },

  /** A document typed or pasted in instead of uploaded. */
  createTextDocument: (data: { title: string; text: string; category: DocumentCategory; caseId?: string }) =>
    request<{ result: UploadResult }>('/documents/text', { method: 'POST', body: json(data) }).then((r) => r.result),

  /** `caseId` links the document to an expediente; null takes it back to the general library. */
  updateDocument: (id: string, data: { title?: string; category?: DocumentCategory; caseId?: string | null }) =>
    request<{ document: LibraryDocument }>(`/documents/${id}`, { method: 'PATCH', body: json(data) }).then(
      (r) => r.document,
    ),

  deleteDocument: (id: string) => request<void>(`/documents/${id}`, { method: 'DELETE' }),

  reprocessDocument: (id: string) =>
    request<{ document: LibraryDocument }>(`/documents/${id}/reprocess`, { method: 'POST' }).then((r) => r.document),

  documentFileUrl: (id: string, page?: number | null) => `/api/documents/${id}/file${page ? `#page=${page}` : ''}`,

  search: (query: string, filters: SearchFilters) =>
    request<{ results: SearchHit[] }>('/rag/search', { method: 'POST', body: json({ query, ...filters }) }).then(
      (r) => r.results,
    ),

  ask: (question: string, filters: SearchFilters) =>
    request<AskResult>('/rag/ask', { method: 'POST', body: json({ question, ...filters }) }),

  listInteractions: () =>
    request<{ interactions: InteractionSummary[] }>('/interactions?module=rag-qa&limit=50').then((r) => r.interactions),

  getInteraction: (id: string) =>
    request<{ interaction: InteractionDetail }>(`/interactions/${id}`).then((r) => r.interaction),

  listDrafts: (clientId?: string) =>
    request<{ drafts: DraftSummary[] }>(`/drafts${clientId ? `?clientId=${clientId}` : ''}`).then((r) => r.drafts),

  getDraft: (id: string) => request<{ draft: Draft }>(`/drafts/${id}`).then((r) => r.draft),

  createDraft: (input: CreateDraftInput) =>
    request<{ draft: Draft }>('/drafts', { method: 'POST', body: json(input) }).then((r) => r.draft),

  updateDraft: (id: string, data: { title?: string; content?: string }) =>
    request<{ draft: Draft }>(`/drafts/${id}`, { method: 'PATCH', body: json(data) }).then((r) => r.draft),

  deleteDraft: (id: string) => request<void>(`/drafts/${id}`, { method: 'DELETE' }),

  draftDocxUrl: (id: string) => `/api/drafts/${id}/docx`,

  listClients: () => request<{ clients: ClientSummary[] }>('/clients').then((r) => r.clients),

  getClient: (id: string) => request<{ client: Client }>(`/clients/${id}`).then((r) => r.client),

  createClient: (data: ClientFields) =>
    request<{ client: Client }>('/clients', { method: 'POST', body: json(data) }).then((r) => r.client),

  updateClient: (id: string, data: Partial<ClientFields>) =>
    request<{ client: Client }>(`/clients/${id}`, { method: 'PATCH', body: json(data) }).then((r) => r.client),

  deleteClient: (id: string) => request<void>(`/clients/${id}`, { method: 'DELETE' }),

  analyzeNotes: (notes: string) =>
    request<{ proposal: ClientProposal }>('/clients/analyze-notes', { method: 'POST', body: json({ notes }) }).then(
      (r) => r.proposal,
    ),

  listCases: (filters: { status?: CaseStatus; clientId?: string } = {}) => {
    const query = new URLSearchParams(Object.entries(filters).filter(([, value]) => value)).toString();
    return request<{ cases: CaseSummary[] }>(`/cases${query ? `?${query}` : ''}`).then((r) => r.cases);
  },

  getCase: (id: string) => request<{ case: Case }>(`/cases/${id}`).then((r) => r.case),

  createCase: (data: CaseInput) => request<{ case: Case }>('/cases', { method: 'POST', body: json(data) }).then((r) => r.case),

  updateCase: (id: string, data: Partial<CaseInput>) =>
    request<{ case: Case }>(`/cases/${id}`, { method: 'PATCH', body: json(data) }).then((r) => r.case),

  deleteCase: (id: string) => request<void>(`/cases/${id}`, { method: 'DELETE' }),

  getCaseTimeline: (id: string) => request<CaseTimeline>(`/cases/${id}/timeline`),

  /** The actuaciones of one reading (or a single one) are saved together: all of them or none. */
  addProceedings: (caseId: string, items: ProceedingInput[]) =>
    request<void>(`/cases/${caseId}/proceedings/batch`, { method: 'POST', body: json({ items }) }),

  updateProceeding: (caseId: string, id: string, data: Partial<ProceedingInput>) =>
    request<void>(`/cases/${caseId}/proceedings/${id}`, { method: 'PATCH', body: json(data) }),

  deleteProceeding: (caseId: string, id: string) =>
    request<void>(`/cases/${caseId}/proceedings/${id}`, { method: 'DELETE' }),

  /** Reads a text (pasted, or a file: PDF, photo, Word) and proposes its actuaciones; saves nothing. */
  analyzeProceedings(caseId: string, source: { text: string } | { file: File }) {
    if ('file' in source) {
      const form = new FormData();
      form.append('file', source.file);
      return request<{ proposal: TimelineProposal }>(`/cases/${caseId}/proceedings/analyze`, { method: 'POST', body: form }).then(
        (r) => r.proposal,
      );
    }
    return request<{ proposal: TimelineProposal }>(`/cases/${caseId}/proceedings/analyze`, {
      method: 'POST',
      body: json({ text: source.text }),
    }).then((r) => r.proposal);
  },

  listContradictions: (caseId: string) =>
    request<{ contradictions: Contradiction[] }>(`/cases/${caseId}/contradictions`).then((r) => r.contradictions),

  /** Compares the chosen documents of the expediente and proposes the contradictions; saves nothing. */
  analyzeContradictions: (caseId: string, input: { documentIds: string[]; focus: string }) =>
    request<{ proposal: ContradictionProposal }>(`/cases/${caseId}/contradictions/analyze`, {
      method: 'POST',
      body: json(input),
    }).then((r) => r.proposal),

  /** The findings of one comparison are saved together: all of them or none. */
  saveContradictions: (caseId: string, items: FindingInput[]) =>
    request<{ contradictions: Contradiction[] }>(`/cases/${caseId}/contradictions`, { method: 'POST', body: json({ items }) }).then(
      (r) => r.contradictions,
    ),

  updateContradictionNote: (caseId: string, id: string, note: string) =>
    request<{ contradiction: Contradiction }>(`/cases/${caseId}/contradictions/${id}`, { method: 'PATCH', body: json({ note }) }).then(
      (r) => r.contradiction,
    ),

  deleteContradiction: (caseId: string, id: string) => request<void>(`/cases/${caseId}/contradictions/${id}`, { method: 'DELETE' }),

  listDeadlines: (filters: { status?: DeadlineStatus; clientId?: string } = {}) => {
    const query = new URLSearchParams(Object.entries(filters).filter(([, value]) => value)).toString();
    return request<{ deadlines: Deadline[] }>(`/deadlines${query ? `?${query}` : ''}`).then((r) => r.deadlines);
  },

  getDeadline: (id: string) => request<{ deadline: Deadline }>(`/deadlines/${id}`).then((r) => r.deadline),

  /** The terms of one document are saved together: all of them or none. */
  createDeadlines: (items: DeadlineInput[]) =>
    request<{ deadlines: Deadline[] }>('/deadlines/batch', { method: 'POST', body: json({ items }) }).then(
      (r) => r.deadlines,
    ),

  updateDeadline: (id: string, data: Partial<DeadlineInput> & { status?: DeadlineStatus }) =>
    request<{ deadline: Deadline }>(`/deadlines/${id}`, { method: 'PATCH', body: json(data) }).then((r) => r.deadline),

  deleteDeadline: (id: string) => request<void>(`/deadlines/${id}`, { method: 'DELETE' }),

  calculateDueDate: (term: Pick<DeadlineInput, 'notificationDate' | 'days' | 'dayType'>) =>
    request<DueDateCalculation>('/deadlines/calculate', { method: 'POST', body: json(term) }),

  analyzeDeadlineDocument(file: File) {
    const form = new FormData();
    form.append('file', file);
    return request<{ proposal: DeadlineProposal }>('/deadlines/analyze', { method: 'POST', body: form }).then(
      (r) => r.proposal,
    );
  },

  getCalendar: (year: number) => request<CalendarOverview>(`/calendar?year=${year}`),

  addNonWorkingDay: (data: { startDate: string; endDate?: string; label: string }) =>
    request<void>('/calendar/non-working-days', { method: 'POST', body: json(data) }),

  deleteNonWorkingDay: (id: string) => request<void>(`/calendar/non-working-days/${id}`, { method: 'DELETE' }),

  listNotifications: () =>
    request<{ notifications: AppNotification[] }>('/notifications').then((r) => r.notifications),

  markNotificationRead: (id: string) => request<void>(`/notifications/${id}/read`, { method: 'POST' }),

  markAllNotificationsRead: () => request<void>('/notifications/read-all', { method: 'POST' }),

  // Normativa: el vigía de los boletines oficiales (Nación y Misiones)
  normativeStatus: () => request<NormativeStatus>('/normativa/status'),

  refreshNormative: () => request<{ running: boolean }>('/normativa/refresh', { method: 'POST' }),

  listNormativeAlerts: (status: 'ACTIVE' | NormativeAlertStatus) =>
    request<{ alerts: NormativeAlert[] }>(`/normativa/alerts?status=${status}`).then((r) => r.alerts),

  normativeUnreadCount: () => request<{ count: number }>('/normativa/alerts/unread-count').then((r) => r.count),

  updateNormativeAlert: (id: string, status: NormativeAlertStatus) =>
    request<{ alert: NormativeAlert }>(`/normativa/alerts/${id}`, { method: 'PATCH', body: json({ status }) }).then((r) => r.alert),

  markAllNormativeSeen: () => request<void>('/normativa/alerts/read-all', { method: 'POST' }),

  listNormativeItems: (filters: { source?: string | undefined; date?: string | undefined; q?: string | undefined; category?: string | undefined }) => {
    const params = new URLSearchParams();
    if (filters.source) params.set('source', filters.source);
    if (filters.date) params.set('date', filters.date);
    if (filters.q) params.set('q', filters.q);
    if (filters.category) params.set('category', filters.category);
    const query = params.toString();
    return request<NormativeEdition>(`/normativa/items${query ? `?${query}` : ''}`);
  },

  listNormativeTopics: () => request<{ topics: NormativeTopic[] }>('/normativa/topics').then((r) => r.topics),

  createNormativeTopic: (data: NormativeTopicInput) =>
    request<{ topic: NormativeTopic }>('/normativa/topics', { method: 'POST', body: json(data) }).then((r) => r.topic),

  updateNormativeTopic: (id: string, data: { name?: string; keywords?: string[]; description?: string; active?: boolean }) =>
    request<{ topic: NormativeTopic }>(`/normativa/topics/${id}`, { method: 'PATCH', body: json(data) }).then((r) => r.topic),

  deleteNormativeTopic: (id: string) => request<void>(`/normativa/topics/${id}`, { method: 'DELETE' }),

  // Audiencia: el simulador (la IA hace de juez o de abogado de la contraparte)
  listHearings: () => request<{ hearings: HearingSummary[] }>('/hearings').then((r) => r.hearings),

  getHearing: (id: string) => request<{ hearing: Hearing }>(`/hearings/${id}`).then((r) => r.hearing),

  createHearing: (data: HearingInput) => request<{ hearing: Hearing }>('/hearings', { method: 'POST', body: json(data) }).then((r) => r.hearing),

  sendHearingTurn: (id: string, content: string) =>
    request<{ hearing: Hearing }>(`/hearings/${id}/turns`, { method: 'POST', body: json({ content }) }).then((r) => r.hearing),

  replyHearing: (id: string) => request<{ hearing: Hearing }>(`/hearings/${id}/reply`, { method: 'POST' }).then((r) => r.hearing),

  finishHearing: (id: string) => request<{ hearing: Hearing }>(`/hearings/${id}/finish`, { method: 'POST' }).then((r) => r.hearing),

  deleteHearing: (id: string) => request<void>(`/hearings/${id}`, { method: 'DELETE' }),

  // Acceso
  authState: () => request<AuthState>('/auth/me'),

  login: (data: { username: string; password: string; code?: string }) => request<AuthState>('/auth/login', { method: 'POST', body: json(data) }),

  logout: () => request<void>('/auth/logout', { method: 'POST' }),

  // Estimador de antecedentes
  listEstimates: () => request<{ estimates: EstimateSummary[] }>('/estimates').then((r) => r.estimates),

  getEstimate: (id: string) => request<{ estimate: Estimate }>(`/estimates/${id}`).then((r) => r.estimate),

  analyzeEstimate: (data: EstimateAnalyzeInput) =>
    request<{ proposal: EstimateProposal }>('/estimates/analyze', { method: 'POST', body: json(data) }).then((r) => r.proposal),

  saveEstimate: (data: EstimateSaveInput) => request<{ estimate: Estimate }>('/estimates', { method: 'POST', body: json(data) }).then((r) => r.estimate),

  updateEstimateNote: (id: string, note: string) =>
    request<{ estimate: Estimate }>(`/estimates/${id}`, { method: 'PATCH', body: json({ note }) }).then((r) => r.estimate),

  deleteEstimate: (id: string) => request<void>(`/estimates/${id}`, { method: 'DELETE' }),
};

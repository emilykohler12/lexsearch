import type {
  AskResult,
  Client,
  ClientFields,
  ClientProposal,
  ClientSummary,
  CreateDraftInput,
  DocumentCategory,
  Draft,
  DraftSummary,
  Health,
  InteractionDetail,
  InteractionSummary,
  LibraryDocument,
  SearchFilters,
  SearchHit,
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

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const isJson = typeof init.body === 'string';
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      ...init,
      headers: { ...(isJson ? { 'Content-Type': 'application/json' } : {}), ...init.headers },
    });
  } catch {
    throw new ApiError(0, 'NETWORK', 'No se pudo conectar con el servidor de LexSearch. ¿Está corriendo `npm run dev`?');
  }

  if (response.status === 204) return undefined as T;
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = (body as { error?: { code?: string; message?: string } } | null)?.error;
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
    if (!response) throw new ApiError(0, 'NETWORK', 'Servidor no disponible');
    return (await response.json()) as Health;
  },

  listDocuments: () => request<{ documents: LibraryDocument[] }>('/documents').then((r) => r.documents),

  uploadDocuments(files: File[], category: DocumentCategory) {
    const form = new FormData();
    for (const file of files) form.append('files', file);
    form.append('category', category);
    return request<{ results: UploadResult[] }>('/documents', { method: 'POST', body: form }).then((r) => r.results);
  },

  updateDocument: (id: string, data: { title?: string; category?: DocumentCategory }) =>
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
};

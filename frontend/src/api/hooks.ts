import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client';
import type { ClientFields, CreateDraftInput, DocumentCategory, SearchFilters } from './types';

export const queryKeys = {
  health: ['health'] as const,
  documents: ['documents'] as const,
  interactions: ['interactions'] as const,
  interaction: (id: string) => ['interactions', id] as const,
  // Lists share a prefix, so invalidating `drafts` also refreshes the ones filtered by client.
  drafts: ['drafts', 'list'] as const,
  draftsByClient: (clientId: string) => ['drafts', 'list', { clientId }] as const,
  draft: (id: string) => ['drafts', 'detail', id] as const,
  clients: ['clients', 'list'] as const,
  client: (id: string) => ['clients', 'detail', id] as const,
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

export function useDocuments() {
  return useQuery({
    queryKey: queryKeys.documents,
    queryFn: api.listDocuments,
    // While something is being indexed, refresh often to show progress.
    refetchInterval: (query) =>
      query.state.data?.some((d) => d.status === 'PENDING' || d.status === 'PROCESSING') ? 2_000 : false,
  });
}

export function useUploadDocuments() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ files, category }: { files: File[]; category: DocumentCategory }) =>
      api.uploadDocuments(files, category),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.documents }),
  });
}

export function useUpdateDocument() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: { id: string; title?: string; category?: DocumentCategory }) =>
      api.updateDocument(id, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.documents }),
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
      // Drafts show the name of their client.
      void queryClient.invalidateQueries({ queryKey: queryKeys.drafts });
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
    },
  });
}

/** Reads the notes of a first meeting and proposes a client file; saves nothing. */
export function useAnalyzeNotes() {
  return useMutation({ mutationFn: api.analyzeNotes });
}

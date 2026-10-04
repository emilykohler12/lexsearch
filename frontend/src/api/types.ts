// Shapes returned by the LexSearch API (see backend/src/**/*.schemas.ts and /api/docs).

export type DocumentCategory = 'LEGISLACION' | 'JURISPRUDENCIA' | 'DOCTRINA' | 'MODELO' | 'ESCRITO' | 'OTRO';
export type DocumentStatus = 'PENDING' | 'PROCESSING' | 'READY' | 'FAILED';

export interface LibraryDocument {
  id: string;
  title: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  category: DocumentCategory;
  status: DocumentStatus;
  errorMessage: string | null;
  pageCount: number | null;
  chunkCount: number;
  charCount: number | null;
  /** Pages read with OCR (scans and photos); their text may contain reading errors. */
  ocrPageCount: number;
  processedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type UploadResult =
  | { status: 'created' | 'duplicate'; originalName: string; document: LibraryDocument }
  | { status: 'rejected'; originalName: string; message: string };

export interface SearchFilters {
  categories?: DocumentCategory[];
  documentIds?: string[];
}

export interface SearchHit {
  chunkId: string;
  documentId: string;
  documentTitle: string;
  category: DocumentCategory;
  originalName: string;
  ordinal: number;
  pageStart: number | null;
  pageEnd: number | null;
  content: string;
  score: number;
  matchedBy: Array<'semantic' | 'keyword'>;
  similarity: number | null;
}

export interface AnswerCitation {
  sourceNumber: number;
  citedText: string;
  startChar: number | null;
  endChar: number | null;
}

export interface AnswerBlock {
  text: string;
  citations: AnswerCitation[];
}

export type AnswerSource = Pick<
  SearchHit,
  'chunkId' | 'documentId' | 'documentTitle' | 'category' | 'originalName' | 'pageStart' | 'pageEnd' | 'content' | 'matchedBy'
> & { number: number };

export interface AskResult {
  interactionId: string;
  question: string;
  blocks: AnswerBlock[];
  sources: AnswerSource[];
  model: string;
  usage: { inputTokens: number; outputTokens: number };
  durationMs: number;
  createdAt: string;
}

export interface Health {
  status: 'ok' | 'degraded';
  database: 'ok' | 'error';
  embeddings: { model: string; status: 'idle' | 'loading' | 'ready' | 'error' };
  llm: { configured: true; provider: string; model: string } | { configured: false };
}

export interface InteractionSummary {
  id: string;
  module: string;
  question: string | null;
  status: 'SUCCESS' | 'FAILED';
  model: string | null;
  durationMs: number | null;
  createdAt: string;
}

export interface InteractionDetail extends Omit<InteractionSummary, 'question'> {
  input: { question?: string; categories?: DocumentCategory[] };
  output: { blocks: AnswerBlock[]; sources: AnswerSource[] } | null;
  promptVersion: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  errorMessage: string | null;
}

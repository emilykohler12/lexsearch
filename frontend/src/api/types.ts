// Shapes returned by the LexSearch API (see backend/src/**/*.schemas.ts and /api/docs).

export type DocumentCategory = 'LEGISLACION' | 'JURISPRUDENCIA' | 'DOCTRINA' | 'MODELO' | 'ESCRITO' | 'PRUEBA' | 'OTRO';
export type DocumentStatus = 'PENDING' | 'PROCESSING' | 'READY' | 'FAILED';

export interface LibraryDocument {
  id: string;
  title: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  category: DocumentCategory;
  /** The expediente the document belongs to (a prueba, a escrito); null if it is in the general library. */
  caseId: string | null;
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

export type DraftType =
  | 'CARTA_DOCUMENTO'
  | 'CONTRATO'
  | 'DEMANDA'
  | 'CONTESTACION_DEMANDA'
  | 'ESCRITO_JUDICIAL'
  | 'NOTA'
  | 'OTRO';

/** Enough of a client to name it and link to its file. */
export interface ClientRef {
  id: string;
  fullName: string;
}

export interface DraftSummary {
  id: string;
  title: string;
  documentType: DraftType;
  client: ClientRef | null;
  createdAt: string;
  updatedAt: string;
}

/** Library material the drafting agent consulted. */
export interface DraftSource {
  kind: 'fragment' | 'document';
  documentId: string;
  documentTitle: string;
  chunkId?: string;
  pageStart?: number | null;
  pageEnd?: number | null;
  content?: string;
}

export interface Draft extends DraftSummary {
  instructions: string;
  caseDetails: string;
  templateDocumentId: string | null;
  content: string;
  sources: DraftSource[];
  model: string | null;
}

export interface CreateDraftInput {
  documentType: DraftType;
  title?: string;
  instructions: string;
  caseDetails: string;
  clientId?: string;
  templateDocumentId?: string;
  categories?: DocumentCategory[];
}

export type PracticeArea =
  | 'LABORAL'
  | 'CIVIL'
  | 'COMERCIAL'
  | 'FAMILIA'
  | 'SUCESIONES'
  | 'PENAL'
  | 'ADMINISTRATIVO'
  | 'PREVISIONAL'
  | 'CONSUMO'
  | 'OTRO';

export type PersonType = 'FISICA' | 'JURIDICA';

/** A document the client still has to bring (or has already brought, when done). */
export interface ChecklistItem {
  id: string;
  text: string;
  done: boolean;
}

export interface ClientSummary {
  id: string;
  fullName: string;
  personType: PersonType;
  documentNumber: string;
  practiceArea: PracticeArea | null;
  counterpartyName: string;
  pendingDocuments: number;
  totalDocuments: number;
  createdAt: string;
  updatedAt: string;
}

export interface Client {
  id: string;
  fullName: string;
  personType: PersonType;
  documentNumber: string;
  email: string;
  phone: string;
  address: string;
  counterpartyName: string;
  counterpartyDocument: string;
  counterpartyAddress: string;
  practiceArea: PracticeArea | null;
  conflictSummary: string;
  claim: string;
  checklist: ChecklistItem[];
  meetingNotes: string;
  createdAt: string;
  updatedAt: string;
}

/** The part of a client file the lawyer edits (what the API saves). */
export type ClientFields = Omit<Client, 'id' | 'createdAt' | 'updatedAt'>;

export type DayType = 'BUSINESS' | 'CALENDAR';
export type DeadlineStatus = 'PENDING' | 'DONE';
/** DONE: fulfilled; the others describe a pending deadline by how close its due date is. */
export type DeadlineState = 'DONE' | 'OVERDUE' | 'TODAY' | 'SOON' | 'ONGOING';

/** Enough of an expediente to name it and link to it. */
export interface CaseRef {
  id: string;
  title: string;
  number: string;
}

export interface Deadline {
  id: string;
  title: string;
  caseReference: string;
  notes: string;
  client: ClientRef | null;
  case: CaseRef | null;
  /** AAAA-MM-DD: the term starts the day after. */
  notificationDate: string;
  days: number;
  dayType: DayType;
  /** AAAA-MM-DD: the last day to act, calculated by the server. */
  dueDate: string;
  status: DeadlineStatus;
  completedAt: string | null;
  /** The sentence of the document that sets the term (when one was analyzed). */
  sourceQuote: string;
  /** Days until the due date in Argentina's calendar; negative when overdue. */
  daysLeft: number;
  state: DeadlineState;
  createdAt: string;
  updatedAt: string;
}

/** The part of a deadline the lawyer edits (what the API saves). */
export interface DeadlineInput {
  title: string;
  caseReference: string;
  notes: string;
  clientId: string | null;
  caseId: string | null;
  notificationDate: string;
  days: number;
  dayType: DayType;
  sourceQuote: string;
}

/** A day that did not count towards a term, with the reason. */
export interface SkippedDay {
  date: string;
  reason: string;
}

export interface DueDateCalculation {
  dueDate: string;
  skipped: SkippedDay[];
  daysLeft: number;
}

/** A term found in a cédula or resolution; days = 0 when the document doesn't say how many. */
export interface TermProposal {
  title: string;
  days: number;
  dayType: DayType;
  quote: string;
  /** False when the AI's quote isn't in the document: check the term by hand. */
  quoteVerified: boolean;
}

export interface DeadlineProposal {
  summary: string;
  documentDate: string;
  notificationDate: string;
  caseReference: string;
  terms: TermProposal[];
}

export interface Holiday {
  date: string;
  name: string;
}

export interface NonWorkingDay {
  id: string;
  startDate: string;
  endDate: string;
  label: string;
}

export interface CalendarOverview {
  year: number;
  holidays: Holiday[];
  customDays: NonWorkingDay[];
}

export interface AppNotification {
  id: string;
  kind: string;
  deadlineId: string | null;
  title: string;
  message: string;
  createdAt: string;
}

export type CaseStatus = 'ACTIVE' | 'PAUSED' | 'CLOSED';
export type ProceedingKind = 'ESCRITO' | 'RESOLUCION' | 'NOTIFICACION' | 'AUDIENCIA' | 'PRUEBA' | 'OTRO';

export interface CaseSummary {
  id: string;
  title: string;
  number: string;
  court: string;
  practiceArea: PracticeArea | null;
  status: CaseStatus;
  clients: ClientRef[];
  proceedingCount: number;
  /** AAAA-MM-DD of the latest actuación; null while there are none. */
  lastProceedingDate: string | null;
  pendingDeadlines: number;
  nextDeadline: { id: string; title: string; dueDate: string; daysLeft: number; state: DeadlineState } | null;
  createdAt: string;
  updatedAt: string;
}

export interface Case extends CaseSummary {
  notes: string;
}

/** The part of an expediente the lawyer edits (what the API saves). */
export interface CaseInput {
  title: string;
  number: string;
  court: string;
  practiceArea: PracticeArea | null;
  status: CaseStatus;
  notes: string;
  clientIds: string[];
}

/** An actuación as the lawyer enters it (or confirms it after the AI read it). */
export interface ProceedingInput {
  date: string;
  kind: ProceedingKind;
  title: string;
  description: string;
  documentId: string | null;
  sourceQuote: string;
  source: 'MANUAL' | 'AI';
}

export type ProceedingTimelineItem = {
  type: 'PROCEEDING';
  id: string;
  date: string;
  kind: ProceedingKind;
  title: string;
  description: string;
  source: 'MANUAL' | 'AI';
  sourceQuote: string;
  document: { id: string; title: string } | null;
};

export type DeadlineTimelineItem = {
  type: 'DEADLINE';
  id: string;
  /** The due date. */
  date: string;
  title: string;
  status: DeadlineStatus;
  state: DeadlineState;
  daysLeft: number;
  notificationDate: string;
  days: number;
  dayType: DayType;
};

/** Something that happened in the expediente, or the day one of its deadlines ends. */
export type TimelineItem = ProceedingTimelineItem | DeadlineTimelineItem;

export interface CaseTimeline {
  /** Today's date in Argentina (AAAA-MM-DD). */
  today: string;
  case: Case;
  items: TimelineItem[];
}

/** An actuación found in a text; nothing is saved until the lawyer confirms it. */
export interface ProceedingProposal {
  date: string;
  kind: ProceedingKind;
  title: string;
  description: string;
  quote: string;
  /** False when the AI's quote isn't in the text: check the actuación by hand. */
  quoteVerified: boolean;
  /** The expediente already has an actuación that day with the same title. */
  duplicate: boolean;
}

export interface TimelineProposal {
  caseInfo: { title: string; number: string; court: string };
  proceedings: ProceedingProposal[];
  /** Actuaciones the text mentions without a usable date: left out. */
  withoutDate: number;
  /** The text was too long: the middle part wasn't read. */
  textTruncated: boolean;
}

/** What the AI proposes from the notes of the first meeting; nothing is saved until the lawyer says so. */
export interface ClientProposal {
  fullName: string;
  personType: PersonType;
  documentNumber: string;
  email: string;
  phone: string;
  address: string;
  counterpartyName: string;
  counterpartyDocument: string;
  counterpartyAddress: string;
  practiceArea: PracticeArea | null;
  conflictSummary: string;
  claim: string;
  missingDocuments: string[];
}

export type FindingKind = 'FECHA' | 'MONTO' | 'DECLARACION' | 'OTRO';
/** DIRECTA: the statements can't both be true. POSIBLE: they might be reconciled; the lawyer has to look. */
export type FindingConfidence = 'DIRECTA' | 'POSIBLE';

/** One of the statements that clash: where it is and what it says. */
export interface FindingStatement {
  documentId: string;
  /** The title the document had when the finding was made. */
  documentTitle: string;
  /** The document's own wording; empty when the AI's quote wasn't found in it. */
  quote: string;
  quoteVerified: boolean;
}

/** A contradiction found by comparing documents; nothing is saved until the lawyer confirms it. */
export interface FindingProposal {
  kind: FindingKind;
  confidence: FindingConfidence;
  title: string;
  explanation: string;
  statements: FindingStatement[];
  /** At least two of the quotes were found in their documents. */
  verified: boolean;
  /** The expediente already has a confirmed finding about the same thing. */
  duplicate: boolean;
}

export interface ContradictionProposal {
  findings: FindingProposal[];
  documents: Array<{ id: string; title: string; chars: number; truncated: boolean }>;
}

/** What the API saves when the lawyer confirms a finding. */
export interface FindingInput {
  kind: FindingKind;
  confidence: FindingConfidence;
  title: string;
  explanation: string;
  statements: FindingStatement[];
  note: string;
}

/** A confirmed contradiction. */
export interface Contradiction {
  id: string;
  caseId: string;
  kind: FindingKind;
  confidence: FindingConfidence;
  title: string;
  explanation: string;
  note: string;
  statements: Array<FindingStatement & { document: { id: string; title: string } | null }>;
  createdAt: string;
  updatedAt: string;
}

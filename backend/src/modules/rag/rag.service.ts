import { AppError, ServiceUnavailableError } from '../../lib/errors.js';
import type { Logger } from '../../lib/logger.js';
import { CATEGORY_LABELS } from '../documents/documents.schemas.js';
import type { EmbeddingProvider } from '../embeddings/embedding-provider.js';
import type { InteractionsRepository } from '../interactions/interactions.repository.js';
import type { AnswerBlock, LlmProvider } from '../llm/llm-provider.js';
import { loadPrompt, PROMPT_VERSIONS } from '../llm/prompts.js';
import { reciprocalRankFusion } from './rank-fusion.js';
import type { ChunkHit, RagRepository } from './rag.repository.js';
import type { AskInput, SearchInput } from './rag.schemas.js';

export const RAG_MODULE = 'rag-qa';

/** Candidates fetched from each search before fusing. */
const CANDIDATES_PER_SEARCH = 30;
/** Fragments handed to the model to answer a question. */
const SOURCES_PER_ANSWER = 8;

export interface SearchHit {
  chunkId: string;
  documentId: string;
  documentTitle: string;
  category: ChunkHit['category'];
  originalName: string;
  ordinal: number;
  pageStart: number | null;
  pageEnd: number | null;
  content: string;
  score: number;
  /** Which searches found it: by meaning, by exact words, or both. */
  matchedBy: Array<'semantic' | 'keyword'>;
  similarity: number | null;
}

export interface AnswerSource extends SearchHit {
  number: number;
}

export interface AnswerCitationDto {
  sourceNumber: number;
  citedText: string;
  startChar: number | null;
  endChar: number | null;
}

export interface AskResult {
  interactionId: string;
  question: string;
  blocks: Array<{ text: string; citations: AnswerCitationDto[] }>;
  sources: AnswerSource[];
  model: string;
  usage: { inputTokens: number; outputTokens: number };
  durationMs: number;
  createdAt: Date;
}

interface RagServiceDeps {
  repository: RagRepository;
  embeddings: EmbeddingProvider;
  /** null when no API key is configured: search still works, answers don't. */
  llm: LlmProvider | null;
  interactions: InteractionsRepository;
  logger: Logger;
}

export class RagService {
  constructor(private readonly deps: RagServiceDeps) {}

  async search(input: SearchInput): Promise<SearchHit[]> {
    const { repository, embeddings } = this.deps;
    const filters = { categories: input.categories, documentIds: input.documentIds };

    const queryVector = await embeddings.embedQuery(input.query);
    const [semantic, keyword] = await Promise.all([
      repository.semanticSearch(queryVector, filters, CANDIDATES_PER_SEARCH),
      repository.keywordSearch(input.query, filters, CANDIDATES_PER_SEARCH),
    ]);

    return reciprocalRankFusion({ semantic, keyword })
      .slice(0, input.limit)
      .map(({ item, score, ranks }) => ({
        chunkId: item.id,
        documentId: item.documentId,
        documentTitle: item.documentTitle,
        category: item.category,
        originalName: item.originalName,
        ordinal: item.ordinal,
        pageStart: item.pageStart,
        pageEnd: item.pageEnd,
        content: item.content,
        score,
        matchedBy: (['semantic', 'keyword'] as const).filter((name) => ranks[name] !== undefined),
        similarity: semantic.find((hit) => hit.id === item.id)?.score ?? null,
      }));
  }

  async ask(input: AskInput): Promise<AskResult> {
    const { llm, repository, interactions, logger } = this.deps;
    if (!llm) {
      throw new ServiceUnavailableError(
        'LLM_NOT_CONFIGURED',
        'Las respuestas con IA están desactivadas: falta configurar GEMINI_API_KEY en el archivo .env (y reiniciar el servidor). La búsqueda en tu biblioteca sí funciona.',
      );
    }
    if ((await repository.countReadyDocuments()) === 0) {
      throw new AppError(
        409,
        'EMPTY_LIBRARY',
        'Tu biblioteca todavía no tiene documentos procesados. Subí documentos en la sección Biblioteca y volvé a consultar.',
      );
    }

    const hits = await this.search({ ...input, query: input.question, limit: SOURCES_PER_ANSWER });
    const sources: AnswerSource[] = hits.map((hit, i) => ({ ...hit, number: i + 1 }));
    const prompt = loadPrompt(PROMPT_VERSIONS.ragAnswer);
    const interactionInput = {
      question: input.question,
      categories: input.categories ?? [],
      documentIds: input.documentIds ?? [],
    };
    const interactionContext = sources.map((s) => ({
      number: s.number,
      chunkId: s.chunkId,
      documentId: s.documentId,
      score: s.score,
      matchedBy: s.matchedBy,
    }));
    const startedAt = Date.now();

    try {
      const answer = await llm.generateGroundedAnswer({
        systemPrompt: prompt.text,
        question: input.question,
        documents: sources.map((source) => ({
          title: sourceTitle(source),
          context: `Categoría: ${CATEGORY_LABELS[source.category]}. Archivo: ${source.originalName}.`,
          content: source.content,
        })),
      });
      const durationMs = Date.now() - startedAt;
      const blocks = toBlocksWithSourceNumbers(answer.blocks, sources.length);

      const interaction = await interactions.create({
        module: RAG_MODULE,
        input: interactionInput,
        context: interactionContext,
        output: { blocks, sources: sourcesSnapshot(sources) },
        model: answer.model,
        promptVersion: prompt.version,
        inputTokens: answer.usage.inputTokens,
        outputTokens: answer.usage.outputTokens,
        durationMs,
        status: 'SUCCESS',
      });
      logger.info(
        { interactionId: interaction.id, sources: sources.length, ms: durationMs, ...answer.usage },
        'RAG answer generated',
      );

      return {
        interactionId: interaction.id,
        question: input.question,
        blocks,
        sources,
        model: answer.model,
        usage: answer.usage,
        durationMs,
        createdAt: interaction.createdAt,
      };
    } catch (error) {
      await interactions
        .create({
          module: RAG_MODULE,
          input: interactionInput,
          context: interactionContext,
          model: llm.model,
          promptVersion: prompt.version,
          durationMs: Date.now() - startedAt,
          status: 'FAILED',
          errorMessage: error instanceof Error ? error.message : String(error),
        })
        .catch((logError: unknown) => logger.error({ err: logError }, 'Could not record failed interaction'));
      throw error;
    }
  }
}

/** "Ley 20.744 (LCT) — pág. 12" / "— págs. 12-13" */
export function sourceTitle(source: Pick<SearchHit, 'documentTitle' | 'pageStart' | 'pageEnd'>): string {
  const { documentTitle, pageStart, pageEnd } = source;
  if (pageStart === null) return documentTitle;
  if (pageEnd === null || pageEnd === pageStart) return `${documentTitle} — pág. ${pageStart}`;
  return `${documentTitle} — págs. ${pageStart}-${pageEnd}`;
}

/** Maps the model's document indexes (0-based) to the numbers the lawyer sees ([1], [2]...). */
export function toBlocksWithSourceNumbers(blocks: AnswerBlock[], sourceCount: number) {
  return blocks.map((block) => ({
    text: block.text,
    citations: block.citations
      .filter((c) => c.documentIndex >= 0 && c.documentIndex < sourceCount)
      .map((c) => ({
        sourceNumber: c.documentIndex + 1,
        citedText: c.citedText,
        startChar: c.startChar,
        endChar: c.endChar,
      })),
  }));
}

/** What the history needs to show an old answer even if the document was later deleted. */
function sourcesSnapshot(sources: AnswerSource[]) {
  return sources.map(({ number, chunkId, documentId, documentTitle, category, originalName, pageStart, pageEnd, content, matchedBy }) => ({
    number,
    chunkId,
    documentId,
    documentTitle,
    category,
    originalName,
    pageStart,
    pageEnd,
    content,
    matchedBy,
  }));
}

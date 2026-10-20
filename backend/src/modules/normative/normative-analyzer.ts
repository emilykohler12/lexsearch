import type { Logger } from '../../lib/logger.js';
import { safeErrorMessage } from '../../lib/errors.js';
import type { InteractionsRepository } from '../interactions/interactions.repository.js';
import type { LlmProvider } from '../llm/llm-provider.js';
import { loadPrompt, PROMPT_VERSIONS } from '../llm/prompts.js';
import {
  buildRelevanceRequest,
  keywordMatch,
  modelRelevanceSchema,
  normalizeRelevance,
  type AnalysisItem,
  type ItemAnalysis,
  type TopicProfile,
} from './normative-analysis.js';

export const NORMATIVE_RELEVANCE_MODULE = 'normative-relevance';

/** A batch of norms to compare with the topics takes the model longer than a short answer. */
const BATCH_TIMEOUT_MS = 60_000;

interface NormativeAnalyzerDeps {
  llm: LlmProvider | null;
  interactions: InteractionsRepository;
  logger: Logger;
}

/**
 * Decides which of the topics the lawyer follows each norm affects. With a model it reads the opening
 * and the first article of each norm; without one it falls back to the topics' words. Either way every
 * phrase it shows is the norm's own, and the lawyer gets only a proposal.
 */
export class NormativeAnalyzer {
  constructor(private readonly deps: NormativeAnalyzerDeps) {}

  /** False when the match is by words only (no model configured). */
  get usesAi(): boolean {
    return this.deps.llm !== null;
  }

  /**
   * One batch of norms against the topics. Throws when the model fails (the caller leaves those norms
   * for the next check). Norms that affect no topic don't appear in the result.
   */
  async classify(items: AnalysisItem[], topics: TopicProfile[], context: { editionDate: string }): Promise<Map<string, ItemAnalysis>> {
    const { llm } = this.deps;
    if (items.length === 0 || topics.length === 0) return new Map();
    if (!llm) return this.byKeywords(items, topics);

    const { interactions, logger } = this.deps;
    const prompt = loadPrompt(PROMPT_VERSIONS.normativeRelevance);
    const request = buildRelevanceRequest(items, topics);
    // What is recorded: which norms were read and against which topics (the norms are public: their text is in the bulletin).
    const input = {
      edition: context.editionDate,
      norms: items.map((item) => ({ id: item.id, headline: item.headline })),
      topics: topics.map((topic) => topic.name),
    };
    const startedAt = Date.now();

    try {
      const result = await llm.generateStructured({
        systemPrompt: prompt.text,
        userMessage: request.message,
        schema: modelRelevanceSchema,
        timeoutMs: BATCH_TIMEOUT_MS,
        minReasoning: 'low',
      });
      const analyses = normalizeRelevance(result.data, request);
      const durationMs = Date.now() - startedAt;

      await interactions
        .create({
          module: NORMATIVE_RELEVANCE_MODULE,
          input,
          output: {
            matches: [...analyses].map(([itemId, analysis]) => ({
              itemId,
              summary: analysis.summary,
              matches: analysis.matches.map((match) => ({ ...match })),
            })),
          },
          model: result.model,
          promptVersion: prompt.version,
          inputTokens: result.usage.inputTokens,
          outputTokens: result.usage.outputTokens,
          durationMs,
          status: 'SUCCESS',
        })
        .catch((error: unknown) => logger.error({ err: error }, 'Could not record a normative-relevance interaction'));
      return analyses;
    } catch (error) {
      await interactions
        .create({
          module: NORMATIVE_RELEVANCE_MODULE,
          input,
          model: llm.model,
          promptVersion: prompt.version,
          durationMs: Date.now() - startedAt,
          status: 'FAILED',
          errorMessage: safeErrorMessage(error),
        })
        .catch((logError: unknown) => logger.error({ err: logError }, 'Could not record a failed interaction'));
      throw error;
    }
  }

  private byKeywords(items: AnalysisItem[], topics: TopicProfile[]): Map<string, ItemAnalysis> {
    const analyses = new Map<string, ItemAnalysis>();
    for (const item of items) {
      const matches = topics.map((topic) => keywordMatch(topic, item)).filter((match) => match !== null);
      if (matches.length > 0) analyses.set(item.id, { summary: '', matches });
    }
    return analyses;
  }
}

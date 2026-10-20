import { BadRequestError, ServiceUnavailableError, safeErrorMessage } from '../../lib/errors.js';
import type { Logger } from '../../lib/logger.js';
import { toIsoDate } from '../calendar/dates.js';
import type { CasesRepository } from '../cases/cases.repository.js';
import { formatCaseContext } from '../hearings/hearing-dialogue.js';
import type { InteractionsRepository } from '../interactions/interactions.repository.js';
import type { LlmProvider } from '../llm/llm-provider.js';
import { loadPrompt, PROMPT_VERSIONS } from '../llm/prompts.js';
import type { RagService } from '../rag/rag.service.js';
import { buildEstimateRequest, buildSearchQuery, emptyResult, groupRulings, modelEstimateSchema, normalizeEstimate } from './estimate-analysis.js';
import { MIN_COMPARABLE, toProposalDto, type AnalyzeEstimateInput } from './estimates.schemas.js';

export const OUTCOME_ESTIMATE_MODULE = 'outcome-estimate';

/** Fragments searched in the jurisprudence of the library (several of them can belong to the same ruling). */
const FRAGMENTS_SEARCHED = 16;
const TIMEOUT_MS = 90_000;

interface EstimateAnalysisDeps {
  rag: RagService;
  cases: CasesRepository;
  llm: LlmProvider | null;
  interactions: InteractionsRepository;
  logger: Logger;
}

/**
 * Looks for rulings like the case in the jurisprudence of the library, has the model read each one and counts.
 * It only proposes: nothing is saved here.
 */
export class EstimateAnalysisService {
  constructor(private readonly deps: EstimateAnalysisDeps) {}

  async analyze(input: AnalyzeEstimateInput) {
    const { rag, llm, interactions, logger } = this.deps;
    if (!llm) {
      throw new ServiceUnavailableError(
        'LLM_NOT_CONFIGURED',
        'Para estimar hace falta configurar GEMINI_API_KEY en el archivo .env y reiniciar el servidor.',
      );
    }
    const caseContext = input.caseId ? await this.loadCaseContext(input.caseId) : '';

    const hits = await rag.search({ query: buildSearchQuery(input.facts, input.claim), categories: ['JURISPRUDENCIA'], limit: FRAGMENTS_SEARCHED });
    const rulings = groupRulings(hits, await rag.headings([...new Set(hits.map((hit) => hit.documentId))]));
    const logInput = { caseId: input.caseId ?? null, factsChars: input.facts.length, rulings: rulings.length };

    // Nothing like the case in the library: say so without paying for a model call.
    if (rulings.length < MIN_COMPARABLE) {
      await interactions
        .create({ module: OUTCOME_ESTIMATE_MODULE, input: logInput, output: { orientation: 'INSUFFICIENT' }, durationMs: 0, status: 'SUCCESS' })
        .catch((error: unknown) => logger.error({ err: error }, 'Could not record an outcome-estimate interaction'));
      return toProposalDto({ ...emptyResult(), searched: rulings.length }, '');
    }

    const prompt = loadPrompt(PROMPT_VERSIONS.outcomeEstimate);
    const startedAt = Date.now();
    try {
      const result = await llm.generateStructured({
        systemPrompt: prompt.text,
        userMessage: buildEstimateRequest(input.facts, input.claim, caseContext, rulings),
        schema: modelEstimateSchema,
        timeoutMs: TIMEOUT_MS,
        minReasoning: 'medium',
      });
      const estimate = normalizeEstimate(result.data, rulings);
      await interactions
        .create({
          module: OUTCOME_ESTIMATE_MODULE,
          input: logInput,
          context: rulings.map((ruling) => ({ documentId: ruling.documentId })),
          output: { orientation: estimate.orientation, counts: estimate.counts },
          model: result.model,
          promptVersion: prompt.version,
          inputTokens: result.usage.inputTokens,
          outputTokens: result.usage.outputTokens,
          durationMs: Date.now() - startedAt,
          status: 'SUCCESS',
        })
        .catch((error: unknown) => logger.error({ err: error }, 'Could not record an outcome-estimate interaction'));
      return toProposalDto(estimate, result.model);
    } catch (error) {
      await interactions
        .create({
          module: OUTCOME_ESTIMATE_MODULE,
          input: logInput,
          model: llm.model,
          promptVersion: prompt.version,
          durationMs: Date.now() - startedAt,
          status: 'FAILED',
          // Only messages written for the lawyer: anything else could carry part of the case.
          errorMessage: safeErrorMessage(error),
        })
        .catch((logError: unknown) => logger.error({ err: logError }, 'Could not record a failed interaction'));
      throw error;
    }
  }

  private async loadCaseContext(caseId: string): Promise<string> {
    const { cases } = this.deps;
    const found = await cases.findById(caseId);
    if (!found) throw new BadRequestError('El expediente elegido no existe o fue eliminado.');
    const proceedings = await cases.listProceedings(caseId);
    return formatCaseContext(
      found,
      proceedings.map((proceeding) => ({ date: toIsoDate(proceeding.date), kind: proceeding.kind, title: proceeding.title, description: proceeding.description })),
    );
  }
}

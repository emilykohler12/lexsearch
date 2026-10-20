import { rm } from 'node:fs/promises';
import { ServiceUnavailableError, safeErrorMessage } from '../../lib/errors.js';
import type { Logger } from '../../lib/logger.js';
import type { IncomingFile } from '../documents/documents.service.js';
import { readUploadedText } from '../documents/uploaded-text.js';
import type { InteractionsRepository } from '../interactions/interactions.repository.js';
import type { LlmProvider } from '../llm/llm-provider.js';
import { loadPrompt, PROMPT_VERSIONS } from '../llm/prompts.js';
import type { OcrEngine } from '../ocr/ocr-engine.js';
import {
  buildAnalysisRequest,
  modelAnalysisSchema,
  normalizeAnalysis,
  type DeadlineProposal,
} from './deadline-analysis.js';

export const DEADLINE_EXTRACTION_MODULE = 'deadline-extraction';

/** The interaction log keeps the text the model read (to tune the prompt), up to this size. */
const MAX_LOGGED_TEXT_CHARS = 60_000;

interface DeadlineAnalysisDeps {
  llm: LlmProvider | null;
  ocr: OcrEngine;
  interactions: InteractionsRepository;
  logger: Logger;
}

/**
 * Reads a cédula or a resolution and proposes the terms it grants. The file is read and thrown
 * away (it isn't added to the library) and nothing is saved: the lawyer confirms each term.
 */
export class DeadlineAnalysisService {
  constructor(private readonly deps: DeadlineAnalysisDeps) {}

  async analyze(file: IncomingFile): Promise<DeadlineProposal> {
    const { llm, interactions, logger } = this.deps;
    try {
      if (!llm) {
        throw new ServiceUnavailableError(
          'LLM_NOT_CONFIGURED',
          'Para analizar una cédula o resolución hace falta configurar GEMINI_API_KEY en el archivo .env y reiniciar el servidor.',
        );
      }

      const { text, ocrPageCount } = await readUploadedText(file, this.deps.ocr);
      const prompt = loadPrompt(PROMPT_VERSIONS.deadlineExtraction);
      const input = { fileName: file.originalName, textChars: text.length, ocrPageCount, text: text.slice(0, MAX_LOGGED_TEXT_CHARS) };
      const startedAt = Date.now();

      try {
        const result = await llm.generateStructured({
          systemPrompt: prompt.text,
          userMessage: buildAnalysisRequest(text),
          schema: modelAnalysisSchema,
        });
        const proposal = normalizeAnalysis(result.data, text);
        const durationMs = Date.now() - startedAt;

        const interaction = await interactions.create({
          module: DEADLINE_EXTRACTION_MODULE,
          input,
          output: { proposal: { ...proposal, terms: proposal.terms.map((term) => ({ ...term })) } },
          model: result.model,
          promptVersion: prompt.version,
          inputTokens: result.usage.inputTokens,
          outputTokens: result.usage.outputTokens,
          durationMs,
          status: 'SUCCESS',
        });
        logger.info({ interactionId: interaction.id, terms: proposal.terms.length, ms: durationMs }, 'Document analyzed for deadlines');
        return proposal;
      } catch (error) {
        await interactions
          .create({
            module: DEADLINE_EXTRACTION_MODULE,
            input,
            model: llm.model,
            promptVersion: prompt.version,
            durationMs: Date.now() - startedAt,
            status: 'FAILED',
            errorMessage: safeErrorMessage(error),
          })
          .catch((logError: unknown) => logger.error({ err: logError }, 'Could not record failed interaction'));
        throw error;
      }
    } finally {
      await rm(file.tempPath, { force: true });
    }
  }
}

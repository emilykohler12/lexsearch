import { rm } from 'node:fs/promises';
import { BadRequestError, NotFoundError, ServiceUnavailableError } from '../../lib/errors.js';
import type { Logger } from '../../lib/logger.js';
import { toIsoDate } from '../calendar/dates.js';
import type { IncomingFile } from '../documents/documents.service.js';
import { readUploadedText } from '../documents/uploaded-text.js';
import type { InteractionsRepository } from '../interactions/interactions.repository.js';
import type { LlmProvider } from '../llm/llm-provider.js';
import { loadPrompt, PROMPT_VERSIONS } from '../llm/prompts.js';
import type { OcrEngine } from '../ocr/ocr-engine.js';
import type { CasesRepository } from './cases.repository.js';
import {
  buildAnalysisRequest,
  modelAnalysisSchema,
  normalizeAnalysis,
  type TimelineProposal,
} from './proceeding-analysis.js';

export const PROCEEDING_EXTRACTION_MODULE = 'proceeding-extraction';

/** The interaction log keeps the text the model read (to tune the prompt), up to this size. */
const MAX_LOGGED_TEXT_CHARS = 60_000;

/** What the lawyer gives us to read: text pasted in the page, or a file (PDF, photo, Word, text). */
export type AnalysisSource = { kind: 'text'; text: string } | { kind: 'file'; file: IncomingFile };

interface ProceedingAnalysisDeps {
  cases: CasesRepository;
  llm: LlmProvider | null;
  ocr: OcrEngine;
  interactions: InteractionsRepository;
  logger: Logger;
}

/**
 * Reads a text with the movements of an expediente and proposes its actuaciones. The file (if
 * any) is read and thrown away, and nothing is saved: the lawyer confirms each actuación.
 */
export class ProceedingAnalysisService {
  constructor(private readonly deps: ProceedingAnalysisDeps) {}

  async analyze(caseId: string, source: AnalysisSource): Promise<TimelineProposal> {
    const { cases, llm, interactions, logger } = this.deps;
    try {
      if (!(await cases.findById(caseId))) throw new NotFoundError('El expediente no existe o fue eliminado');
      if (!llm) {
        throw new ServiceUnavailableError(
          'LLM_NOT_CONFIGURED',
          'Para leer actuaciones con IA hace falta configurar GEMINI_API_KEY en el archivo .env y reiniciar el servidor.',
        );
      }

      const { text, ocrPageCount, fileName } = await this.readSource(source);
      if (text.trim().length < 20) {
        throw new BadRequestError('No se encontró texto para leer en el archivo. Si es una foto o un escaneo, probá con una imagen más nítida.');
      }

      const existing = (await cases.listProceedings(caseId)).map((proceeding) => ({
        date: toIsoDate(proceeding.date),
        title: proceeding.title,
      }));
      const prompt = loadPrompt(PROMPT_VERSIONS.proceedingExtraction);
      const request = buildAnalysisRequest(text);
      const input = { caseId, fileName, textChars: text.length, ocrPageCount, text: text.slice(0, MAX_LOGGED_TEXT_CHARS) };
      const startedAt = Date.now();

      try {
        const result = await llm.generateStructured({
          systemPrompt: prompt.text,
          userMessage: request.message,
          schema: modelAnalysisSchema,
        });
        const proposal = normalizeAnalysis(result.data, text, existing, request.truncated);
        const durationMs = Date.now() - startedAt;

        const interaction = await interactions.create({
          module: PROCEEDING_EXTRACTION_MODULE,
          input,
          output: {
            proposal: {
              ...proposal,
              caseInfo: { ...proposal.caseInfo },
              proceedings: proposal.proceedings.map((proceeding) => ({ ...proceeding })),
            },
          },
          model: result.model,
          promptVersion: prompt.version,
          inputTokens: result.usage.inputTokens,
          outputTokens: result.usage.outputTokens,
          durationMs,
          status: 'SUCCESS',
        });
        logger.info(
          { interactionId: interaction.id, proceedings: proposal.proceedings.length, ms: durationMs },
          'Text analyzed for proceedings',
        );
        return proposal;
      } catch (error) {
        await interactions
          .create({
            module: PROCEEDING_EXTRACTION_MODULE,
            input,
            model: llm.model,
            promptVersion: prompt.version,
            durationMs: Date.now() - startedAt,
            status: 'FAILED',
            errorMessage: error instanceof Error ? error.message : String(error),
          })
          .catch((logError: unknown) => logger.error({ err: logError }, 'Could not record failed interaction'));
        throw error;
      }
    } finally {
      if (source.kind === 'file') await rm(source.file.tempPath, { force: true });
    }
  }

  private async readSource(source: AnalysisSource): Promise<{ text: string; ocrPageCount: number; fileName: string | null }> {
    if (source.kind === 'text') return { text: source.text, ocrPageCount: 0, fileName: null };
    const { text, ocrPageCount } = await readUploadedText(source.file, this.deps.ocr);
    return { text, ocrPageCount, fileName: source.file.originalName };
  }
}

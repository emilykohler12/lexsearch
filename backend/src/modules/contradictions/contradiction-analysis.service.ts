import type { Document } from '../../generated/prisma/client.js';
import { BadRequestError, NotFoundError, ServiceUnavailableError } from '../../lib/errors.js';
import type { Logger } from '../../lib/logger.js';
import type { CasesRepository } from '../cases/cases.repository.js';
import type { DocumentTextReader } from '../documents/document-text.js';
import type { DocumentsRepository } from '../documents/documents.repository.js';
import type { InteractionsRepository } from '../interactions/interactions.repository.js';
import type { LlmProvider } from '../llm/llm-provider.js';
import { loadPrompt, PROMPT_VERSIONS } from '../llm/prompts.js';
import {
  buildAnalysisRequest,
  modelAnalysisSchema,
  normalizeAnalysis,
  prepareDocuments,
  type ContradictionProposal,
} from './contradiction-analysis.js';
import type { ContradictionsRepository } from './contradictions.repository.js';
import { MIN_DOCUMENTS, parseStatements } from './contradictions.schemas.js';

export const CONTRADICTION_DETECTION_MODULE = 'contradiction-detection';

/** Comparing several long documents takes the model much longer than the usual answer. */
const ANALYSIS_TIMEOUT_MS = 90_000;

/** A document with less text than this has nothing to compare (a blank scan, for example). */
const MIN_TEXT_CHARS = 20;

/** Texts kept in memory so that running the comparison again doesn't read (or OCR) the files again. */
const MAX_CACHED_TEXTS = 40;

interface ContradictionAnalysisDeps {
  cases: CasesRepository;
  documents: DocumentsRepository;
  reader: DocumentTextReader;
  contradictions: ContradictionsRepository;
  llm: LlmProvider | null;
  interactions: InteractionsRepository;
  logger: Logger;
}

/**
 * Compares the documents the lawyer chose from one expediente and proposes the contradictions it
 * finds. Nothing is saved: the lawyer confirms each finding after checking it against the originals.
 */
export class ContradictionAnalysisService {
  private readonly texts = new Map<string, { version: string; text: string }>();

  constructor(private readonly deps: ContradictionAnalysisDeps) {}

  async analyze(caseId: string, input: { documentIds: string[]; focus: string }): Promise<ContradictionProposal> {
    const { cases, contradictions, llm, interactions, logger } = this.deps;

    if (!(await cases.exists(caseId))) throw new NotFoundError('El expediente no existe o fue eliminado');
    if (!llm) {
      throw new ServiceUnavailableError(
        'LLM_NOT_CONFIGURED',
        'Para buscar contradicciones con IA hace falta configurar GEMINI_API_KEY en el archivo .env y reiniciar el servidor.',
      );
    }

    const chosen = await this.loadDocuments(caseId, [...new Set(input.documentIds)]);
    const texts: Array<{ id: string; title: string; text: string }> = [];
    for (const document of chosen) {
      const text = await this.textOf(document);
      // A document with nothing to read would only look like it agrees with the others.
      if (text.trim().length < MIN_TEXT_CHARS) {
        throw new BadRequestError(
          `No se encontró texto para leer en «${document.title}». Si es un escaneo o una foto, probá con una imagen más nítida.`,
        );
      }
      texts.push({ id: document.id, title: document.title, text });
    }

    const prepared = prepareDocuments(texts);
    const saved = (await contradictions.list(caseId)).map((row) => ({ title: row.title, statements: parseStatements(row.statements) }));
    const prompt = loadPrompt(PROMPT_VERSIONS.contradictionDetection);
    // What is recorded: which documents were compared and how much of each was read (the files are in the library).
    const input_ = {
      caseId,
      focus: input.focus,
      documents: prepared.map((document) => ({
        id: document.id,
        title: document.title,
        chars: document.text.length,
        sentChars: document.sent.length,
        truncated: document.truncated,
      })),
    };
    const startedAt = Date.now();

    try {
      const result = await llm.generateStructured({
        systemPrompt: prompt.text,
        userMessage: buildAnalysisRequest(prepared, input.focus),
        schema: modelAnalysisSchema,
        timeoutMs: ANALYSIS_TIMEOUT_MS,
        minReasoning: 'medium',
      });
      const proposal = normalizeAnalysis(result.data, prepared, saved);
      const durationMs = Date.now() - startedAt;

      const interaction = await interactions.create({
        module: CONTRADICTION_DETECTION_MODULE,
        input: input_,
        output: {
          proposal: {
            ...proposal,
            findings: proposal.findings.map((finding) => ({
              ...finding,
              statements: finding.statements.map((statement) => ({ ...statement })),
            })),
            documents: proposal.documents.map((document) => ({ ...document })),
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
        { interactionId: interaction.id, documents: prepared.length, findings: proposal.findings.length, ms: durationMs },
        'Documents compared for contradictions',
      );
      return proposal;
    } catch (error) {
      await interactions
        .create({
          module: CONTRADICTION_DETECTION_MODULE,
          input: input_,
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

  /** The documents, in the order the lawyer chose them, all of this expediente and ready to be read. */
  private async loadDocuments(caseId: string, ids: string[]): Promise<Document[]> {
    if (ids.length < MIN_DOCUMENTS) throw new BadRequestError('Elegí al menos dos documentos para comparar.');

    const chosen: Document[] = [];
    for (const id of ids) {
      const document = await this.deps.documents.findById(id);
      if (!document) throw new BadRequestError('Alguno de los documentos elegidos no existe o fue eliminado.');
      if (document.caseId !== caseId) throw new BadRequestError(`«${document.title}» no pertenece a este expediente.`);
      if (document.status !== 'READY') {
        const why = document.status === 'FAILED' ? 'no se pudo procesar' : 'todavía se está procesando';
        throw new BadRequestError(`«${document.title}» ${why}.`);
      }
      chosen.push(document);
    }
    return chosen;
  }

  private async textOf(document: Document): Promise<string> {
    // The version changes if the file is processed again (reprocess) or is another file.
    const version = `${document.sha256}:${document.processedAt?.getTime() ?? 0}`;
    const cached = this.texts.get(document.id);
    if (cached?.version === version) return cached.text;

    let text: string;
    try {
      text = (await this.deps.reader.read(document.id))?.text ?? '';
    } catch (error) {
      this.deps.logger.error({ err: error, documentId: document.id }, 'Could not read a document to compare it');
      throw new BadRequestError(`No se pudo leer «${document.title}». Probá con «Reprocesar» en la biblioteca.`);
    }

    this.texts.delete(document.id);
    this.texts.set(document.id, { version, text });
    if (this.texts.size > MAX_CACHED_TEXTS) {
      const oldest = this.texts.keys().next().value;
      if (oldest !== undefined) this.texts.delete(oldest);
    }
    return text;
  }
}

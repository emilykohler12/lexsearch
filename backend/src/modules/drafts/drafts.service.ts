import type { Document, Draft, Prisma } from '../../generated/prisma/client.js';
import { BadRequestError, NotFoundError, ServiceUnavailableError } from '../../lib/errors.js';
import type { Logger } from '../../lib/logger.js';
import type { DocumentTextReader } from '../documents/document-text.js';
import type { DocumentsRepository } from '../documents/documents.repository.js';
import { CATEGORY_LABELS } from '../documents/documents.schemas.js';
import type { InteractionsRepository } from '../interactions/interactions.repository.js';
import type { LlmProvider } from '../llm/llm-provider.js';
import { loadPrompt, PROMPT_VERSIONS } from '../llm/prompts.js';
import type { RagService } from '../rag/rag.service.js';
import { draftToDocx } from './docx-export.js';
import { createDraftTools, SourceCollector } from './draft-tools.js';
import type { DraftsRepository } from './drafts.repository.js';
import { DRAFT_TYPES, type CreateDraftInput, type DraftType } from './drafts.schemas.js';

export const DRAFT_MODULE = 'draft-generator';

/** Rounds of library searches/readings before the agent must write. */
const MAX_TOOL_ROUNDS = 4;

interface DraftsServiceDeps {
  repository: DraftsRepository;
  documents: DocumentsRepository;
  reader: DocumentTextReader;
  rag: RagService;
  llm: LlmProvider | null;
  interactions: InteractionsRepository;
  logger: Logger;
}

export class DraftsService {
  constructor(private readonly deps: DraftsServiceDeps) {}

  /** Asks the agent for a first draft and stores it (with what it consulted) for the lawyer to review. */
  async create(input: CreateDraftInput): Promise<Draft> {
    const { llm, interactions, logger } = this.deps;
    if (!llm) {
      throw new ServiceUnavailableError(
        'LLM_NOT_CONFIGURED',
        'Para redactar borradores hace falta la IA: configurá GEMINI_API_KEY en el archivo .env y reiniciá el servidor.',
      );
    }

    let template: Document | null = null;
    if (input.templateDocumentId) {
      template = await this.deps.documents.findById(input.templateDocumentId);
      if (!template || template.status !== 'READY') {
        throw new BadRequestError('El modelo base elegido no existe o todavía no está procesado.');
      }
    }

    const prompt = loadPrompt(PROMPT_VERSIONS.draftGenerator);
    const collector = new SourceCollector();
    const tools = createDraftTools({
      rag: this.deps.rag,
      reader: this.deps.reader,
      collector,
      defaultCategories: input.categories,
    });
    const interactionInput = {
      documentType: input.documentType,
      title: input.title ?? null,
      instructions: input.instructions,
      caseDetails: input.caseDetails,
      templateDocumentId: template?.id ?? null,
      categories: input.categories ?? [],
    };
    const startedAt = Date.now();

    try {
      const result = await llm.runAgent({
        systemPrompt: prompt.text,
        userMessage: buildDraftRequest(input, template),
        tools,
        maxToolRounds: MAX_TOOL_ROUNDS,
      });
      const { title: suggestedTitle, content } = parseDraftResponse(result.text);
      const title = input.title || suggestedTitle || titleFromDraft(content, input.documentType);
      const sources = collector.list();
      const durationMs = Date.now() - startedAt;

      // The original draft is kept in the log even after the lawyer edits it: useful to tune the prompt.
      const interaction = await interactions.create({
        module: DRAFT_MODULE,
        input: interactionInput,
        context: {
          toolCalls: result.toolCalls as unknown as Prisma.InputJsonValue,
          sources: sources.map(({ kind, documentId, chunkId }) => ({ kind, documentId, chunkId: chunkId ?? null })),
        },
        output: { title, content },
        model: result.model,
        promptVersion: prompt.version,
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        durationMs,
        status: 'SUCCESS',
      });
      logger.info(
        { interactionId: interaction.id, toolCalls: result.toolCalls.length, sources: sources.length, ms: durationMs },
        'Draft generated',
      );

      return await this.deps.repository.create({
        title,
        documentType: input.documentType,
        instructions: input.instructions,
        caseDetails: input.caseDetails,
        templateDocumentId: template?.id ?? null,
        content,
        sources: sources as unknown as Prisma.InputJsonValue,
        model: result.model,
        interactionId: interaction.id,
      });
    } catch (error) {
      await interactions
        .create({
          module: DRAFT_MODULE,
          input: interactionInput,
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

  list() {
    return this.deps.repository.list();
  }

  async get(id: string): Promise<Draft> {
    const draft = await this.deps.repository.findById(id);
    if (!draft) throw new NotFoundError('El borrador no existe o fue eliminado');
    return draft;
  }

  async update(id: string, data: { title?: string | undefined; content?: string | undefined }): Promise<Draft> {
    await this.get(id);
    return this.deps.repository.update(id, data);
  }

  async delete(id: string): Promise<void> {
    await this.get(id);
    await this.deps.repository.delete(id);
  }

  async exportDocx(id: string): Promise<{ fileName: string; data: Buffer }> {
    const draft = await this.get(id);
    return { fileName: `${fileNameFrom(draft.title)}.docx`, data: await draftToDocx(draft.title, draft.content) };
  }
}

/** The lawyer's request, as the agent reads it. */
export function buildDraftRequest(input: CreateDraftInput, template: Pick<Document, 'id' | 'title'> | null): string {
  const lines = [
    `Tipo de documento: ${DRAFT_TYPES[input.documentType]}`,
    ...(input.title ? [`Título sugerido: ${input.title}`] : []),
    '',
    'Indicaciones del abogado:',
    input.instructions,
    '',
    'Datos del caso y de las partes:',
    input.caseDetails || '(No se indicaron: usá marcadores [COMPLETAR: …] para los datos que falten.)',
    '',
    template
      ? `Modelo base elegido por el abogado: «${template.title}» (documento_id: ${template.id}). Leelo con leer_documento antes de redactar y seguí su estructura y su estilo.`
      : 'No se eligió modelo base: si te sirve, buscá en la biblioteca modelos o escritos parecidos (tipos MODELO y ESCRITO).',
  ];
  if (input.categories?.length) {
    lines.push('', `Buscá respaldo en estos tipos de documento: ${input.categories.map((c) => CATEGORY_LABELS[c]).join(', ')}.`);
  }
  return lines.join('\n');
}

/** Removes a ```markdown fence when the model wraps the whole draft in one. */
export function cleanDraftMarkdown(text: string): string {
  const fenced = /^```(?:markdown|md)?[ \t]*\n([\s\S]*?)\n```\s*$/i.exec(text.trim());
  return (fenced ? fenced[1]! : text).trim();
}

/**
 * Splits the agent's answer into the "Título: …" line the prompt asks for (used to tell
 * drafts apart in the list) and the document itself. The fence may wrap either.
 */
export function parseDraftResponse(text: string): { title: string | null; content: string } {
  const unfenced = cleanDraftMarkdown(text);
  const [firstLine = '', ...rest] = unfenced.split('\n');
  const label = /^t[íi]tulo\s*:\s*(.+)$/i.exec(firstLine.replace(/[*_]/g, '').trim());
  if (!label) return { title: null, content: unfenced };
  const title = label[1]!.replace(/^[«"“]+|[»"”]+$/g, '').trim().slice(0, 200);
  return { title: title || null, content: cleanDraftMarkdown(rest.join('\n')) };
}

/** The draft's "# Title", or the document type when it has none. */
export function titleFromDraft(content: string, type: DraftType): string {
  const heading = /^#\s+(.+)$/m.exec(content)?.[1]?.replace(/[*_]/g, '').trim();
  return (heading || DRAFT_TYPES[type]).slice(0, 200);
}

/** A safe Windows/Mac file name: "Carta documento: despido" -> "Carta documento - despido". */
export function fileNameFrom(title: string): string {
  const cleaned = title
    .replace(/[<>:"/\\|?*]+/g, ' - ')
    .replace(/[\p{Cc}]+/gu, '')
    .replace(/\s+/g, ' ')
    .replace(/^[\s.-]+|[\s.-]+$/g, '');
  return cleaned.slice(0, 120) || 'borrador';
}

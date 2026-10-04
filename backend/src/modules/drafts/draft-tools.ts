import type { DocumentCategory } from '../../generated/prisma/client.js';
import type { DocumentTextReader } from '../documents/document-text.js';
import { CATEGORY_LABELS } from '../documents/documents.schemas.js';
import type { AgentTool } from '../llm/llm-provider.js';
import { sourceTitle, type RagService, type SearchHit } from '../rag/rag.service.js';
import type { DraftSource } from './drafts.schemas.js';

const CATEGORY_CODES = Object.keys(CATEGORY_LABELS) as DocumentCategory[];
const FRAGMENTS_PER_SEARCH = 6;
/** Long enough for any model contract or brief; avoids sending a whole code of law. */
const MAX_DOCUMENT_CHARS = 40_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const isCategory = (value: unknown): value is DocumentCategory =>
  typeof value === 'string' && (CATEGORY_CODES as string[]).includes(value);

/** Remembers everything the agent looked at, to list it next to the draft. */
export class SourceCollector {
  private readonly sources = new Map<string, DraftSource>();

  addFragment(hit: SearchHit): void {
    this.sources.set(`fragment:${hit.chunkId}`, {
      kind: 'fragment',
      documentId: hit.documentId,
      documentTitle: hit.documentTitle,
      chunkId: hit.chunkId,
      pageStart: hit.pageStart,
      pageEnd: hit.pageEnd,
      content: hit.content,
    });
  }

  addDocument(document: { id: string; title: string }): void {
    this.sources.set(`document:${document.id}`, {
      kind: 'document',
      documentId: document.id,
      documentTitle: document.title,
    });
  }

  list(): DraftSource[] {
    return [...this.sources.values()];
  }
}

interface DraftToolsDeps {
  rag: RagService;
  reader: DocumentTextReader;
  collector: SourceCollector;
  /** Document types chosen by the lawyer; used when the agent doesn't pick its own. */
  defaultCategories?: DocumentCategory[] | undefined;
}

/** What the drafting agent can do with the lawyer's library. */
export function createDraftTools(deps: DraftToolsDeps): AgentTool[] {
  return [
    {
      name: 'buscar_en_biblioteca',
      description:
        'Busca en la biblioteca del abogado fragmentos relacionados con una consulta (por significado y por palabras exactas). ' +
        'Sirve para encontrar modelos o escritos parecidos, cláusulas, normas y jurisprudencia. ' +
        `Devuelve hasta ${FRAGMENTS_PER_SEARCH} fragmentos con el documento al que pertenece cada uno.`,
      parameters: {
        type: 'object',
        properties: {
          consulta: {
            type: 'string',
            description: 'Qué buscar, en pocas palabras concretas. Ej.: "carta documento despido intimación registración".',
          },
          tipos: {
            type: 'array',
            items: { type: 'string', enum: CATEGORY_CODES },
            description: 'Opcional: limitar la búsqueda a estos tipos de documento.',
          },
        },
        required: ['consulta'],
      },
      async execute(args) {
        const query = typeof args.consulta === 'string' ? args.consulta.trim().slice(0, 500) : '';
        if (query.length < 2) throw new Error('La consulta está vacía.');
        const requested = Array.isArray(args.tipos) ? args.tipos.filter(isCategory) : [];
        const categories = requested.length > 0 ? requested : deps.defaultCategories;

        const hits = await deps.rag.search({ query, categories, limit: FRAGMENTS_PER_SEARCH });
        for (const hit of hits) deps.collector.addFragment(hit);
        if (hits.length === 0) return { fragmentos: [], nota: 'No se encontraron fragmentos relacionados.' };
        return {
          fragmentos: hits.map((hit) => ({
            documento_id: hit.documentId,
            documento: sourceTitle(hit),
            tipo: CATEGORY_LABELS[hit.category],
            texto: hit.content,
          })),
        };
      },
    },
    {
      name: 'leer_documento',
      description:
        'Lee el texto completo de un documento de la biblioteca: por ejemplo, el modelo base elegido por el abogado ' +
        'o un modelo encontrado con la búsqueda.',
      parameters: {
        type: 'object',
        properties: {
          documento_id: {
            type: 'string',
            description: 'El documento_id que figura en el pedido del abogado o en los resultados de la búsqueda.',
          },
        },
        required: ['documento_id'],
      },
      async execute(args) {
        const id = typeof args.documento_id === 'string' ? args.documento_id.trim() : '';
        if (!UUID.test(id)) throw new Error('documento_id inválido.');
        const document = await deps.reader.read(id);
        if (!document) throw new Error('El documento no existe o todavía no está procesado.');

        deps.collector.addDocument(document);
        const truncated = document.text.length > MAX_DOCUMENT_CHARS;
        return {
          titulo: document.title,
          texto: document.text.slice(0, MAX_DOCUMENT_CHARS),
          ...(truncated && { nota: 'El documento es muy largo: el texto está recortado.' }),
        };
      },
    },
  ];
}

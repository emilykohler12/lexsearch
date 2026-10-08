import type { Client, DocumentCategory } from '../../generated/prisma/client.js';
import { PERSON_TYPES, PRACTICE_AREAS, parseChecklist } from '../clients/clients.schemas.js';
import type { DocumentTextReader } from '../documents/document-text.js';
import { CATEGORY_LABELS } from '../documents/documents.schemas.js';
import type { AgentTool } from '../llm/llm-provider.js';
import { sourceTitle, type RagService, type SearchHit } from '../rag/rag.service.js';
import type { DraftSource } from './drafts.schemas.js';

const CATEGORY_CODES = Object.keys(CATEGORY_LABELS) as DocumentCategory[];
const FRAGMENTS_PER_SEARCH = 6;
/** Long enough for any model contract or brief; avoids sending a whole code of law. */
const MAX_DOCUMENT_CHARS = 40_000;
/** The notes of the first meeting can be a long transcript; the agent gets the beginning. */
const MAX_CLIENT_NOTES_CHARS = 12_000;
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
  /** The client the draft is for: the agent can read this file, and no other. */
  client?: Client | null | undefined;
}

/** Drops empty values so the agent only sees what is really known. */
function compact<T extends Record<string, unknown>>(values: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(values).filter(([, value]) => {
      if (value === '' || value === null || value === undefined) return false;
      if (Array.isArray(value)) return value.length > 0;
      if (typeof value === 'object') return Object.keys(value).length > 0;
      return true;
    }),
  ) as Partial<T>;
}

/** The client file as the agent reads it. */
export function clientCard(client: Client) {
  const checklist = parseChecklist(client.checklist);
  const caso = compact({
    area_de_practica: client.practiceArea ? PRACTICE_AREAS[client.practiceArea as keyof typeof PRACTICE_AREAS] : '',
    resumen_del_conflicto: client.conflictSummary,
    pretension: client.claim,
    documentacion: checklist.map((item) => ({ documento: item.text, reunida: item.done })),
    notas_de_la_primera_reunion: client.meetingNotes.slice(0, MAX_CLIENT_NOTES_CHARS),
  });
  return compact({
    cliente: compact({
      nombre: client.fullName,
      tipo_de_persona: PERSON_TYPES[client.personType as keyof typeof PERSON_TYPES],
      documento: client.documentNumber,
      email: client.email,
      telefono: client.phone,
      domicilio: client.address,
    }),
    contraparte: compact({
      nombre: client.counterpartyName,
      documento: client.counterpartyDocument,
      domicilio: client.counterpartyAddress,
    }),
    caso,
  });
}

/** What the drafting agent can do with the lawyer's library (and the client's file, if one was chosen). */
export function createDraftTools(deps: DraftToolsDeps): AgentTool[] {
  const tools: AgentTool[] = [
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

  const { client } = deps;
  if (client) {
    tools.push({
      name: 'leer_ficha_cliente',
      description:
        'Lee la ficha del cliente para quien se redacta el documento: sus datos, los de la contraparte, ' +
        'el resumen del conflicto, lo que pretende y las notas de la primera reunión.',
      parameters: {
        type: 'object',
        properties: {
          cliente_id: {
            type: 'string',
            description: 'El cliente_id que figura en el pedido del abogado.',
          },
        },
        required: ['cliente_id'],
      },
      async execute(args) {
        const id = typeof args.cliente_id === 'string' ? args.cliente_id.trim().toLowerCase() : '';
        // Only the file of the client in this request: nothing the model reads in the library
        // can send it to look at another client.
        if (id !== client.id) throw new Error('cliente_id inválido: solo se puede leer la ficha del cliente de este pedido.');
        return clientCard(client);
      },
    });
  }

  return tools;
}

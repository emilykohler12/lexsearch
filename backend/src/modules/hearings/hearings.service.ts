import { randomUUID } from 'node:crypto';
import { BadRequestError, ConflictError, NotFoundError } from '../../lib/errors.js';
import type { Logger } from '../../lib/logger.js';
import { toIsoDate } from '../calendar/dates.js';
import type { CasesRepository } from '../cases/cases.repository.js';
import type { DocumentTextReader } from '../documents/document-text.js';
import type { DocumentsRepository } from '../documents/documents.repository.js';
import type { DraftsRepository } from '../drafts/drafts.repository.js';
import { cutMiddle, formatCaseContext, MAX_STORED_MATERIAL_CHARS, titleFromText, type DialogueTurn, type Dossier } from './hearing-dialogue.js';
import type { HearingSimulator } from './hearing-simulator.js';
import type { HearingsRepository } from './hearings.repository.js';
import {
  HEARING_ROLES,
  MAX_USER_TURNS,
  MIN_BRIEF_CHARS,
  toHearingDto,
  toHearingSummaryDto,
  type CreateHearingInput,
  type HearingRow,
  type MaterialKind,
} from './hearings.schemas.js';

interface HearingsServiceDeps {
  repository: HearingsRepository;
  simulator: HearingSimulator;
  cases: CasesRepository;
  drafts: DraftsRepository;
  documents: DocumentsRepository;
  reader: DocumentTextReader;
  logger: Logger;
}

/** The brief as it is when the practice starts. */
interface Material {
  kind: MaterialKind;
  title: string;
  text: string;
}

const dossierOf = (row: HearingRow): Dossier => ({
  role: row.role as Dossier['role'],
  materialTitle: row.materialTitle,
  materialText: row.materialText,
  caseContext: row.caseContext,
  position: row.position,
  focus: row.focus,
});

const turnsOf = (row: HearingRow): DialogueTurn[] =>
  [...row.turns].sort((a, b) => a.index - b.index).map((turn) => ({ index: turn.index, speaker: turn.speaker as DialogueTurn['speaker'], content: turn.content }));

/**
 * Practices of an audiencia: the lawyer talks with a judge or the lawyer of the other side, played by the
 * model, and gets feedback at the end. Every turn is saved as soon as it exists, so a failure of the model
 * never loses what she wrote.
 */
export class HearingsService {
  /** Practices that are waiting for the model: a second request on the same one would answer twice. */
  private readonly busy = new Set<string>();

  constructor(private readonly deps: HearingsServiceDeps) {}

  async list() {
    return (await this.deps.repository.list()).map(toHearingSummaryDto);
  }

  async get(id: string) {
    return toHearingDto(await this.load(id));
  }

  async create(input: CreateHearingInput) {
    const { repository, simulator } = this.deps;
    simulator.assertConfigured();

    const material = await this.loadMaterial(input.material);
    const caseContext = input.caseId ? await this.loadCaseContext(input.caseId) : '';
    const title = `${HEARING_ROLES[input.role]} · ${material.title}`.slice(0, 150);

    const id = randomUUID();
    const dossier: Dossier = { role: input.role, materialTitle: material.title, materialText: material.text, caseContext, position: input.position, focus: input.focus };
    // The first thing the character says. If the model fails nothing is saved: there is nothing to retry.
    const opening = await simulator.nextTurn(id, dossier, []);

    const created = await repository.create(
      {
        id,
        title,
        role: input.role,
        caseId: input.caseId ?? null,
        materialKind: material.kind,
        materialTitle: material.title,
        materialText: material.text,
        caseContext,
        position: input.position,
        focus: input.focus,
        model: opening.model,
      },
      { speaker: 'AI', content: opening.content, kind: opening.kind, topic: opening.topic, unverifiedCitations: opening.unverifiedCitations },
    );
    return toHearingDto(created);
  }

  /** The lawyer answers; the character replies. Her answer is saved even if the model fails (then «reply» retries). */
  async sendTurn(id: string, content: string) {
    // Without a model there is nobody to answer: the lawyer's words are not saved for nothing.
    this.deps.simulator.assertConfigured();
    return this.exclusively(id, async () => {
      const row = await this.load(id);
      this.assertActive(row);
      const turns = turnsOf(row);
      if (turns.at(-1)?.speaker === 'USER') {
        throw new ConflictError('Tu última respuesta todavía no tiene contestación: tocá «Reintentar».');
      }
      if (turns.filter((turn) => turn.speaker === 'USER').length >= MAX_USER_TURNS) {
        throw new ConflictError('Llegaste al máximo de respuestas de esta práctica. Terminala para ver la devolución.');
      }

      await this.deps.repository.addTurn(id, turns.length, { speaker: 'USER', content });
      return this.answer(id);
    });
  }

  /** Asks the character to reply to the last answer of the lawyer, when the model failed the first time. */
  async reply(id: string) {
    this.deps.simulator.assertConfigured();
    return this.exclusively(id, async () => {
      const row = await this.load(id);
      this.assertActive(row);
      if (turnsOf(row).at(-1)?.speaker !== 'USER') throw new ConflictError('No hay ninguna respuesta tuya esperando contestación.');
      return this.answer(id);
    });
  }

  /** Ends the practice and writes the feedback. */
  async finish(id: string) {
    return this.exclusively(id, async () => {
      const row = await this.load(id);
      if (row.status === 'FINISHED') return toHearingDto(row);

      const turns = turnsOf(row);
      if (!turns.some((turn) => turn.speaker === 'USER')) {
        throw new BadRequestError('Todavía no respondiste nada, así que no hay qué evaluar. Si no querés seguir, eliminá la práctica.');
      }
      this.deps.simulator.assertConfigured();

      const { feedback, model } = await this.deps.simulator.feedback(id, dossierOf(row), turns);
      return toHearingDto(await this.deps.repository.finish(id, feedback, model));
    });
  }

  async delete(id: string): Promise<void> {
    await this.load(id);
    await this.deps.repository.delete(id);
  }

  // ── Inside ──────────────────────────────────────────────────────────────

  /** The character's next turn, saved. The practice must have its last turn from the lawyer. */
  private async answer(id: string) {
    const { repository, simulator } = this.deps;
    const row = await this.load(id);
    const turns = turnsOf(row);

    const next = await simulator.nextTurn(id, dossierOf(row), turns);
    await repository.addTurn(id, turns.length, { speaker: 'AI', content: next.content, kind: next.kind, topic: next.topic, unverifiedCitations: next.unverifiedCitations }, next.model);
    return toHearingDto(await this.load(id));
  }

  private async load(id: string): Promise<HearingRow> {
    const row = await this.deps.repository.findById(id);
    if (!row) throw new NotFoundError('La práctica no existe o fue eliminada');
    return row;
  }

  private assertActive(row: HearingRow): void {
    if (row.status === 'FINISHED') throw new ConflictError('Esta práctica ya terminó.');
  }

  /** One request at a time per practice: the model takes seconds, and a double click must not make it answer twice. */
  private async exclusively<T>(id: string, work: () => Promise<T>): Promise<T> {
    if (this.busy.has(id)) throw new ConflictError('Ya se está preparando la respuesta. Esperá un momento.');
    this.busy.add(id);
    try {
      return await work();
    } finally {
      this.busy.delete(id);
    }
  }

  private async loadMaterial(input: CreateHearingInput['material']): Promise<Material> {
    const { drafts, documents, reader, logger } = this.deps;

    let material: Material;
    if (input.kind === 'DRAFT') {
      const draft = await drafts.findById(input.id);
      if (!draft) throw new BadRequestError('El borrador elegido no existe o fue eliminado.');
      material = { kind: 'DRAFT', title: draft.title, text: draft.content };
    } else if (input.kind === 'DOCUMENT') {
      const document = await documents.findById(input.id);
      if (!document) throw new BadRequestError('El documento elegido no existe o fue eliminado.');
      if (document.status !== 'READY') {
        throw new BadRequestError(`«${document.title}» ${document.status === 'FAILED' ? 'no se pudo procesar' : 'todavía se está procesando'}.`);
      }
      let text: string;
      try {
        text = (await reader.read(document.id))?.text ?? '';
      } catch (error) {
        logger.error({ err: error, documentId: document.id }, 'Could not read a document to practice with it');
        throw new BadRequestError(`No se pudo leer «${document.title}». Probá con «Reprocesar» en la biblioteca.`);
      }
      material = { kind: 'DOCUMENT', title: document.title, text };
    } else {
      material = { kind: 'TEXT', title: input.title || titleFromText(input.text), text: input.text };
    }

    if (material.text.trim().length < MIN_BRIEF_CHARS) {
      throw new BadRequestError(`No se encontró texto para practicar con «${material.title}».`);
    }
    return { ...material, text: cutMiddle(material.text, MAX_STORED_MATERIAL_CHARS).text };
  }

  /** The carátula and the actuaciones of the expediente, as the character will read them. */
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

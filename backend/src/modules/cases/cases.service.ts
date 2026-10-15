import { BadRequestError, NotFoundError } from '../../lib/errors.js';
import { toDate } from '../calendar/dates.js';
import type { ClientsRepository } from '../clients/clients.repository.js';
import type { DeadlinesRepository, DeadlineWithRelations } from '../deadlines/deadlines.repository.js';
import type { DocumentsRepository } from '../documents/documents.repository.js';
import type { CaseRow, CasesRepository, NewProceeding, ProceedingWithDocument } from './cases.repository.js';
import type {
  CreateCaseInput,
  CreateProceedingInput,
  ListCasesFilters,
  UpdateCaseInput,
  UpdateProceedingInput,
} from './cases.schemas.js';

interface CasesServiceDeps {
  repository: CasesRepository;
  clients: ClientsRepository;
  documents: DocumentsRepository;
  deadlines: DeadlinesRepository;
}

const unique = <T>(values: T[]): T[] => [...new Set(values)];

export class CasesService {
  constructor(private readonly deps: CasesServiceDeps) {}

  async create(input: CreateCaseInput): Promise<CaseRow> {
    const { clientIds, ...data } = input;
    const ids = unique(clientIds);
    await this.assertClientsExist(ids);
    return this.deps.repository.create(data, ids);
  }

  list(filters: ListCasesFilters): Promise<CaseRow[]> {
    return this.deps.repository.list(filters);
  }

  async get(id: string): Promise<CaseRow> {
    const found = await this.deps.repository.findById(id);
    if (!found) throw new NotFoundError('El expediente no existe o fue eliminado');
    return found;
  }

  async update(id: string, input: UpdateCaseInput): Promise<CaseRow> {
    await this.get(id);
    const { clientIds, ...changes } = input;
    const ids = clientIds === undefined ? undefined : unique(clientIds);
    if (ids) await this.assertClientsExist(ids);
    return this.deps.repository.update(id, changes, ids);
  }

  /** Its actuaciones go with it; its deadlines are kept, just without the link (see the Deadline relation). */
  async delete(id: string): Promise<void> {
    await this.get(id);
    await this.deps.repository.delete(id);
  }

  /** Everything the timeline needs: the expediente, its actuaciones and its deadlines. */
  async timeline(id: string): Promise<{
    case: CaseRow;
    proceedings: ProceedingWithDocument[];
    deadlines: DeadlineWithRelations[];
  }> {
    const found = await this.get(id);
    const [proceedings, deadlines] = await Promise.all([
      this.deps.repository.listProceedings(id),
      this.deps.deadlines.list({ caseId: id }),
    ]);
    return { case: found, proceedings, deadlines };
  }

  /** The actuaciones of one reading (or a single one), saved together: all of them or none. */
  async addProceedings(caseId: string, inputs: CreateProceedingInput[]): Promise<ProceedingWithDocument[]> {
    await this.get(caseId);
    await this.assertDocumentsExist(inputs.map((input) => input.documentId));

    // Each new actuación goes after the ones that already are on its day, in the order they came.
    const highest = await this.deps.repository.highestPositionByDate(
      caseId,
      unique(inputs.map((input) => input.date)).map(toDate),
    );
    const items: NewProceeding[] = inputs.map((input) => {
      const position = (highest.get(input.date) ?? 0) + 1;
      highest.set(input.date, position);
      return {
        date: toDate(input.date),
        kind: input.kind,
        title: input.title,
        description: input.description,
        position,
        source: input.source,
        sourceQuote: input.sourceQuote,
        documentId: input.documentId,
      };
    });

    const created = await this.deps.repository.createProceedings(caseId, items);
    await this.deps.repository.touch(caseId);
    return created;
  }

  async updateProceeding(caseId: string, proceedingId: string, input: UpdateProceedingInput): Promise<ProceedingWithDocument> {
    await this.getProceeding(caseId, proceedingId);
    if (input.documentId) await this.assertDocumentsExist([input.documentId]);

    const updated = await this.deps.repository.updateProceeding(proceedingId, {
      ...input,
      date: input.date === undefined ? undefined : toDate(input.date),
    });
    await this.deps.repository.touch(caseId);
    return updated;
  }

  async deleteProceeding(caseId: string, proceedingId: string): Promise<void> {
    await this.getProceeding(caseId, proceedingId);
    await this.deps.repository.deleteProceeding(proceedingId);
    await this.deps.repository.touch(caseId);
  }

  private async getProceeding(caseId: string, proceedingId: string): Promise<ProceedingWithDocument> {
    const found = await this.deps.repository.findProceeding(caseId, proceedingId);
    if (!found) throw new NotFoundError('La actuación no existe o fue eliminada');
    return found;
  }

  private async assertClientsExist(clientIds: string[]): Promise<void> {
    for (const id of clientIds) {
      if (!(await this.deps.clients.findById(id))) {
        throw new BadRequestError('Alguno de los clientes elegidos no existe o fue eliminado.');
      }
    }
  }

  private async assertDocumentsExist(documentIds: Array<string | null>): Promise<void> {
    for (const id of unique(documentIds.filter((documentId): documentId is string => documentId !== null))) {
      if (!(await this.deps.documents.findById(id))) {
        throw new BadRequestError('El documento elegido no existe o fue eliminado.');
      }
    }
  }
}

import type { Contradiction } from '../../generated/prisma/client.js';
import { NotFoundError } from '../../lib/errors.js';
import type { CasesRepository } from '../cases/cases.repository.js';
import type { DocumentsRepository } from '../documents/documents.repository.js';
import type { ContradictionsRepository } from './contradictions.repository.js';
import { parseStatements, toContradictionDto, type ContradictionDto, type CreateFindingInput } from './contradictions.schemas.js';

interface ContradictionsServiceDeps {
  repository: ContradictionsRepository;
  cases: CasesRepository;
  documents: DocumentsRepository;
}

/** The findings the lawyer confirmed for an expediente. */
export class ContradictionsService {
  constructor(private readonly deps: ContradictionsServiceDeps) {}

  async list(caseId: string): Promise<ContradictionDto[]> {
    await this.assertCaseExists(caseId);
    return this.withDocuments(await this.deps.repository.list(caseId));
  }

  /** The findings of one reading, saved together: all of them or none. */
  async addMany(caseId: string, items: CreateFindingInput[]): Promise<ContradictionDto[]> {
    await this.assertCaseExists(caseId);
    return this.withDocuments(await this.deps.repository.createMany(caseId, items));
  }

  async updateNote(caseId: string, id: string, note: string): Promise<ContradictionDto> {
    await this.get(caseId, id);
    const [updated] = await this.withDocuments([await this.deps.repository.updateNote(id, note)]);
    return updated!;
  }

  async delete(caseId: string, id: string): Promise<void> {
    await this.get(caseId, id);
    await this.deps.repository.delete(id);
  }

  private async get(caseId: string, id: string): Promise<Contradiction> {
    const found = await this.deps.repository.findById(caseId, id);
    if (!found) throw new NotFoundError('La contradicción no existe o fue eliminada');
    return found;
  }

  private async assertCaseExists(caseId: string): Promise<void> {
    if (!(await this.deps.cases.exists(caseId))) throw new NotFoundError('El expediente no existe o fue eliminado');
  }

  /** Adds how each document is named now (and whether it still exists) to the statements. */
  private async withDocuments(rows: Contradiction[]): Promise<ContradictionDto[]> {
    const ids = [...new Set(rows.flatMap((row) => parseStatements(row.statements).map((statement) => statement.documentId)))];
    const titles = await this.deps.documents.findTitles(ids);
    return rows.map((row) => toContradictionDto(row, titles));
  }
}

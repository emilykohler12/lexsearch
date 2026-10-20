import { randomUUID } from 'node:crypto';
import { BadRequestError, NotFoundError } from '../../lib/errors.js';
import type { CasesRepository } from '../cases/cases.repository.js';
import { recountEstimate } from './estimate-analysis.js';
import type { EstimatesRepository } from './estimates.repository.js';
import { toEstimateDto, toEstimateSummaryDto, type SaveEstimateInput } from './estimates.schemas.js';

interface EstimatesServiceDeps {
  repository: EstimatesRepository;
  cases: CasesRepository;
}

/** Estimates the lawyer chose to keep. The analysis itself saves nothing (see EstimateAnalysisService). */
export class EstimatesService {
  constructor(private readonly deps: EstimatesServiceDeps) {}

  async list() {
    return (await this.deps.repository.list()).map(toEstimateSummaryDto);
  }

  async get(id: string) {
    return toEstimateDto(await this.load(id));
  }

  async save(input: SaveEstimateInput) {
    const { repository, cases } = this.deps;
    if (input.caseId && !(await cases.findById(input.caseId))) throw new BadRequestError('El expediente elegido no existe o fue eliminado.');
    const title = input.title || input.claim || input.facts.replace(/\s+/g, ' ').slice(0, 80) || `Estimación ${randomUUID().slice(0, 8)}`;
    const created = await repository.create({
      title: title.slice(0, 150),
      facts: input.facts,
      claim: input.claim,
      caseId: input.caseId ?? null,
      result: recountEstimate(input.result),
      model: input.model || null,
    });
    return toEstimateDto(created);
  }

  async updateNote(id: string, note: string) {
    await this.load(id);
    return toEstimateDto(await this.deps.repository.updateNote(id, note));
  }

  async delete(id: string): Promise<void> {
    await this.load(id);
    await this.deps.repository.delete(id);
  }

  private async load(id: string) {
    const row = await this.deps.repository.findById(id);
    if (!row) throw new NotFoundError('La estimación no existe o fue eliminada');
    return row;
  }
}

import type { Prisma, PrismaClient } from '../../generated/prisma/client.js';
import type { EstimateResult, EstimateRow } from './estimates.schemas.js';

const linkedCase = { select: { id: true, title: true } } as const;

export interface NewEstimate {
  title: string;
  facts: string;
  claim: string;
  caseId: string | null;
  result: EstimateResult;
  model: string | null;
}

export class EstimatesRepository {
  constructor(private readonly db: PrismaClient) {}

  create(data: NewEstimate): Promise<EstimateRow> {
    return this.db.outcomeEstimate.create({ data: { ...data, result: data.result as unknown as Prisma.InputJsonValue }, include: { case: linkedCase } });
  }

  list(limit = 100): Promise<EstimateRow[]> {
    return this.db.outcomeEstimate.findMany({ include: { case: linkedCase }, orderBy: { updatedAt: 'desc' }, take: limit });
  }

  findById(id: string): Promise<EstimateRow | null> {
    return this.db.outcomeEstimate.findUnique({ where: { id }, include: { case: linkedCase } });
  }

  updateNote(id: string, note: string): Promise<EstimateRow> {
    return this.db.outcomeEstimate.update({ where: { id }, data: { note }, include: { case: linkedCase } });
  }

  async delete(id: string): Promise<void> {
    await this.db.outcomeEstimate.delete({ where: { id } });
  }
}

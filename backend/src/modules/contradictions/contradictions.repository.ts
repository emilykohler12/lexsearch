import type { Contradiction, Prisma, PrismaClient } from '../../generated/prisma/client.js';
import type { CreateFindingInput } from './contradictions.schemas.js';

export class ContradictionsRepository {
  constructor(private readonly db: PrismaClient) {}

  /** In the order they were confirmed (and, within one reading, in the order they were proposed). */
  list(caseId: string): Promise<Contradiction[]> {
    return this.db.contradiction.findMany({ where: { caseId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
  }

  /** All or none: the findings of one reading are saved together. */
  createMany(caseId: string, items: CreateFindingInput[]): Promise<Contradiction[]> {
    // A transaction stamps every row with the same time: a millisecond apart keeps their order.
    const start = Date.now();
    return this.db.$transaction(
      items.map((item, index) =>
        this.db.contradiction.create({
          data: {
            caseId,
            createdAt: new Date(start + index),
            kind: item.kind,
            confidence: item.confidence,
            title: item.title,
            explanation: item.explanation,
            statements: item.statements as Prisma.InputJsonValue,
            note: item.note,
          },
        }),
      ),
    );
  }

  findById(caseId: string, id: string): Promise<Contradiction | null> {
    return this.db.contradiction.findFirst({ where: { id, caseId } });
  }

  updateNote(id: string, note: string): Promise<Contradiction> {
    return this.db.contradiction.update({ where: { id }, data: { note } });
  }

  async delete(id: string): Promise<void> {
    await this.db.contradiction.delete({ where: { id } });
  }
}

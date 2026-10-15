import type { Prisma, PrismaClient } from '../../generated/prisma/client.js';

/** Enough of the client to show and link its name next to the deadline. */
const clientSummary = { select: { id: true, fullName: true } } as const;
/** Enough of the expediente to show and link it next to the deadline. */
const caseSummary = { select: { id: true, title: true, number: true } } as const;
const relations = { client: clientSummary, case: caseSummary } as const;

export type DeadlineWithRelations = Prisma.DeadlineGetPayload<{ include: typeof relations }>;

export interface NewDeadline {
  title: string;
  caseReference: string;
  notes: string;
  clientId: string | null;
  caseId: string | null;
  notificationDate: Date;
  days: number;
  dayType: string;
  dueDate: Date;
  sourceQuote: string;
}

export interface DeadlineChanges {
  title?: string | undefined;
  caseReference?: string | undefined;
  notes?: string | undefined;
  clientId?: string | null | undefined;
  caseId?: string | null | undefined;
  notificationDate?: Date | undefined;
  days?: number | undefined;
  dayType?: string | undefined;
  dueDate?: Date | undefined;
  status?: string | undefined;
  completedAt?: Date | null | undefined;
  sourceQuote?: string | undefined;
}

export class DeadlinesRepository {
  constructor(private readonly db: PrismaClient) {}

  create(data: NewDeadline): Promise<DeadlineWithRelations> {
    return this.db.deadline.create({ data, include: relations });
  }

  /** All or none: a document's terms are saved together. */
  createMany(items: NewDeadline[]): Promise<DeadlineWithRelations[]> {
    return this.db.$transaction(items.map((data) => this.db.deadline.create({ data, include: relations })));
  }

  /** Soonest due date first. */
  list(
    filters: { status?: string | undefined; clientId?: string | undefined; caseId?: string | undefined } = {},
  ): Promise<DeadlineWithRelations[]> {
    return this.db.deadline.findMany({
      where: { status: filters.status, clientId: filters.clientId, caseId: filters.caseId },
      orderBy: [{ dueDate: 'asc' }, { createdAt: 'asc' }],
      include: relations,
    });
  }

  /** Pending deadlines due on that day or earlier (overdue ones included). */
  listPendingDueBy(date: Date): Promise<DeadlineWithRelations[]> {
    return this.db.deadline.findMany({
      where: { status: 'PENDING', dueDate: { lte: date } },
      orderBy: { dueDate: 'asc' },
      include: relations,
    });
  }

  findById(id: string): Promise<DeadlineWithRelations | null> {
    return this.db.deadline.findUnique({ where: { id }, include: relations });
  }

  update(id: string, data: DeadlineChanges): Promise<DeadlineWithRelations> {
    return this.db.deadline.update({ where: { id }, data, include: relations });
  }

  async delete(id: string): Promise<void> {
    await this.db.deadline.delete({ where: { id } });
  }
}

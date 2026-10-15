import type { Prisma, PrismaClient } from '../../generated/prisma/client.js';

/** Enough of the client to show and link its name next to the deadline. */
const clientSummary = { select: { id: true, fullName: true } } as const;

export type DeadlineWithClient = Prisma.DeadlineGetPayload<{ include: { client: typeof clientSummary } }>;

export interface NewDeadline {
  title: string;
  caseReference: string;
  notes: string;
  clientId: string | null;
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

  create(data: NewDeadline): Promise<DeadlineWithClient> {
    return this.db.deadline.create({ data, include: { client: clientSummary } });
  }

  /** All or none: a document's terms are saved together. */
  createMany(items: NewDeadline[]): Promise<DeadlineWithClient[]> {
    return this.db.$transaction(items.map((data) => this.db.deadline.create({ data, include: { client: clientSummary } })));
  }

  /** Soonest due date first. */
  list(filters: { status?: string | undefined; clientId?: string | undefined } = {}): Promise<DeadlineWithClient[]> {
    return this.db.deadline.findMany({
      where: { status: filters.status, clientId: filters.clientId },
      orderBy: [{ dueDate: 'asc' }, { createdAt: 'asc' }],
      include: { client: clientSummary },
    });
  }

  /** Pending deadlines due on that day or earlier (overdue ones included). */
  listPendingDueBy(date: Date): Promise<DeadlineWithClient[]> {
    return this.db.deadline.findMany({
      where: { status: 'PENDING', dueDate: { lte: date } },
      orderBy: { dueDate: 'asc' },
      include: { client: clientSummary },
    });
  }

  findById(id: string): Promise<DeadlineWithClient | null> {
    return this.db.deadline.findUnique({ where: { id }, include: { client: clientSummary } });
  }

  update(id: string, data: DeadlineChanges): Promise<DeadlineWithClient> {
    return this.db.deadline.update({ where: { id }, data, include: { client: clientSummary } });
  }

  async delete(id: string): Promise<void> {
    await this.db.deadline.delete({ where: { id } });
  }
}

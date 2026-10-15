import type { Prisma, PrismaClient } from '../../generated/prisma/client.js';
import { toDate, toIsoDate, todayInArgentina } from '../calendar/dates.js';

/** Everything the lists and the header of an expediente show, in one query. */
const caseInclude = {
  clients: { select: { client: { select: { id: true, fullName: true } } } },
  _count: { select: { proceedings: true } },
  /** Only the latest one: its date says when the expediente last moved. */
  proceedings: { select: { date: true }, orderBy: { date: 'desc' }, take: 1 },
  /** Pending deadlines, soonest first. */
  deadlines: {
    where: { status: 'PENDING' },
    orderBy: [{ dueDate: 'asc' }, { createdAt: 'asc' }],
    select: { id: true, title: true, dueDate: true, status: true },
  },
} satisfies Prisma.CaseInclude;

export type CaseRow = Prisma.CaseGetPayload<{ include: typeof caseInclude }>;

/**
 * The same, but the latest actuación counts only if it already happened: a hearing scheduled for
 * next month is not the last movement. "Today" is Argentina's, not the server's.
 */
function caseIncludeNow() {
  return {
    ...caseInclude,
    proceedings: { ...caseInclude.proceedings, where: { date: { lte: toDate(todayInArgentina()) } } },
  } satisfies Prisma.CaseInclude;
}

/** Enough of the document to show and open it next to the actuación. */
const documentSummary = { select: { id: true, title: true } } as const;

export type ProceedingWithDocument = Prisma.ProceedingGetPayload<{ include: { document: typeof documentSummary } }>;

export interface NewCase {
  title: string;
  number: string;
  court: string;
  practiceArea: string | null;
  status: string;
  notes: string;
}

export interface CaseChanges {
  title?: string | undefined;
  number?: string | undefined;
  court?: string | undefined;
  practiceArea?: string | null | undefined;
  status?: string | undefined;
  notes?: string | undefined;
}

export interface NewProceeding {
  date: Date;
  kind: string;
  title: string;
  description: string;
  position: number;
  source: string;
  sourceQuote: string;
  documentId: string | null;
}

export interface ProceedingChanges {
  date?: Date | undefined;
  kind?: string | undefined;
  title?: string | undefined;
  description?: string | undefined;
  documentId?: string | null | undefined;
  sourceQuote?: string | undefined;
}

export class CasesRepository {
  constructor(private readonly db: PrismaClient) {}

  create(data: NewCase, clientIds: string[]): Promise<CaseRow> {
    return this.db.case.create({
      data: { ...data, clients: { create: clientIds.map((clientId) => ({ clientId })) } },
      include: caseIncludeNow(),
    });
  }

  /** Most recently touched first. */
  list(filters: { status?: string | undefined; clientId?: string | undefined } = {}): Promise<CaseRow[]> {
    return this.db.case.findMany({
      where: {
        status: filters.status,
        ...(filters.clientId && { clients: { some: { clientId: filters.clientId } } }),
      },
      orderBy: { updatedAt: 'desc' },
      include: caseIncludeNow(),
    });
  }

  findById(id: string): Promise<CaseRow | null> {
    return this.db.case.findUnique({ where: { id }, include: caseIncludeNow() });
  }

  /** `clientIds` replaces the whole list of clients when given. */
  update(id: string, changes: CaseChanges, clientIds?: string[]): Promise<CaseRow> {
    return this.db.case.update({
      where: { id },
      data: {
        ...changes,
        ...(clientIds && { clients: { deleteMany: {}, create: clientIds.map((clientId) => ({ clientId })) } }),
      },
      include: caseIncludeNow(),
    });
  }

  async delete(id: string): Promise<void> {
    await this.db.case.delete({ where: { id } });
  }

  /** Marks the expediente as touched: the list shows the ones with recent movement first. */
  async touch(id: string): Promise<void> {
    await this.db.case.update({ where: { id }, data: { updatedAt: new Date() } });
  }

  /** In timeline order: by date, then by position within the day. */
  listProceedings(caseId: string): Promise<ProceedingWithDocument[]> {
    return this.db.proceeding.findMany({
      where: { caseId },
      orderBy: [{ date: 'asc' }, { position: 'asc' }, { createdAt: 'asc' }],
      include: { document: documentSummary },
    });
  }

  findProceeding(caseId: string, id: string): Promise<ProceedingWithDocument | null> {
    return this.db.proceeding.findFirst({ where: { id, caseId }, include: { document: documentSummary } });
  }

  /** All or none: the actuaciones of one reading are saved together. */
  createProceedings(caseId: string, items: NewProceeding[]): Promise<ProceedingWithDocument[]> {
    return this.db.$transaction(
      items.map((item) => this.db.proceeding.create({ data: { ...item, caseId }, include: { document: documentSummary } })),
    );
  }

  updateProceeding(id: string, changes: ProceedingChanges): Promise<ProceedingWithDocument> {
    return this.db.proceeding.update({ where: { id }, data: changes, include: { document: documentSummary } });
  }

  async deleteProceeding(id: string): Promise<void> {
    await this.db.proceeding.delete({ where: { id } });
  }

  /** The highest position used on each of those days (by ISO date), to put new actuaciones after them. */
  async highestPositionByDate(caseId: string, dates: Date[]): Promise<Map<string, number>> {
    const rows = await this.db.proceeding.groupBy({
      by: ['date'],
      where: { caseId, date: { in: dates } },
      _max: { position: true },
    });
    return new Map(rows.map((row) => [toIsoDate(row.date), row._max.position ?? 0]));
  }
}

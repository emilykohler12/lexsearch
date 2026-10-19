import type { HearingTurn, Prisma, PrismaClient } from '../../generated/prisma/client.js';
import type { HearingListRow, HearingRow, HearingFeedback } from './hearings.schemas.js';

/** The expediente a practice is linked to: just enough to name it. */
const linkedCase = { select: { id: true, title: true } } as const;

export interface NewHearing {
  id: string;
  title: string;
  role: string;
  caseId: string | null;
  materialKind: string;
  materialTitle: string;
  materialText: string;
  caseContext: string;
  position: string;
  focus: string;
  model: string | null;
}

export interface NewTurn {
  speaker: 'AI' | 'USER';
  content: string;
  kind?: string;
  topic?: string;
  unverifiedCitations?: string[];
}

export class HearingsRepository {
  constructor(private readonly db: PrismaClient) {}

  /** Creates the practice with its first turn (the opening of the hearing). */
  create(data: NewHearing, opening: NewTurn): Promise<HearingRow> {
    return this.db.hearingSimulation.create({
      data: { ...data, turns: { create: { index: 0, ...opening } } },
      include: { case: linkedCase, turns: true },
    });
  }

  list(limit = 100): Promise<HearingListRow[]> {
    return this.db.hearingSimulation.findMany({
      include: { case: linkedCase, _count: { select: { turns: true } } },
      orderBy: { updatedAt: 'desc' },
      take: limit,
    });
  }

  findById(id: string): Promise<HearingRow | null> {
    return this.db.hearingSimulation.findUnique({ where: { id }, include: { case: linkedCase, turns: { orderBy: { index: 'asc' } } } });
  }

  /** Adds the next turn of the conversation. The unique (practice, index) makes two turns at once impossible. */
  async addTurn(simulationId: string, index: number, turn: NewTurn, model?: string): Promise<HearingTurn> {
    const [created] = await this.db.$transaction([
      this.db.hearingTurn.create({ data: { simulationId, index, ...turn } }),
      this.db.hearingSimulation.update({ where: { id: simulationId }, data: { updatedAt: new Date(), ...(model && { model }) } }),
    ]);
    return created;
  }

  /** Closes the practice with its feedback. */
  finish(id: string, feedback: HearingFeedback, model: string): Promise<HearingRow> {
    return this.db.hearingSimulation.update({
      where: { id },
      data: { status: 'FINISHED', feedback: feedback as unknown as Prisma.InputJsonValue, model, finishedAt: new Date() },
      include: { case: linkedCase, turns: { orderBy: { index: 'asc' } } },
    });
  }

  async delete(id: string): Promise<void> {
    await this.db.hearingSimulation.delete({ where: { id } });
  }
}

import type { AgentInteraction, InteractionStatus, Prisma, PrismaClient } from '../../generated/prisma/client.js';

export interface NewInteraction {
  module: string;
  input: Prisma.InputJsonValue;
  context?: Prisma.InputJsonValue | undefined;
  output?: Prisma.InputJsonValue | undefined;
  model?: string | undefined;
  promptVersion?: string | undefined;
  inputTokens?: number | undefined;
  outputTokens?: number | undefined;
  durationMs?: number | undefined;
  status: InteractionStatus;
  errorMessage?: string | undefined;
}

export class InteractionsRepository {
  constructor(private readonly db: PrismaClient) {}

  create(data: NewInteraction): Promise<AgentInteraction> {
    return this.db.agentInteraction.create({ data });
  }

  list(filters: { module?: string | undefined; limit: number }): Promise<AgentInteraction[]> {
    return this.db.agentInteraction.findMany({
      where: { module: filters.module },
      orderBy: { createdAt: 'desc' },
      take: filters.limit,
    });
  }

  findById(id: string): Promise<AgentInteraction | null> {
    return this.db.agentInteraction.findUnique({ where: { id } });
  }
}

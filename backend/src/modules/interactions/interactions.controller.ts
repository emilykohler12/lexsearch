import type { Request, Response } from 'express';
import { z } from 'zod';
import type { AgentInteraction } from '../../generated/prisma/client.js';
import { NotFoundError } from '../../lib/errors.js';
import { parseInput, uuidParamsSchema } from '../../lib/validation.js';
import type { InteractionsRepository } from './interactions.repository.js';

const listQuerySchema = z.object({
  module: z.string().max(50).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

/** Summary for the history list; the full record is fetched by id. */
function toSummary(interaction: AgentInteraction) {
  const input = interaction.input as { question?: unknown } | null;
  return {
    id: interaction.id,
    module: interaction.module,
    question: typeof input?.question === 'string' ? input.question : null,
    status: interaction.status,
    model: interaction.model,
    durationMs: interaction.durationMs,
    createdAt: interaction.createdAt,
  };
}

export class InteractionsController {
  constructor(private readonly repository: InteractionsRepository) {}

  list = async (req: Request, res: Response) => {
    const filters = parseInput(listQuerySchema, req.query);
    const interactions = await this.repository.list(filters);
    res.json({ interactions: interactions.map(toSummary) });
  };

  get = async (req: Request, res: Response) => {
    const { id } = parseInput(uuidParamsSchema, req.params);
    const interaction = await this.repository.findById(id);
    if (!interaction) throw new NotFoundError('La consulta no existe');
    res.json({ interaction });
  };
}

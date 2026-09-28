import type { Request, Response } from 'express';
import { parseInput } from '../../lib/validation.js';
import { askBodySchema, searchBodySchema } from './rag.schemas.js';
import type { RagService } from './rag.service.js';

export class RagController {
  constructor(private readonly service: RagService) {}

  search = async (req: Request, res: Response) => {
    const input = parseInput(searchBodySchema, req.body);
    res.json({ results: await this.service.search(input) });
  };

  ask = async (req: Request, res: Response) => {
    const input = parseInput(askBodySchema, req.body);
    res.json(await this.service.ask(input));
  };
}

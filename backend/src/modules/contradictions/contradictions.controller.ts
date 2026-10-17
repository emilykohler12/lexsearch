import type { Request, Response } from 'express';
import { parseInput, uuidParamsSchema } from '../../lib/validation.js';
import type { ContradictionAnalysisService } from './contradiction-analysis.service.js';
import { analyzeSchema, createFindingsBatchSchema, findingParamsSchema, updateFindingSchema } from './contradictions.schemas.js';
import type { ContradictionsService } from './contradictions.service.js';

export class ContradictionsController {
  constructor(
    private readonly service: ContradictionsService,
    private readonly analysis: ContradictionAnalysisService,
  ) {}

  list = async (req: Request, res: Response) => {
    const { id } = parseInput(uuidParamsSchema, req.params);
    res.json({ contradictions: await this.service.list(id) });
  };

  create = async (req: Request, res: Response) => {
    const { id } = parseInput(uuidParamsSchema, req.params);
    const { items } = parseInput(createFindingsBatchSchema, req.body);
    res.status(201).json({ contradictions: await this.service.addMany(id, items) });
  };

  updateNote = async (req: Request, res: Response) => {
    const { id, contradictionId } = parseInput(findingParamsSchema, req.params);
    const { note } = parseInput(updateFindingSchema, req.body);
    res.json({ contradiction: await this.service.updateNote(id, contradictionId, note) });
  };

  delete = async (req: Request, res: Response) => {
    const { id, contradictionId } = parseInput(findingParamsSchema, req.params);
    await this.service.delete(id, contradictionId);
    res.status(204).end();
  };

  /** Compares the chosen documents and proposes the contradictions between them; saves nothing. */
  analyze = async (req: Request, res: Response) => {
    const { id } = parseInput(uuidParamsSchema, req.params);
    const input = parseInput(analyzeSchema, req.body);
    res.json({ proposal: await this.analysis.analyze(id, input) });
  };
}

import type { Request, Response } from 'express';
import { parseInput, uuidParamsSchema } from '../../lib/validation.js';
import type { EstimateAnalysisService } from './estimate-analysis.service.js';
import { analyzeEstimateSchema, saveEstimateSchema, updateEstimateSchema } from './estimates.schemas.js';
import type { EstimatesService } from './estimates.service.js';

export class EstimatesController {
  constructor(
    private readonly service: EstimatesService,
    private readonly analysis: EstimateAnalysisService,
  ) {}

  list = async (_req: Request, res: Response) => {
    res.json({ estimates: await this.service.list() });
  };

  get = async (req: Request, res: Response) => {
    const { id } = parseInput(uuidParamsSchema, req.params);
    res.json({ estimate: await this.service.get(id) });
  };

  /** A proposal: nothing is saved. */
  analyze = async (req: Request, res: Response) => {
    res.json({ proposal: await this.analysis.analyze(parseInput(analyzeEstimateSchema, req.body)) });
  };

  save = async (req: Request, res: Response) => {
    res.status(201).json({ estimate: await this.service.save(parseInput(saveEstimateSchema, req.body)) });
  };

  updateNote = async (req: Request, res: Response) => {
    const { id } = parseInput(uuidParamsSchema, req.params);
    const { note } = parseInput(updateEstimateSchema, req.body);
    res.json({ estimate: await this.service.updateNote(id, note) });
  };

  delete = async (req: Request, res: Response) => {
    const { id } = parseInput(uuidParamsSchema, req.params);
    await this.service.delete(id);
    res.status(204).end();
  };
}

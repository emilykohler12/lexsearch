import type { Request, Response } from 'express';
import { BadRequestError } from '../../lib/errors.js';
import { parseInput, uuidParamsSchema } from '../../lib/validation.js';
import { todayInArgentina } from '../calendar/dates.js';
import type { DeadlineAnalysisService } from './deadline-analysis.service.js';
import {
  calculateSchema,
  createDeadlineSchema,
  createDeadlinesBatchSchema,
  listDeadlinesQuerySchema,
  toDeadlineDto,
  updateDeadlineSchema,
} from './deadlines.schemas.js';
import type { DeadlinesService } from './deadlines.service.js';

export class DeadlinesController {
  constructor(
    private readonly service: DeadlinesService,
    private readonly analysis: DeadlineAnalysisService,
  ) {}

  list = async (req: Request, res: Response) => {
    const filters = parseInput(listDeadlinesQuerySchema, req.query);
    const deadlines = await this.service.list(filters);
    const today = todayInArgentina();
    res.json({ today, deadlines: deadlines.map((deadline) => toDeadlineDto(deadline, today)) });
  };

  get = async (req: Request, res: Response) => {
    const { id } = parseInput(uuidParamsSchema, req.params);
    const deadline = await this.service.get(id);
    res.json({
      deadline: toDeadlineDto(deadline, todayInArgentina()),
      calculation: { skipped: await this.service.explain(deadline) },
    });
  };

  create = async (req: Request, res: Response) => {
    const input = parseInput(createDeadlineSchema, req.body);
    res.status(201).json({ deadline: toDeadlineDto(await this.service.create(input), todayInArgentina()) });
  };

  createBatch = async (req: Request, res: Response) => {
    const { items } = parseInput(createDeadlinesBatchSchema, req.body);
    const today = todayInArgentina();
    const deadlines = await this.service.createMany(items);
    res.status(201).json({ deadlines: deadlines.map((deadline) => toDeadlineDto(deadline, today)) });
  };

  update = async (req: Request, res: Response) => {
    const { id } = parseInput(uuidParamsSchema, req.params);
    const input = parseInput(updateDeadlineSchema, req.body);
    res.json({ deadline: toDeadlineDto(await this.service.update(id, input), todayInArgentina()) });
  };

  delete = async (req: Request, res: Response) => {
    const { id } = parseInput(uuidParamsSchema, req.params);
    await this.service.delete(id);
    res.status(204).end();
  };

  calculate = async (req: Request, res: Response) => {
    const input = parseInput(calculateSchema, req.body);
    res.json(await this.service.calculate(input));
  };

  analyze = async (req: Request, res: Response) => {
    const file = req.file;
    if (!file) throw new BadRequestError('No se recibió ningún archivo (campo "file")');
    const proposal = await this.analysis.analyze({
      tempPath: file.path,
      originalName: file.originalname,
      sizeBytes: file.size,
    });
    res.json({ proposal });
  };
}

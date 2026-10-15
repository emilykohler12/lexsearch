import { rm } from 'node:fs/promises';
import type { Request, Response } from 'express';
import { parseInput, uuidParamsSchema } from '../../lib/validation.js';
import { todayInArgentina } from '../calendar/dates.js';
import { toDeadlineDto } from '../deadlines/deadlines.schemas.js';
import { buildTimeline } from './case-timeline.js';
import {
  analyzeTextSchema,
  caseProceedingParamsSchema,
  createCaseSchema,
  createProceedingSchema,
  createProceedingsBatchSchema,
  listCasesQuerySchema,
  toCaseDto,
  toCaseSummaryDto,
  toProceedingDto,
  updateCaseSchema,
  updateProceedingSchema,
} from './cases.schemas.js';
import type { CasesService } from './cases.service.js';
import type { AnalysisSource, ProceedingAnalysisService } from './proceeding-analysis.service.js';

export class CasesController {
  constructor(
    private readonly service: CasesService,
    private readonly analysis: ProceedingAnalysisService,
  ) {}

  list = async (req: Request, res: Response) => {
    const filters = parseInput(listCasesQuerySchema, req.query);
    const today = todayInArgentina();
    const cases = await this.service.list(filters);
    res.json({ today, cases: cases.map((row) => toCaseSummaryDto(row, today)) });
  };

  create = async (req: Request, res: Response) => {
    const input = parseInput(createCaseSchema, req.body);
    res.status(201).json({ case: toCaseDto(await this.service.create(input), todayInArgentina()) });
  };

  get = async (req: Request, res: Response) => {
    const { id } = parseInput(uuidParamsSchema, req.params);
    res.json({ case: toCaseDto(await this.service.get(id), todayInArgentina()) });
  };

  update = async (req: Request, res: Response) => {
    const { id } = parseInput(uuidParamsSchema, req.params);
    const input = parseInput(updateCaseSchema, req.body);
    res.json({ case: toCaseDto(await this.service.update(id, input), todayInArgentina()) });
  };

  delete = async (req: Request, res: Response) => {
    const { id } = parseInput(uuidParamsSchema, req.params);
    await this.service.delete(id);
    res.status(204).end();
  };

  timeline = async (req: Request, res: Response) => {
    const { id } = parseInput(uuidParamsSchema, req.params);
    const today = todayInArgentina();
    const { case: found, proceedings, deadlines } = await this.service.timeline(id);
    res.json({
      today,
      case: toCaseDto(found, today),
      items: buildTimeline(
        proceedings.map(toProceedingDto),
        deadlines.map((deadline) => toDeadlineDto(deadline, today)),
      ),
    });
  };

  createProceeding = async (req: Request, res: Response) => {
    const { id } = parseInput(uuidParamsSchema, req.params);
    const input = parseInput(createProceedingSchema, req.body);
    const [created] = await this.service.addProceedings(id, [input]);
    res.status(201).json({ proceeding: toProceedingDto(created!) });
  };

  createProceedings = async (req: Request, res: Response) => {
    const { id } = parseInput(uuidParamsSchema, req.params);
    const { items } = parseInput(createProceedingsBatchSchema, req.body);
    const created = await this.service.addProceedings(id, items);
    res.status(201).json({ proceedings: created.map(toProceedingDto) });
  };

  updateProceeding = async (req: Request, res: Response) => {
    const { id, proceedingId } = parseInput(caseProceedingParamsSchema, req.params);
    const input = parseInput(updateProceedingSchema, req.body);
    res.json({ proceeding: toProceedingDto(await this.service.updateProceeding(id, proceedingId, input)) });
  };

  deleteProceeding = async (req: Request, res: Response) => {
    const { id, proceedingId } = parseInput(caseProceedingParamsSchema, req.params);
    await this.service.deleteProceeding(id, proceedingId);
    res.status(204).end();
  };

  /** Reads a text (pasted, or the file sent in the `file` field) and proposes its actuaciones. */
  analyze = async (req: Request, res: Response) => {
    const file = req.file;
    try {
      const { id } = parseInput(uuidParamsSchema, req.params);
      const source: AnalysisSource = file
        ? { kind: 'file', file: { tempPath: file.path, originalName: file.originalname, sizeBytes: file.size } }
        : { kind: 'text', text: parseInput(analyzeTextSchema, req.body).text };
      res.json({ proposal: await this.analysis.analyze(id, source) });
    } finally {
      // The service deletes it too; this covers a request that fails validation before reaching it.
      if (file) await rm(file.path, { force: true });
    }
  };
}

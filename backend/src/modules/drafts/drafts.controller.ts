import type { Request, Response } from 'express';
import { parseInput, uuidParamsSchema } from '../../lib/validation.js';
import {
  createDraftSchema,
  listDraftsQuerySchema,
  toDraftDto,
  toDraftSummaryDto,
  updateDraftSchema,
} from './drafts.schemas.js';
import type { DraftsService } from './drafts.service.js';

export class DraftsController {
  constructor(private readonly service: DraftsService) {}

  create = async (req: Request, res: Response) => {
    const input = parseInput(createDraftSchema, req.body);
    res.status(201).json({ draft: toDraftDto(await this.service.create(input)) });
  };

  list = async (req: Request, res: Response) => {
    const filters = parseInput(listDraftsQuerySchema, req.query);
    const drafts = await this.service.list(filters);
    res.json({ drafts: drafts.map(toDraftSummaryDto) });
  };

  get = async (req: Request, res: Response) => {
    const { id } = parseInput(uuidParamsSchema, req.params);
    res.json({ draft: toDraftDto(await this.service.get(id)) });
  };

  update = async (req: Request, res: Response) => {
    const { id } = parseInput(uuidParamsSchema, req.params);
    const data = parseInput(updateDraftSchema, req.body);
    res.json({ draft: toDraftDto(await this.service.update(id, data)) });
  };

  delete = async (req: Request, res: Response) => {
    const { id } = parseInput(uuidParamsSchema, req.params);
    await this.service.delete(id);
    res.status(204).end();
  };

  downloadDocx = async (req: Request, res: Response) => {
    const { id } = parseInput(uuidParamsSchema, req.params);
    const { fileName, data } = await this.service.exportDocx(id);
    const asciiName = fileName.replace(/[^\x20-\x7E]/g, '_').replace(/"/g, '');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
    );
    res.type('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.send(data);
  };
}

import type { Request, Response } from 'express';
import { parseInput, uuidParamsSchema } from '../../lib/validation.js';
import {
  analyzeNotesSchema,
  createClientSchema,
  toClientDto,
  toClientSummaryDto,
  updateClientSchema,
} from './clients.schemas.js';
import type { ClientsService } from './clients.service.js';

export class ClientsController {
  constructor(private readonly service: ClientsService) {}

  create = async (req: Request, res: Response) => {
    const input = parseInput(createClientSchema, req.body);
    res.status(201).json({ client: toClientDto(await this.service.create(input)) });
  };

  list = async (_req: Request, res: Response) => {
    const clients = await this.service.list();
    res.json({ clients: clients.map(toClientSummaryDto) });
  };

  get = async (req: Request, res: Response) => {
    const { id } = parseInput(uuidParamsSchema, req.params);
    res.json({ client: toClientDto(await this.service.get(id)) });
  };

  update = async (req: Request, res: Response) => {
    const { id } = parseInput(uuidParamsSchema, req.params);
    const data = parseInput(updateClientSchema, req.body);
    res.json({ client: toClientDto(await this.service.update(id, data)) });
  };

  delete = async (req: Request, res: Response) => {
    const { id } = parseInput(uuidParamsSchema, req.params);
    await this.service.delete(id);
    res.status(204).end();
  };

  analyzeNotes = async (req: Request, res: Response) => {
    const { notes } = parseInput(analyzeNotesSchema, req.body);
    res.json({ proposal: await this.service.analyzeNotes(notes) });
  };
}

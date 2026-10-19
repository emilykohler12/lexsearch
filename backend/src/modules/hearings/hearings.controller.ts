import type { Request, Response } from 'express';
import { parseInput, uuidParamsSchema } from '../../lib/validation.js';
import { createHearingSchema, sendTurnSchema } from './hearings.schemas.js';
import type { HearingsService } from './hearings.service.js';

export class HearingsController {
  constructor(private readonly service: HearingsService) {}

  list = async (_req: Request, res: Response) => {
    res.json({ hearings: await this.service.list() });
  };

  get = async (req: Request, res: Response) => {
    const { id } = parseInput(uuidParamsSchema, req.params);
    res.json({ hearing: await this.service.get(id) });
  };

  /** Starts a practice: the character opens the hearing. */
  create = async (req: Request, res: Response) => {
    res.status(201).json({ hearing: await this.service.create(parseInput(createHearingSchema, req.body)) });
  };

  /** The lawyer's answer; the reply is in the response. */
  sendTurn = async (req: Request, res: Response) => {
    const { id } = parseInput(uuidParamsSchema, req.params);
    const { content } = parseInput(sendTurnSchema, req.body);
    res.json({ hearing: await this.service.sendTurn(id, content) });
  };

  /** Asks again for the reply to the last answer (when the model failed). */
  reply = async (req: Request, res: Response) => {
    const { id } = parseInput(uuidParamsSchema, req.params);
    res.json({ hearing: await this.service.reply(id) });
  };

  /** Ends the practice and returns it with the feedback. */
  finish = async (req: Request, res: Response) => {
    const { id } = parseInput(uuidParamsSchema, req.params);
    res.json({ hearing: await this.service.finish(id) });
  };

  delete = async (req: Request, res: Response) => {
    const { id } = parseInput(uuidParamsSchema, req.params);
    await this.service.delete(id);
    res.status(204).end();
  };
}

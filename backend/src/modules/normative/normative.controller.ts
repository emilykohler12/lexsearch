import type { Request, Response } from 'express';
import { parseInput, uuidParamsSchema } from '../../lib/validation.js';
import {
  alertsQuerySchema,
  createTopicSchema,
  itemsQuerySchema,
  updateAlertSchema,
  updateTopicSchema,
} from './normative.schemas.js';
import type { NormativeService } from './normative.service.js';

export class NormativeController {
  constructor(private readonly service: NormativeService) {}

  status = async (_req: Request, res: Response) => {
    res.json(await this.service.status());
  };

  /** Starts a check of the bulletin in the background; the screen follows it through the status. */
  refresh = (_req: Request, res: Response) => {
    res.status(202).json(this.service.startRefresh());
  };

  listAlerts = async (req: Request, res: Response) => {
    const { status } = parseInput(alertsQuerySchema, req.query);
    res.json({ alerts: await this.service.listAlerts(status) });
  };

  unreadCount = async (_req: Request, res: Response) => {
    res.json({ count: await this.service.unreadCount() });
  };

  markAllSeen = async (_req: Request, res: Response) => {
    await this.service.markAllSeen();
    res.status(204).end();
  };

  updateAlert = async (req: Request, res: Response) => {
    const { id } = parseInput(uuidParamsSchema, req.params);
    const { status } = parseInput(updateAlertSchema, req.body);
    res.json({ alert: await this.service.updateAlert(id, status) });
  };

  listItems = async (req: Request, res: Response) => {
    res.json(await this.service.listItems(parseInput(itemsQuerySchema, req.query)));
  };

  listTopics = async (_req: Request, res: Response) => {
    res.json({ topics: await this.service.listTopics() });
  };

  createTopic = async (req: Request, res: Response) => {
    res.status(201).json({ topic: await this.service.createTopic(parseInput(createTopicSchema, req.body)) });
  };

  updateTopic = async (req: Request, res: Response) => {
    const { id } = parseInput(uuidParamsSchema, req.params);
    res.json({ topic: await this.service.updateTopic(id, parseInput(updateTopicSchema, req.body)) });
  };

  deleteTopic = async (req: Request, res: Response) => {
    const { id } = parseInput(uuidParamsSchema, req.params);
    await this.service.deleteTopic(id);
    res.status(204).end();
  };
}

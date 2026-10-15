import type { Request, Response } from 'express';
import { parseInput, uuidParamsSchema } from '../../lib/validation.js';
import { toNotificationDto, type NotificationsService } from './notifications.service.js';

export class NotificationsController {
  constructor(private readonly service: NotificationsService) {}

  listUnread = async (_req: Request, res: Response) => {
    const notifications = await this.service.listUnread();
    res.json({ notifications: notifications.map(toNotificationDto) });
  };

  markRead = async (req: Request, res: Response) => {
    const { id } = parseInput(uuidParamsSchema, req.params);
    await this.service.markRead(id);
    res.status(204).end();
  };

  markAllRead = async (_req: Request, res: Response) => {
    await this.service.markAllRead();
    res.status(204).end();
  };
}

import type { Notification } from '../../generated/prisma/client.js';
import { NotFoundError } from '../../lib/errors.js';
import type { DeadlineWatcher } from './deadline-watcher.js';
import type { NotificationsRepository } from './notifications.repository.js';

export function toNotificationDto(notification: Notification) {
  return {
    id: notification.id,
    kind: notification.kind,
    deadlineId: notification.deadlineId,
    title: notification.title,
    message: notification.message,
    createdAt: notification.createdAt,
  };
}

export class NotificationsService {
  constructor(private readonly deps: { repository: NotificationsRepository; watcher: DeadlineWatcher }) {}

  /** The unread warnings, after making sure the ones that are due exist (the hourly check may have been missed). */
  async listUnread(): Promise<Notification[]> {
    await this.deps.watcher.check();
    return this.deps.repository.listUnread();
  }

  async markRead(id: string): Promise<void> {
    const notification = await this.deps.repository.findById(id);
    if (!notification) throw new NotFoundError('El aviso no existe o fue eliminado');
    if (!notification.readAt) await this.deps.repository.markRead(id);
  }

  async markAllRead(): Promise<void> {
    await this.deps.repository.markAllRead();
  }
}

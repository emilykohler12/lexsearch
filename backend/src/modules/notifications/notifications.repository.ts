import type { Notification, PrismaClient } from '../../generated/prisma/client.js';

export interface NewNotification {
  kind: string;
  deadlineId: string | null;
  title: string;
  message: string;
}

export class NotificationsRepository {
  constructor(private readonly db: PrismaClient) {}

  /** Newest first. */
  listUnread(limit = 50): Promise<Notification[]> {
    return this.db.notification.findMany({ where: { readAt: null }, orderBy: { createdAt: 'desc' }, take: limit });
  }

  /** Each deadline has one notification of each kind: true only when this call created it. */
  async createIfMissing(data: NewNotification): Promise<boolean> {
    const { count } = await this.db.notification.createMany({ data: [data], skipDuplicates: true });
    return count > 0;
  }

  /** The lawyer has a newer warning about this deadline: the older ones are history. */
  markDeadlineRead(deadlineId: string, exceptKind: string): Promise<unknown> {
    return this.db.notification.updateMany({
      where: { deadlineId, readAt: null, kind: { not: exceptKind } },
      data: { readAt: new Date() },
    });
  }

  findById(id: string): Promise<Notification | null> {
    return this.db.notification.findUnique({ where: { id } });
  }

  markRead(id: string): Promise<Notification> {
    return this.db.notification.update({ where: { id }, data: { readAt: new Date() } });
  }

  markAllRead(): Promise<unknown> {
    return this.db.notification.updateMany({ where: { readAt: null }, data: { readAt: new Date() } });
  }

  /** The deadline changed (new date, fulfilled): what it said no longer holds. */
  deleteForDeadline(deadlineId: string): Promise<unknown> {
    return this.db.notification.deleteMany({ where: { deadlineId } });
  }
}

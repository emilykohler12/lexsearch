import type { NonWorkingDay, PrismaClient } from '../../generated/prisma/client.js';
import { toDate, type IsoDate } from './dates.js';

export interface NonWorkingDayData {
  startDate: IsoDate;
  endDate: IsoDate;
  label: string;
}

export class NonWorkingDaysRepository {
  constructor(private readonly db: PrismaClient) {}

  list(): Promise<NonWorkingDay[]> {
    return this.db.nonWorkingDay.findMany({ orderBy: [{ startDate: 'asc' }, { createdAt: 'asc' }] });
  }

  findById(id: string): Promise<NonWorkingDay | null> {
    return this.db.nonWorkingDay.findUnique({ where: { id } });
  }

  create(data: NonWorkingDayData): Promise<NonWorkingDay> {
    return this.db.nonWorkingDay.create({ data: toRow(data) });
  }

  update(id: string, data: NonWorkingDayData): Promise<NonWorkingDay> {
    return this.db.nonWorkingDay.update({ where: { id }, data: toRow(data) });
  }

  async delete(id: string): Promise<void> {
    await this.db.nonWorkingDay.delete({ where: { id } });
  }
}

const toRow = (data: NonWorkingDayData) => ({
  startDate: toDate(data.startDate),
  endDate: toDate(data.endDate),
  label: data.label,
});

import type { Request, Response } from 'express';
import { parseInput, uuidParamsSchema } from '../../lib/validation.js';
import { calendarQuerySchema, nonWorkingDayInputSchema, toNonWorkingDayDto } from './calendar.schemas.js';
import type { CalendarService } from './calendar.service.js';
import { todayInArgentina } from './dates.js';

export class CalendarController {
  constructor(private readonly service: CalendarService) {}

  overview = async (req: Request, res: Response) => {
    const { year } = parseInput(calendarQuerySchema, req.query);
    const overview = await this.service.overview(year ?? Number(todayInArgentina().slice(0, 4)));
    res.json({
      year: overview.year,
      holidays: overview.holidays,
      customDays: overview.customDays.map(toNonWorkingDayDto),
    });
  };

  create = async (req: Request, res: Response) => {
    const input = parseInput(nonWorkingDayInputSchema, req.body);
    res.status(201).json({ nonWorkingDay: toNonWorkingDayDto(await this.service.create(input)) });
  };

  update = async (req: Request, res: Response) => {
    const { id } = parseInput(uuidParamsSchema, req.params);
    const input = parseInput(nonWorkingDayInputSchema, req.body);
    res.json({ nonWorkingDay: toNonWorkingDayDto(await this.service.update(id, input)) });
  };

  delete = async (req: Request, res: Response) => {
    const { id } = parseInput(uuidParamsSchema, req.params);
    await this.service.delete(id);
    res.status(204).end();
  };
}

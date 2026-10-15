import { BadRequestError, NotFoundError } from '../../lib/errors.js';
import type { Logger } from '../../lib/logger.js';
import { computeDueDate, type DayType, type SkippedDay } from '../calendar/business-days.js';
import type { CalendarService } from '../calendar/calendar.service.js';
import { daysBetween, toDate, toIsoDate, todayInArgentina } from '../calendar/dates.js';
import type { CasesRepository } from '../cases/cases.repository.js';
import type { ClientsRepository } from '../clients/clients.repository.js';
import type { NotificationsRepository } from '../notifications/notifications.repository.js';
import type { DeadlineChanges, DeadlinesRepository, DeadlineWithRelations } from './deadlines.repository.js';
import type {
  CalculateInput,
  CreateDeadlineInput,
  ListDeadlinesFilters,
  UpdateDeadlineInput,
} from './deadlines.schemas.js';

interface DeadlinesServiceDeps {
  repository: DeadlinesRepository;
  calendar: CalendarService;
  clients: ClientsRepository;
  cases: CasesRepository;
  notifications: NotificationsRepository;
  logger: Logger;
}

export class DeadlinesService {
  constructor(private readonly deps: DeadlinesServiceDeps) {}

  async create(input: CreateDeadlineInput): Promise<DeadlineWithRelations> {
    const [deadline] = await this.createMany([input]);
    return deadline!;
  }

  /** The terms of one document, saved together: all of them or none. */
  async createMany(inputs: CreateDeadlineInput[]): Promise<DeadlineWithRelations[]> {
    await this.assertClientsExist(inputs.map((input) => input.clientId));
    await this.assertCasesExist(inputs.map((input) => input.caseId));
    const calendar = await this.deps.calendar.load();
    return this.deps.repository.createMany(
      inputs.map((input) => ({
        title: input.title,
        caseReference: input.caseReference,
        notes: input.notes,
        clientId: input.clientId,
        caseId: input.caseId,
        notificationDate: toDate(input.notificationDate),
        days: input.days,
        dayType: input.dayType,
        dueDate: toDate(computeDueDate(input, calendar).dueDate),
        sourceQuote: input.sourceQuote,
      })),
    );
  }

  list(filters: ListDeadlinesFilters): Promise<DeadlineWithRelations[]> {
    return this.deps.repository.list(filters);
  }

  async get(id: string): Promise<DeadlineWithRelations> {
    const deadline = await this.deps.repository.findById(id);
    if (!deadline) throw new NotFoundError('El plazo no existe o fue eliminado');
    return deadline;
  }

  /** The days that did not count for this deadline, so the lawyer can check the calculation. */
  async explain(deadline: DeadlineWithRelations): Promise<SkippedDay[]> {
    const calendar = await this.deps.calendar.load();
    return computeDueDate(
      { notificationDate: toIsoDate(deadline.notificationDate), days: deadline.days, dayType: deadline.dayType as DayType },
      calendar,
    ).skipped;
  }

  /** The due date a term would have, without saving anything (the editor shows it as the lawyer types). */
  async calculate(input: CalculateInput) {
    const result = computeDueDate(input, await this.deps.calendar.load());
    return { ...result, daysLeft: daysBetween(todayInArgentina(), result.dueDate) };
  }

  async update(id: string, input: UpdateDeadlineInput): Promise<DeadlineWithRelations> {
    const current = await this.get(id);
    if (input.clientId) await this.assertClientsExist([input.clientId]);
    if (input.caseId) await this.assertCasesExist([input.caseId]);

    const changes: DeadlineChanges = {
      title: input.title,
      caseReference: input.caseReference,
      notes: input.notes,
      clientId: input.clientId,
      caseId: input.caseId,
      sourceQuote: input.sourceQuote,
      days: input.days,
      dayType: input.dayType,
      notificationDate: input.notificationDate === undefined ? undefined : toDate(input.notificationDate),
    };

    let dueDateChanged = false;
    if (input.notificationDate !== undefined || input.days !== undefined || input.dayType !== undefined) {
      const dueDate = computeDueDate(
        {
          notificationDate: input.notificationDate ?? toIsoDate(current.notificationDate),
          days: input.days ?? current.days,
          dayType: input.dayType ?? (current.dayType as DayType),
        },
        await this.deps.calendar.load(),
      ).dueDate;
      changes.dueDate = toDate(dueDate);
      dueDateChanged = dueDate !== toIsoDate(current.dueDate);
    }

    const statusChanged = input.status !== undefined && input.status !== current.status;
    if (statusChanged) {
      changes.status = input.status;
      changes.completedAt = input.status === 'DONE' ? new Date() : null;
    }

    const updated = await this.deps.repository.update(id, changes);
    // What the warnings said (or would say) no longer holds: they are generated again if they apply.
    if (dueDateChanged || statusChanged) await this.deps.notifications.deleteForDeadline(id);
    return updated;
  }

  async delete(id: string): Promise<void> {
    await this.get(id);
    await this.deps.repository.delete(id); // its warnings are removed by ON DELETE CASCADE
  }

  /**
   * The calendar changed (the lawyer added or removed days): pending deadlines may now end on
   * another day. Returns how many moved.
   */
  async recalculatePending(): Promise<number> {
    const calendar = await this.deps.calendar.load();
    const pending = await this.deps.repository.list({ status: 'PENDING' });

    let moved = 0;
    for (const deadline of pending) {
      try {
        const dueDate = computeDueDate(
          { notificationDate: toIsoDate(deadline.notificationDate), days: deadline.days, dayType: deadline.dayType as DayType },
          calendar,
        ).dueDate;
        if (dueDate === toIsoDate(deadline.dueDate)) continue;
        await this.deps.repository.update(deadline.id, { dueDate: toDate(dueDate) });
        await this.deps.notifications.deleteForDeadline(deadline.id);
        moved++;
      } catch (error) {
        this.deps.logger.warn({ err: error, deadlineId: deadline.id }, 'Could not recalculate a deadline');
      }
    }
    return moved;
  }

  private async assertClientsExist(clientIds: Array<string | null>): Promise<void> {
    for (const id of new Set(clientIds.filter((clientId): clientId is string => clientId !== null))) {
      if (!(await this.deps.clients.findById(id))) {
        throw new BadRequestError('El cliente elegido no existe o fue eliminado.');
      }
    }
  }

  private async assertCasesExist(caseIds: Array<string | null>): Promise<void> {
    for (const id of new Set(caseIds.filter((caseId): caseId is string => caseId !== null))) {
      if (!(await this.deps.cases.findById(id))) {
        throw new BadRequestError('El expediente elegido no existe o fue eliminado.');
      }
    }
  }
}

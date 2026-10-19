import { BadRequestError, ConflictError, NotFoundError } from '../../lib/errors.js';
import { toIsoDate, type IsoDate } from '../calendar/dates.js';
import type { CasesRepository } from '../cases/cases.repository.js';
import type { ClientsRepository } from '../clients/clients.repository.js';
import { PRACTICE_AREAS } from '../clients/clients.schemas.js';
import type { NormativeRepository } from './normative.repository.js';
import {
  toAlertDto,
  toItemDto,
  toTopicDto,
  type AlertStatus,
  type CreateTopicInput,
  type SourceTag,
  type UpdateTopicInput,
} from './normative.schemas.js';
import type { NormativeWatcher } from './normative-watcher.js';
import type { NormativeSource } from './sources/normative-source.js';

/** A check older than this is stale: the screen asks for a new one when it opens. */
const STALE_AFTER_MS = 6 * 3_600_000;

interface NormativeServiceDeps {
  repository: NormativeRepository;
  watcher: NormativeWatcher;
  clients: ClientsRepository;
  cases: CasesRepository;
  /** The bulletins that are read, in the order they are shown. */
  sources: Array<Pick<NormativeSource, 'id' | 'label' | 'shortLabel'>>;
  /** Whether a model is configured: without one the norms are matched by words only. */
  aiConfigured: boolean;
  /** Start checks by themselves when the topics change (tests turn it off to stay deterministic). */
  autoRun: boolean;
  now?: () => Date;
}

export class NormativeService {
  private readonly now: () => Date;

  constructor(private readonly deps: NormativeServiceDeps) {
    this.now = deps.now ?? (() => new Date());
  }

  async status() {
    const { repository, watcher, sources } = this.deps;
    const now = this.now().getTime();

    const [topics, perSource] = await Promise.all([
      repository.listTopics(),
      Promise.all(
        sources.map(async (source) => {
          const [last, edition] = await Promise.all([repository.lastRun(source.id), repository.lastReadEdition(source.id)]);
          return {
            id: source.id,
            label: source.label,
            shortLabel: source.shortLabel,
            lastCheckedAt: last?.finishedAt ?? null,
            lastEditionDate: edition ? toIsoDate(edition) : null,
            /** What went wrong in the last check of this bulletin; null when it went well. */
            lastError: last && last.status !== 'OK' && last.status !== 'NO_EDITION' && last.error ? last.error : null,
            stale: !last || now - last.finishedAt.getTime() > STALE_AFTER_MS,
          };
        }),
      ),
    ]);

    const checked = perSource.flatMap((source) => (source.lastCheckedAt ? [source.lastCheckedAt.getTime()] : []));
    return {
      running: watcher.isRunning,
      aiConfigured: this.deps.aiConfigured,
      topicCount: topics.filter((topic) => topic.active).length,
      lastCheckedAt: checked.length > 0 ? new Date(Math.max(...checked)) : null,
      /** One bulletin that is behind is enough: the screen asks for a new check when it opens. */
      stale: perSource.some((source) => source.stale),
      sources: perSource,
    };
  }

  /** Starts a check in the background (unless one is running); the screen follows it through status(). */
  startRefresh(): { running: true } {
    if (!this.deps.watcher.isRunning) this.deps.watcher.requestRefresh();
    return { running: true };
  }

  // ── Alerts ───────────────────────────────────────────────────────────────

  async listAlerts(status: 'ACTIVE' | AlertStatus) {
    const rows = await this.deps.repository.listAlerts(status === 'ACTIVE' ? ['NEW', 'SEEN'] : [status]);
    const areas = await this.areaCounts();
    return rows.map((row) => toAlertDto(row, this.affected(row.topic.practiceArea, areas), this.tagOf(row.item.source)));
  }

  unreadCount(): Promise<number> {
    return this.deps.repository.countNew();
  }

  async updateAlert(id: string, status: AlertStatus) {
    if (!(await this.deps.repository.findAlert(id))) throw new NotFoundError('La alerta no existe o fue eliminada');
    const row = await this.deps.repository.updateAlertStatus(id, status);
    return toAlertDto(row, this.affected(row.topic.practiceArea, await this.areaCounts()), this.tagOf(row.item.source));
  }

  async markAllSeen(): Promise<void> {
    await this.deps.repository.markAllNewSeen();
  }

  // ── The bulletin ─────────────────────────────────────────────────────────

  /** The norms of one edition of one bulletin (the newest stored when no date is given; the first bulletin when none is named). */
  async listItems(query: { source?: string | undefined; date?: IsoDate | undefined; q: string; category: string }) {
    const { repository, sources } = this.deps;
    const source = query.source ? sources.find((candidate) => candidate.id === query.source) : sources[0];
    if (!source) throw new BadRequestError('El boletín no existe');

    const tag = this.tagOf(source.id);
    const available = sources.map(({ id, label, shortLabel }) => ({ id, label, shortLabel }));
    const dates = (await repository.listEditionDates(source.id)).map(toIsoDate);
    const date = query.date ?? dates[0] ?? null;
    if (!date) return { source: source.id, sources: available, date: null, dates, categories: [] as string[], items: [] };

    const [items, categories] = await Promise.all([
      repository.listItems({ source: source.id, date, q: query.q, category: query.category }),
      repository.listCategories(source.id, date),
    ]);
    return { source: source.id, sources: available, date, dates, categories, items: items.map((row) => toItemDto(row, tag)) };
  }

  // ── Topics ───────────────────────────────────────────────────────────────

  async listTopics() {
    return (await this.deps.repository.listTopics()).map(toTopicDto);
  }

  async createTopic(input: CreateTopicInput) {
    const { repository } = this.deps;
    if (input.practiceArea && (await repository.findTopicByArea(input.practiceArea))) {
      throw new ConflictError('Ya seguís esa área de práctica.');
    }

    const topic = await repository.createTopic({
      name: input.practiceArea ? PRACTICE_AREAS[input.practiceArea] : (input.name ?? ''),
      practiceArea: input.practiceArea ?? null,
      keywords: input.keywords,
      description: input.description,
    });
    // The norms of the last days are checked against the new topic, not only the ones that come.
    if (this.deps.autoRun) this.deps.watcher.requestRefresh();
    return toTopicDto(topic);
  }

  async updateTopic(id: string, input: UpdateTopicInput) {
    const { repository } = this.deps;
    if (!(await repository.findTopic(id))) throw new NotFoundError('El tema no existe o fue eliminado');

    const topic = await repository.updateTopic(id, input);
    // What the topic looks for changed: what was checked before has to be checked again.
    if (input.keywords !== undefined || input.description !== undefined) await repository.forgetTopic(id);
    if (this.deps.autoRun && (input.keywords !== undefined || input.description !== undefined || input.active === true)) {
      this.deps.watcher.requestRefresh();
    }
    return toTopicDto(topic);
  }

  async deleteTopic(id: string): Promise<void> {
    if (!(await this.deps.repository.findTopic(id))) throw new NotFoundError('El tema no existe o fue eliminado');
    await this.deps.repository.deleteTopic(id);
  }

  /** The bulletin a norm came from, as it is shown («Nación»); the raw id if that bulletin is no longer read. */
  private tagOf(sourceId: string): SourceTag {
    const source = this.deps.sources.find((candidate) => candidate.id === sourceId);
    return { source: sourceId, sourceLabel: source?.shortLabel ?? sourceId };
  }

  private async areaCounts() {
    const [clients, cases] = await Promise.all([this.deps.clients.countByPracticeArea(), this.deps.cases.countOpenByPracticeArea()]);
    return { clients, cases };
  }

  /** Who the area of a topic concerns: the clients and the open expedientes it has. */
  private affected(area: string | null, counts: { clients: Map<string, number>; cases: Map<string, number> }) {
    return area ? { clients: counts.clients.get(area) ?? 0, cases: counts.cases.get(area) ?? 0 } : null;
  }
}

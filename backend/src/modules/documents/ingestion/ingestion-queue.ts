import type { Logger } from '../../../lib/logger.js';

/**
 * In-process queue that indexes one document at a time. For a single user this is
 * enough: no Redis/BullMQ to operate. Unfinished work is recovered on startup from the
 * document status stored in the database.
 */
export class IngestionQueue {
  private readonly pending: string[] = [];
  private running: Promise<void> | null = null;

  constructor(
    private readonly worker: (documentId: string) => Promise<void>,
    private readonly logger: Logger,
  ) {}

  enqueue(documentId: string): void {
    if (!this.pending.includes(documentId)) {
      this.pending.push(documentId);
    }
    this.running ??= this.drain();
  }

  /** Resolves once every queued document has been processed (used by tests and shutdown). */
  async idle(): Promise<void> {
    while (this.running) {
      await this.running;
    }
  }

  get size(): number {
    return this.pending.length + (this.running ? 1 : 0);
  }

  private async drain(): Promise<void> {
    try {
      let documentId: string | undefined;
      while ((documentId = this.pending.shift()) !== undefined) {
        try {
          await this.worker(documentId);
        } catch (error) {
          this.logger.error({ err: error, documentId }, 'Ingestion worker crashed');
        }
      }
    } finally {
      this.running = null;
    }
  }
}

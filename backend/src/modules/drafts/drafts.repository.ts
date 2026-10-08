import type { Prisma, PrismaClient } from '../../generated/prisma/client.js';

export interface NewDraft {
  title: string;
  documentType: string;
  instructions: string;
  caseDetails: string;
  templateDocumentId: string | null;
  clientId: string | null;
  content: string;
  sources: Prisma.InputJsonValue;
  model: string;
  interactionId: string;
}

/** Enough of the client to show and link its name next to the draft. */
const clientSummary = { select: { id: true, fullName: true } } as const;

export type DraftWithClient = Prisma.DraftGetPayload<{ include: { client: typeof clientSummary } }>;

export class DraftsRepository {
  constructor(private readonly db: PrismaClient) {}

  create(data: NewDraft): Promise<DraftWithClient> {
    return this.db.draft.create({ data, include: { client: clientSummary } });
  }

  /** Newest first, without the (possibly long) content; optionally only one client's drafts. */
  list(filters: { clientId?: string | undefined } = {}) {
    return this.db.draft.findMany({
      where: { clientId: filters.clientId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        title: true,
        documentType: true,
        client: clientSummary,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  findById(id: string): Promise<DraftWithClient | null> {
    return this.db.draft.findUnique({ where: { id }, include: { client: clientSummary } });
  }

  update(id: string, data: { title?: string | undefined; content?: string | undefined }): Promise<DraftWithClient> {
    return this.db.draft.update({ where: { id }, data, include: { client: clientSummary } });
  }

  async delete(id: string): Promise<void> {
    await this.db.draft.delete({ where: { id } });
  }
}

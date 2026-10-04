import type { Draft, Prisma, PrismaClient } from '../../generated/prisma/client.js';

export interface NewDraft {
  title: string;
  documentType: string;
  instructions: string;
  caseDetails: string;
  templateDocumentId: string | null;
  content: string;
  sources: Prisma.InputJsonValue;
  model: string;
  interactionId: string;
}

export class DraftsRepository {
  constructor(private readonly db: PrismaClient) {}

  create(data: NewDraft): Promise<Draft> {
    return this.db.draft.create({ data });
  }

  /** Newest first, without the (possibly long) content. */
  list() {
    return this.db.draft.findMany({
      orderBy: { createdAt: 'desc' },
      select: { id: true, title: true, documentType: true, createdAt: true, updatedAt: true },
    });
  }

  findById(id: string): Promise<Draft | null> {
    return this.db.draft.findUnique({ where: { id } });
  }

  update(id: string, data: { title?: string | undefined; content?: string | undefined }): Promise<Draft> {
    return this.db.draft.update({ where: { id }, data });
  }

  async delete(id: string): Promise<void> {
    await this.db.draft.delete({ where: { id } });
  }
}

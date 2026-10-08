import type { Client, Prisma, PrismaClient } from '../../generated/prisma/client.js';
import type { CreateClientInput, UpdateClientInput } from './clients.schemas.js';

export class ClientsRepository {
  constructor(private readonly db: PrismaClient) {}

  create(data: CreateClientInput): Promise<Client> {
    return this.db.client.create({ data: { ...data, checklist: data.checklist as Prisma.InputJsonValue } });
  }

  /** Most recently touched first; only what the list shows (no notes or long texts). */
  list() {
    return this.db.client.findMany({
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        fullName: true,
        personType: true,
        documentNumber: true,
        practiceArea: true,
        counterpartyName: true,
        checklist: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  findById(id: string): Promise<Client | null> {
    return this.db.client.findUnique({ where: { id } });
  }

  update(id: string, data: UpdateClientInput): Promise<Client> {
    const { checklist, ...rest } = data;
    return this.db.client.update({
      where: { id },
      data: { ...rest, ...(checklist !== undefined && { checklist: checklist as Prisma.InputJsonValue }) },
    });
  }

  async delete(id: string): Promise<void> {
    await this.db.client.delete({ where: { id } });
  }
}

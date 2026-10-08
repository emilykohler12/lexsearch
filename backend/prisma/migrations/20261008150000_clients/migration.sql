-- Fase 3: fichas de cliente y vínculo de los borradores con su cliente.
-- CreateTable
CREATE TABLE "clients" (
    "id" UUID NOT NULL,
    "full_name" TEXT NOT NULL,
    "person_type" TEXT NOT NULL DEFAULT 'FISICA',
    "document_number" TEXT NOT NULL DEFAULT '',
    "email" TEXT NOT NULL DEFAULT '',
    "phone" TEXT NOT NULL DEFAULT '',
    "address" TEXT NOT NULL DEFAULT '',
    "counterparty_name" TEXT NOT NULL DEFAULT '',
    "counterparty_document" TEXT NOT NULL DEFAULT '',
    "counterparty_address" TEXT NOT NULL DEFAULT '',
    "practice_area" TEXT,
    "conflict_summary" TEXT NOT NULL DEFAULT '',
    "claim" TEXT NOT NULL DEFAULT '',
    "checklist" JSONB NOT NULL DEFAULT '[]',
    "meeting_notes" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "clients_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "drafts" ADD COLUMN "client_id" UUID;

-- CreateIndex
CREATE INDEX "clients_full_name_idx" ON "clients"("full_name");

-- CreateIndex
CREATE INDEX "drafts_client_id_idx" ON "drafts"("client_id");

-- AddForeignKey
ALTER TABLE "drafts" ADD CONSTRAINT "drafts_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

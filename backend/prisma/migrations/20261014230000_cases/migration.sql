-- Fase 5: expedientes, su vínculo con clientes y las actuaciones de la línea de tiempo.
-- AlterTable
ALTER TABLE "deadlines" ADD COLUMN "case_id" UUID;

-- CreateTable
CREATE TABLE "cases" (
    "id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "number" TEXT NOT NULL DEFAULT '',
    "court" TEXT NOT NULL DEFAULT '',
    "practice_area" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "notes" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "case_clients" (
    "case_id" UUID NOT NULL,
    "client_id" UUID NOT NULL,

    CONSTRAINT "case_clients_pkey" PRIMARY KEY ("case_id","client_id")
);

-- CreateTable
CREATE TABLE "proceedings" (
    "id" UUID NOT NULL,
    "case_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "position" INTEGER NOT NULL DEFAULT 0,
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "source_quote" TEXT NOT NULL DEFAULT '',
    "document_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "proceedings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "cases_status_updated_at_idx" ON "cases"("status", "updated_at");

-- CreateIndex
CREATE INDEX "case_clients_client_id_idx" ON "case_clients"("client_id");

-- CreateIndex
CREATE INDEX "proceedings_case_id_date_idx" ON "proceedings"("case_id", "date");

-- CreateIndex
CREATE INDEX "proceedings_document_id_idx" ON "proceedings"("document_id");

-- CreateIndex
CREATE INDEX "deadlines_case_id_idx" ON "deadlines"("case_id");

-- AddForeignKey
ALTER TABLE "deadlines" ADD CONSTRAINT "deadlines_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "cases"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_clients" ADD CONSTRAINT "case_clients_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_clients" ADD CONSTRAINT "case_clients_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proceedings" ADD CONSTRAINT "proceedings_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proceedings" ADD CONSTRAINT "proceedings_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

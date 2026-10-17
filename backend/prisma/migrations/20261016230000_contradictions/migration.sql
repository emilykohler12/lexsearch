-- Fase 6: documentos de un expediente (con la categoría "prueba") y contradicciones entre pruebas.
-- AlterEnum
ALTER TYPE "DocumentCategory" ADD VALUE 'PRUEBA';

-- AlterTable
ALTER TABLE "documents" ADD COLUMN "case_id" UUID;

-- CreateTable
CREATE TABLE "contradictions" (
    "id" UUID NOT NULL,
    "case_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "confidence" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "explanation" TEXT NOT NULL,
    "statements" JSONB NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contradictions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "contradictions_case_id_created_at_idx" ON "contradictions"("case_id", "created_at");

-- CreateIndex
CREATE INDEX "documents_case_id_idx" ON "documents"("case_id");

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "cases"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contradictions" ADD CONSTRAINT "contradictions_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

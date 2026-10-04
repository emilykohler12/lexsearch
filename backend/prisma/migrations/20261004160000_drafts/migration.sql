-- Fase 2: borradores de escritos y contratos redactados por el agente.
-- CreateTable
CREATE TABLE "drafts" (
    "id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "document_type" TEXT NOT NULL,
    "instructions" TEXT NOT NULL,
    "case_details" TEXT NOT NULL,
    "template_document_id" UUID,
    "content" TEXT NOT NULL,
    "sources" JSONB NOT NULL,
    "model" TEXT,
    "interaction_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "drafts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "drafts_created_at_idx" ON "drafts"("created_at");

-- AddForeignKey
ALTER TABLE "drafts" ADD CONSTRAINT "drafts_template_document_id_fkey" FOREIGN KEY ("template_document_id") REFERENCES "documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;


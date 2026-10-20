-- CreateTable
CREATE TABLE "outcome_estimates" (
    "id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "facts" TEXT NOT NULL,
    "claim" TEXT NOT NULL DEFAULT '',
    "case_id" UUID,
    "result" JSONB NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "model" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "outcome_estimates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "outcome_estimates_updated_at_idx" ON "outcome_estimates"("updated_at");

-- CreateIndex
CREATE INDEX "outcome_estimates_case_id_idx" ON "outcome_estimates"("case_id");

-- AddForeignKey
ALTER TABLE "outcome_estimates" ADD CONSTRAINT "outcome_estimates_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "cases"("id") ON DELETE SET NULL ON UPDATE CASCADE;

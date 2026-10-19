-- CreateTable
CREATE TABLE "hearing_simulations" (
    "id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "case_id" UUID,
    "material_kind" TEXT NOT NULL,
    "material_title" TEXT NOT NULL,
    "material_text" TEXT NOT NULL,
    "case_context" TEXT NOT NULL DEFAULT '',
    "position" TEXT NOT NULL DEFAULT '',
    "focus" TEXT NOT NULL DEFAULT '',
    "feedback" JSONB,
    "model" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "finished_at" TIMESTAMP(3),

    CONSTRAINT "hearing_simulations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hearing_turns" (
    "id" UUID NOT NULL,
    "simulation_id" UUID NOT NULL,
    "index" INTEGER NOT NULL,
    "speaker" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT '',
    "topic" TEXT NOT NULL DEFAULT '',
    "unverified_citations" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hearing_turns_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "hearing_simulations_updated_at_idx" ON "hearing_simulations"("updated_at");

-- CreateIndex
CREATE INDEX "hearing_simulations_case_id_idx" ON "hearing_simulations"("case_id");

-- CreateIndex
CREATE UNIQUE INDEX "hearing_turns_simulation_id_index_key" ON "hearing_turns"("simulation_id", "index");

-- AddForeignKey
ALTER TABLE "hearing_simulations" ADD CONSTRAINT "hearing_simulations_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "cases"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hearing_turns" ADD CONSTRAINT "hearing_turns_simulation_id_fkey" FOREIGN KEY ("simulation_id") REFERENCES "hearing_simulations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

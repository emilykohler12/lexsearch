-- Fase 7: vigía normativo (normas del Boletín Oficial, temas que sigue el abogado y alertas).
-- CreateTable
CREATE TABLE "normative_items" (
    "id" UUID NOT NULL,
    "source" TEXT NOT NULL,
    "external_id" TEXT NOT NULL,
    "published_on" DATE NOT NULL,
    "category" TEXT NOT NULL,
    "organism" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "number" TEXT NOT NULL DEFAULT '',
    "reference" TEXT NOT NULL DEFAULT '',
    "url" TEXT NOT NULL,
    "text" TEXT NOT NULL DEFAULT '',
    "summary" TEXT NOT NULL DEFAULT '',
    "detail_status" TEXT NOT NULL DEFAULT 'PENDING',
    "detail_attempts" INTEGER NOT NULL DEFAULT 0,
    "analyzed_topic_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "normative_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "normative_topics" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "practice_area" TEXT,
    "keywords" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "description" TEXT NOT NULL DEFAULT '',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "normative_topics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "normative_alerts" (
    "id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "topic_id" UUID NOT NULL,
    "relevance" TEXT NOT NULL,
    "origin" TEXT NOT NULL DEFAULT 'AI',
    "reason" TEXT NOT NULL,
    "quote" TEXT NOT NULL DEFAULT '',
    "quote_verified" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "normative_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "normative_runs" (
    "id" UUID NOT NULL,
    "source" TEXT NOT NULL,
    "edition_date" DATE NOT NULL,
    "status" TEXT NOT NULL,
    "items_found" INTEGER NOT NULL DEFAULT 0,
    "alerts_created" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT NOT NULL DEFAULT '',
    "started_at" TIMESTAMP(3) NOT NULL,
    "finished_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "normative_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "normative_items_published_on_idx" ON "normative_items"("published_on");

-- CreateIndex
CREATE INDEX "normative_items_detail_status_idx" ON "normative_items"("detail_status");

-- CreateIndex
CREATE UNIQUE INDEX "normative_items_source_external_id_key" ON "normative_items"("source", "external_id");

-- CreateIndex
CREATE UNIQUE INDEX "normative_topics_practice_area_key" ON "normative_topics"("practice_area");

-- CreateIndex
CREATE INDEX "normative_alerts_status_created_at_idx" ON "normative_alerts"("status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "normative_alerts_item_id_topic_id_key" ON "normative_alerts"("item_id", "topic_id");

-- CreateIndex
CREATE INDEX "normative_runs_finished_at_idx" ON "normative_runs"("finished_at");

-- CreateIndex
CREATE UNIQUE INDEX "normative_runs_source_edition_date_key" ON "normative_runs"("source", "edition_date");

-- AddForeignKey
ALTER TABLE "normative_alerts" ADD CONSTRAINT "normative_alerts_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "normative_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "normative_alerts" ADD CONSTRAINT "normative_alerts_topic_id_fkey" FOREIGN KEY ("topic_id") REFERENCES "normative_topics"("id") ON DELETE CASCADE ON UPDATE CASCADE;

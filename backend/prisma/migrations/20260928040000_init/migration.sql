-- Migración inicial de LexSearch (Fase 1: biblioteca + RAG).
-- Generada con `prisma migrate diff` y completada a mano con lo que Prisma no modela:
-- extensiones, configuración de búsqueda en español, columna generada e índices especiales.

-- Extensions ---------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS unaccent;

-- Spanish full-text search that ignores accents ("indemnizacion" finds "indemnización").
CREATE TEXT SEARCH CONFIGURATION es_unaccent (COPY = pg_catalog.spanish);
ALTER TEXT SEARCH CONFIGURATION es_unaccent
  ALTER MAPPING FOR hword, hword_part, word WITH unaccent, spanish_stem;

-- CreateEnum
CREATE TYPE "DocumentCategory" AS ENUM ('LEGISLACION', 'JURISPRUDENCIA', 'DOCTRINA', 'MODELO', 'ESCRITO', 'OTRO');

-- CreateEnum
CREATE TYPE "DocumentStatus" AS ENUM ('PENDING', 'PROCESSING', 'READY', 'FAILED');

-- CreateEnum
CREATE TYPE "InteractionStatus" AS ENUM ('SUCCESS', 'FAILED');

-- CreateTable
CREATE TABLE "documents" (
    "id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "original_name" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "storage_path" TEXT NOT NULL,
    "category" "DocumentCategory" NOT NULL DEFAULT 'OTRO',
    "status" "DocumentStatus" NOT NULL DEFAULT 'PENDING',
    "error_message" TEXT,
    "page_count" INTEGER,
    "chunk_count" INTEGER NOT NULL DEFAULT 0,
    "char_count" INTEGER,
    "embedding_model" TEXT,
    "processed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_chunks" (
    "id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "page_start" INTEGER,
    "page_end" INTEGER,
    "char_count" INTEGER NOT NULL,
    "embedding" vector(768),
    -- Kept up to date by Postgres itself on every insert/update of "content".
    "search_vector" tsvector GENERATED ALWAYS AS (to_tsvector('es_unaccent'::regconfig, "content")) STORED,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_chunks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_interactions" (
    "id" UUID NOT NULL,
    "module" TEXT NOT NULL,
    "input" JSONB NOT NULL,
    "context" JSONB,
    "output" JSONB,
    "model" TEXT,
    "prompt_version" TEXT,
    "input_tokens" INTEGER,
    "output_tokens" INTEGER,
    "duration_ms" INTEGER,
    "status" "InteractionStatus" NOT NULL,
    "error_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_interactions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "documents_sha256_key" ON "documents"("sha256");

-- CreateIndex
CREATE INDEX "documents_category_idx" ON "documents"("category");

-- CreateIndex
CREATE INDEX "documents_status_idx" ON "documents"("status");

-- CreateIndex
CREATE UNIQUE INDEX "document_chunks_document_id_ordinal_key" ON "document_chunks"("document_id", "ordinal");

-- CreateIndex
CREATE INDEX "agent_interactions_module_created_at_idx" ON "agent_interactions"("module", "created_at");

-- AddForeignKey
ALTER TABLE "document_chunks" ADD CONSTRAINT "document_chunks_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Search indexes (not representable in schema.prisma) ------------------------
-- Approximate nearest-neighbour search by cosine distance.
CREATE INDEX "document_chunks_embedding_hnsw_idx" ON "document_chunks" USING hnsw ("embedding" vector_cosine_ops);
-- Full-text search.
CREATE INDEX "document_chunks_search_vector_idx" ON "document_chunks" USING gin ("search_vector");

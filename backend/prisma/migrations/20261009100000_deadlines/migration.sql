-- Fase 4: plazos, días inhábiles propios y avisos del sistema.
-- CreateTable
CREATE TABLE "deadlines" (
    "id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "case_reference" TEXT NOT NULL DEFAULT '',
    "notes" TEXT NOT NULL DEFAULT '',
    "client_id" UUID,
    "notification_date" DATE NOT NULL,
    "days" INTEGER NOT NULL,
    "day_type" TEXT NOT NULL,
    "due_date" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "completed_at" TIMESTAMP(3),
    "source_quote" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "deadlines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "non_working_days" (
    "id" UUID NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "label" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "non_working_days_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "deadline_id" UUID,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "read_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "deadlines_status_due_date_idx" ON "deadlines"("status", "due_date");

-- CreateIndex
CREATE INDEX "deadlines_client_id_idx" ON "deadlines"("client_id");

-- CreateIndex
CREATE INDEX "non_working_days_start_date_idx" ON "non_working_days"("start_date");

-- CreateIndex
CREATE INDEX "notifications_read_at_created_at_idx" ON "notifications"("read_at", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "notifications_deadline_id_kind_key" ON "notifications"("deadline_id", "kind");

-- AddForeignKey
ALTER TABLE "deadlines" ADD CONSTRAINT "deadlines_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_deadline_id_fkey" FOREIGN KEY ("deadline_id") REFERENCES "deadlines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

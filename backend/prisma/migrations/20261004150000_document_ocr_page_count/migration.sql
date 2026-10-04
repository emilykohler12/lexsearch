-- Páginas de cada documento cuyo texto se leyó con OCR (escaneos y fotos).
ALTER TABLE "documents" ADD COLUMN "ocr_page_count" INTEGER NOT NULL DEFAULT 0;

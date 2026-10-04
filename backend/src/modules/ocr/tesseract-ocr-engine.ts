import sharp from 'sharp';
import { createWorker, OEM, type Worker } from 'tesseract.js';
import type { Logger } from '../../lib/logger.js';
import type { OcrEngine, OcrResult } from './ocr-engine.js';

interface TesseractOptions {
  /** Tesseract language code; "spa" = Spanish. */
  language: string;
  /** Where the language data is cached after the first download (~15 MB). */
  cachePath: string;
  logger: Logger;
}

/**
 * OCR that runs on this machine (Tesseract compiled to WebAssembly): scans and photos of
 * client documents are never sent anywhere to be read.
 */
export class TesseractOcrEngine implements OcrEngine {
  private worker: Promise<Worker> | null = null;
  // One image at a time on a single worker; documents are indexed one by one anyway.
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly options: TesseractOptions) {}

  async warmUp(): Promise<void> {
    await this.getWorker();
  }

  recognize(image: Buffer): Promise<OcrResult> {
    const run = this.queue.then(async () => {
      const worker = await this.getWorker();
      const { data } = await worker.recognize(await prepareForOcr(image));
      return { text: data.text, confidence: data.confidence };
    });
    this.queue = run.catch(() => undefined);
    return run;
  }

  async close(): Promise<void> {
    const worker = await this.worker?.catch(() => null);
    this.worker = null;
    await worker?.terminate();
  }

  private getWorker(): Promise<Worker> {
    if (!this.worker) {
      const startedAt = Date.now();
      this.worker = createWorker(this.options.language, OEM.LSTM_ONLY, { cachePath: this.options.cachePath })
        .then((worker) => {
          this.options.logger.info({ ms: Date.now() - startedAt }, 'OCR engine ready');
          return worker;
        })
        .catch((error: unknown) => {
          this.worker = null; // allow a retry (e.g. no internet on the first download)
          throw error;
        });
    }
    return this.worker;
  }
}

/**
 * Normalizes an image before OCR: applies the phone's EXIF rotation, converts to grayscale,
 * stretches the contrast and brings the size to what Tesseract reads best.
 */
export async function prepareForOcr(image: Buffer): Promise<Buffer> {
  const rotated = sharp(image, { failOn: 'none' }).rotate();
  const { width = 0 } = await rotated.metadata();
  const targetWidth = width > 0 && width < 1200 ? width * 2 : width > 3000 ? 3000 : undefined;

  const pipeline = sharp(await rotated.toBuffer()).grayscale().normalize();
  if (targetWidth) pipeline.resize({ width: targetWidth });
  return pipeline.toColourspace('b-w').png().toBuffer();
}

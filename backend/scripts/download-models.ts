/**
 * Downloads the local models once and checks that they work: the embedding model
 * (~280 MB) and the Spanish data for OCR (~15 MB).
 * Usage: npm run models:download
 */
import { env, modelsCacheDir, ocrCacheDir } from '../src/config/env.js';
import { logger } from '../src/lib/logger.js';
import { EMBEDDING_DIMENSIONS } from '../src/modules/embeddings/embedding-provider.js';
import { LocalEmbeddingProvider } from '../src/modules/embeddings/local-embedding-provider.js';
import { TesseractOcrEngine } from '../src/modules/ocr/tesseract-ocr-engine.js';

const provider = new LocalEmbeddingProvider({
  modelName: env.EMBEDDING_MODEL,
  dimensions: EMBEDDING_DIMENSIONS,
  cacheDir: modelsCacheDir,
  logger,
});

const startedAt = Date.now();
await provider.warmUp();

const query = await provider.embedQuery('¿Cuál es la indemnización por despido sin justa causa?');
const [related, unrelated] = await provider.embedDocuments([
  'En caso de despido dispuesto por el empleador sin justa causa, este deberá abonar al trabajador una indemnización equivalente a un mes de sueldo por cada año de servicio.',
  'La receta lleva harina, huevos y azúcar; hornear durante cuarenta minutos.',
]);

const cosine = (a: number[], b: number[]) => a.reduce((sum, value, i) => sum + value * b[i]!, 0);

console.log(`Modelo: ${env.EMBEDDING_MODEL} (${query.length} dimensiones), listo en ${Date.now() - startedAt} ms`);
console.log(`Similitud con texto relacionado:    ${cosine(query, related!).toFixed(3)}`);
console.log(`Similitud con texto no relacionado: ${cosine(query, unrelated!).toFixed(3)}`);

const ocr = new TesseractOcrEngine({ language: 'spa', cachePath: ocrCacheDir, logger });
const ocrStartedAt = Date.now();
await ocr.warmUp();
await ocr.close();
console.log(`OCR en español listo en ${Date.now() - ocrStartedAt} ms`);

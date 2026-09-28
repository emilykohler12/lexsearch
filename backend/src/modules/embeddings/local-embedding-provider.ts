import { env as transformersEnv, pipeline, type FeatureExtractionPipeline } from '@huggingface/transformers';
import type { Logger } from '../../lib/logger.js';
import type { EmbeddingProvider, EmbeddingStatus } from './embedding-provider.js';

interface LocalEmbeddingOptions {
  modelName: string;
  dimensions: number;
  cacheDir: string;
  logger: Logger;
  batchSize?: number;
}

/**
 * Runs a multilingual e5 model on this machine (ONNX, CPU). Document text never
 * leaves the computer to be indexed; only the model files are downloaded once.
 */
export class LocalEmbeddingProvider implements EmbeddingProvider {
  readonly modelName: string;
  readonly dimensions: number;
  private readonly batchSize: number;
  private readonly logger: Logger;
  private extractor: Promise<FeatureExtractionPipeline> | null = null;
  private currentStatus: EmbeddingStatus = 'idle';

  constructor(options: LocalEmbeddingOptions) {
    this.modelName = options.modelName;
    this.dimensions = options.dimensions;
    this.batchSize = options.batchSize ?? 16;
    this.logger = options.logger;
    transformersEnv.cacheDir = options.cacheDir;
  }

  status(): EmbeddingStatus {
    return this.currentStatus;
  }

  async warmUp(): Promise<void> {
    await this.getExtractor();
  }

  // e5 models were trained with these prefixes; skipping them hurts retrieval quality.
  embedDocuments(texts: string[]): Promise<number[][]> {
    return this.embed(texts.map((t) => `passage: ${t}`));
  }

  async embedQuery(text: string): Promise<number[]> {
    const [vector] = await this.embed([`query: ${text}`]);
    return vector!;
  }

  private getExtractor(): Promise<FeatureExtractionPipeline> {
    if (!this.extractor) {
      this.currentStatus = 'loading';
      const startedAt = Date.now();
      this.logger.info({ model: this.modelName }, 'Loading embedding model (first run downloads it)');

      this.extractor = pipeline('feature-extraction', this.modelName, { dtype: 'q8' })
        .then((extractor) => {
          this.currentStatus = 'ready';
          this.logger.info({ model: this.modelName, ms: Date.now() - startedAt }, 'Embedding model ready');
          return extractor;
        })
        .catch((error: unknown) => {
          // Allow a retry on the next call (e.g. the download failed because of the network).
          this.extractor = null;
          this.currentStatus = 'error';
          throw error;
        });
    }
    return this.extractor;
  }

  private async embed(texts: string[]): Promise<number[][]> {
    const extractor = await this.getExtractor();
    const vectors: number[][] = [];

    for (let i = 0; i < texts.length; i += this.batchSize) {
      const batch = texts.slice(i, i + this.batchSize);
      const output = await extractor(batch, { pooling: 'mean', normalize: true });
      const rows = output.tolist() as number[][];
      for (const row of rows) {
        if (row.length !== this.dimensions) {
          throw new Error(
            `El modelo ${this.modelName} devuelve vectores de ${row.length} dimensiones, pero la base espera ${this.dimensions}.`,
          );
        }
        vectors.push(row);
      }
    }
    return vectors;
  }
}

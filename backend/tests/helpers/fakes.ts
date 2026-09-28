import type { EmbeddingProvider, EmbeddingStatus } from '../../src/modules/embeddings/embedding-provider.js';
import { EMBEDDING_DIMENSIONS } from '../../src/modules/embeddings/embedding-provider.js';
import type { GroundedAnswer, GroundedAnswerInput, LlmProvider } from '../../src/modules/llm/llm-provider.js';

const normalizeWord = (word: string) =>
  word
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '');

/**
 * Deterministic bag-of-words "embedding": texts sharing words get similar vectors.
 * Good enough to test the retrieval plumbing without downloading a real model.
 */
export class FakeEmbeddingProvider implements EmbeddingProvider {
  readonly modelName = 'fake-bag-of-words';
  readonly dimensions = EMBEDDING_DIMENSIONS;

  status(): EmbeddingStatus {
    return 'ready';
  }

  async warmUp(): Promise<void> {}

  async embedDocuments(texts: string[]): Promise<number[][]> {
    return texts.map((text) => this.vectorize(text));
  }

  async embedQuery(text: string): Promise<number[]> {
    return this.vectorize(text);
  }

  private vectorize(text: string): number[] {
    const vector = new Array<number>(this.dimensions).fill(0);
    for (const word of text.split(/[^\p{L}\d]+/u).filter((w) => w.length > 2)) {
      let hash = 0;
      for (const char of normalizeWord(word)) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
      vector[hash % this.dimensions]! += 1;
    }
    const norm = Math.hypot(...vector) || 1;
    return vector.map((value) => value / norm);
  }
}

/** Answers citing the first document, and remembers what it was asked. */
export class FakeLlmProvider implements LlmProvider {
  readonly providerName = 'fake';
  readonly model = 'fake-model';
  calls: GroundedAnswerInput[] = [];

  async generateGroundedAnswer(input: GroundedAnswerInput): Promise<GroundedAnswer> {
    this.calls.push(input);
    const first = input.documents[0];
    const citedText = first?.content.slice(0, 60) ?? '';
    return {
      blocks: [
        { text: 'Según tu biblioteca, ', citations: [] },
        {
          text: 'el plazo surge del documento citado.',
          citations: first ? [{ documentIndex: 0, citedText, startChar: 0, endChar: citedText.length }] : [],
        },
      ],
      model: this.model,
      usage: { inputTokens: 1000, outputTokens: 50 },
    };
  }
}

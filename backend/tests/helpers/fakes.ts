import type { EmbeddingProvider, EmbeddingStatus } from '../../src/modules/embeddings/embedding-provider.js';
import { EMBEDDING_DIMENSIONS } from '../../src/modules/embeddings/embedding-provider.js';
import type {
  AgentRunInput,
  AgentRunResult,
  AgentToolCall,
  GroundedAnswer,
  GroundedAnswerInput,
  LlmProvider,
  StructuredInput,
  StructuredResult,
} from '../../src/modules/llm/llm-provider.js';
import type { OcrEngine, OcrResult } from '../../src/modules/ocr/ocr-engine.js';

/** "Reads" whatever text the test sets, and counts how many images it was given. */
export class FakeOcrEngine implements OcrEngine {
  text = '';
  calls = 0;

  async recognize(): Promise<OcrResult> {
    this.calls++;
    return { text: this.text, confidence: 90 };
  }

  async warmUp(): Promise<void> {}

  async close(): Promise<void> {}
}

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
  // Bag-of-words scale: texts sharing a few words score ~0.3, unrelated ones ~0.
  readonly minRelevantSimilarity = 0.1;

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

/**
 * Answers citing the first document, and remembers what it was asked. As an agent, it
 * searches the library once, reads the base model and the client's file if the request
 * names them, and writes a short draft quoting what it found — enough to exercise the
 * real tools end to end.
 */
export class FakeLlmProvider implements LlmProvider {
  readonly providerName = 'fake';
  readonly model = 'fake-model';
  calls: GroundedAnswerInput[] = [];
  agentCalls: AgentRunInput[] = [];
  agentSearchQuery = 'plazo para contestar la demanda';
  /** What a tool returned to the agent, by tool name (the last call of each). */
  toolResults: Record<string, unknown> = {};
  structuredCalls: Array<StructuredInput<unknown>> = [];
  /** What the model "returns" to structured requests: each test sets the fields it needs. */
  structuredData: unknown = {};

  /** When set, structured requests fail with it (a busy or unreachable model). */
  structuredError: Error | null = null;

  async generateStructured<T>(input: StructuredInput<T>): Promise<StructuredResult<T>> {
    this.structuredCalls.push(input as StructuredInput<unknown>);
    if (this.structuredError) throw this.structuredError;
    // Validated against the real schema, so a test can't pass with data the model could never return.
    return { data: input.schema.parse(this.structuredData), model: this.model, usage: { inputTokens: 800, outputTokens: 200 } };
  }

  async runAgent(input: AgentRunInput): Promise<AgentRunResult> {
    this.agentCalls.push(input);
    const toolCalls: AgentToolCall[] = [];
    const use = async (name: string, args: Record<string, unknown>) => {
      const tool = input.tools.find((t) => t.name === name);
      if (!tool) throw new Error(`missing tool ${name}`);
      const result = await tool.execute(args);
      toolCalls.push({ tool: name, args, ok: true });
      this.toolResults[name] = result;
      return result;
    };

    const search = (await use('buscar_en_biblioteca', { consulta: this.agentSearchQuery })) as {
      fragmentos: Array<{ texto: string }>;
    };
    const templateId = /documento_id: ([0-9a-f-]{36})/.exec(input.userMessage)?.[1];
    const template = templateId ? ((await use('leer_documento', { documento_id: templateId })) as { texto: string }) : null;
    const clientId = /cliente_id: ([0-9a-f-]{36})/.exec(input.userMessage)?.[1];
    const client = clientId
      ? ((await use('leer_ficha_cliente', { cliente_id: clientId })) as {
          cliente?: { nombre?: string };
          contraparte?: { nombre?: string };
        })
      : null;

    const text = [
      'Título: CD a Distribuidora Ejemplo',
      '',
      '```markdown',
      '# CARTA DOCUMENTO',
      '',
      `Remitente: ${client?.cliente?.nombre ?? '[COMPLETAR: nombre del remitente]'}`,
      `Destinatario: ${client ? (client.contraparte?.nombre ?? '[COMPLETAR: contraparte]') : 'Distribuidora Ejemplo S.A.'}`,
      '',
      `Fundamento: ${search.fragmentos[0]?.texto.slice(0, 60) ?? 'sin respaldo'}`,
      ...(template ? ['', `Según el modelo: ${template.texto.slice(0, 40)}`] : []),
      '```',
    ].join('\n');
    return { text, toolCalls, model: this.model, usage: { inputTokens: 2000, outputTokens: 300 } };
  }

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

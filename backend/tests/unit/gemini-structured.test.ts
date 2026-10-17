import { ApiError, FinishReason, type GoogleGenAI } from '@google/genai';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { logger } from '../../src/lib/logger.js';
import { GeminiLlmProvider, higherReasoning } from '../../src/modules/llm/gemini-llm-provider.js';
import type { ReasoningLevel } from '../../src/modules/llm/llm-provider.js';

const schema = z.object({
  nombre: z.string().describe('Nombre del cliente. Vacío si no figura.'),
  documentos: z.array(z.string()),
});

interface FakeResponse {
  data?: unknown;
  rawText?: string;
  finishReason?: FinishReason;
  blockReason?: string;
}

interface RecordedRequest {
  model: string;
  contents: Array<{ role: string; parts: Array<{ text: string }> }>;
  config: { systemInstruction?: string; responseMimeType?: string; responseJsonSchema?: unknown; [key: string]: unknown };
}

/** Stand-in for the SDK client: replays the given responses in order and records the requests. */
function fakeClient(...responses: Array<FakeResponse | Error>) {
  const requests: RecordedRequest[] = [];
  const client = {
    models: {
      generateContent: async (params: RecordedRequest) => {
        requests.push(params);
        const next = responses.shift();
        if (!next) throw new Error('unexpected extra request');
        if (next instanceof Error) throw next;
        return {
          text: next.rawText ?? JSON.stringify(next.data),
          candidates: [{ finishReason: next.finishReason ?? FinishReason.STOP }],
          promptFeedback: next.blockReason ? { blockReason: next.blockReason } : undefined,
          usageMetadata: { promptTokenCount: 700, candidatesTokenCount: 80, thoughtsTokenCount: 20 },
          modelVersion: params.model,
        };
      },
    },
  } as unknown as Pick<GoogleGenAI, 'models'>;
  return { client, requests };
}

const provider = (client: Pick<GoogleGenAI, 'models'>, fallbackModels: string[] = []) =>
  new GeminiLlmProvider({ apiKey: 'x', model: 'gemini-main', fallbackModels, logger, client });

const request = { systemPrompt: 'Armá la ficha.', userMessage: 'Vino Juan Ejemplo.', schema };

describe('higherReasoning', () => {
  it('picks the higher level and ignores an unset one', () => {
    expect(higherReasoning('low', 'high')).toBe('high');
    expect(higherReasoning('high', 'low')).toBe('high');
    expect(higherReasoning('medium', 'medium')).toBe('medium');
    expect(higherReasoning(undefined, 'low')).toBe('low');
    expect(higherReasoning('minimal', undefined)).toBe('minimal');
    expect(higherReasoning(undefined, undefined)).toBeUndefined();
  });
});

describe('GeminiLlmProvider.generateStructured', () => {
  it('asks for JSON in the given shape and returns it validated', async () => {
    const { client, requests } = fakeClient({ data: { nombre: 'Juan Ejemplo', documentos: ['DNI'] } });

    const result = await provider(client).generateStructured(request);

    expect(result).toEqual({
      data: { nombre: 'Juan Ejemplo', documentos: ['DNI'] },
      model: 'gemini-main',
      usage: { inputTokens: 700, outputTokens: 100 },
    });
    const [sent] = requests;
    expect(sent!.config).toMatchObject({ systemInstruction: 'Armá la ficha.', responseMimeType: 'application/json' });
    expect(sent!.config.responseJsonSchema).toMatchObject({
      type: 'object',
      required: ['nombre', 'documentos'],
      properties: { nombre: { description: 'Nombre del cliente. Vacío si no figura.' } },
    });
    expect(sent!.config.responseJsonSchema).not.toHaveProperty('$schema');
    expect(sent!.contents[0]!.parts[0]!.text).toBe('Vino Juan Ejemplo.');
  });

  it('tries the fallback model when the main one is busy', async () => {
    const { client, requests } = fakeClient(new ApiError({ status: 503, message: 'busy' }), {
      data: { nombre: 'Juan', documentos: [] },
    });

    const result = await provider(client, ['gemini-backup']).generateStructured(request);

    expect(requests.map((r) => r.model)).toEqual(['gemini-main', 'gemini-backup']);
    expect(result.model).toBe('gemini-backup');
  });

  it('fails clearly when the answer is not JSON or does not have the expected shape', async () => {
    await expect(provider(fakeClient({ rawText: 'Claro, acá va la ficha' }).client).generateStructured(request)).rejects.toMatchObject({
      code: 'LLM_BAD_RESPONSE',
    });
    await expect(provider(fakeClient({ data: { nombre: 5 } }).client).generateStructured(request)).rejects.toMatchObject({
      code: 'LLM_BAD_RESPONSE',
    });
  });

  it('asks for at least the reasoning the task needs', async () => {
    const sentConfig = async (configured: ReasoningLevel | undefined, minReasoning?: ReasoningLevel) => {
      const { client, requests } = fakeClient({ data: { nombre: 'Juan', documentos: [] } });
      const llm = new GeminiLlmProvider({ apiKey: 'x', model: 'gemini-main', thinkingLevel: configured, logger, client });
      await llm.generateStructured({ ...request, minReasoning });
      return requests[0]!.config;
    };

    expect((await sentConfig('low', 'medium')).thinkingConfig).toEqual({ thinkingLevel: 'MEDIUM' });
    // The level in the configuration wins when it is higher than what the task asks for.
    expect((await sentConfig('high', 'medium')).thinkingConfig).toEqual({ thinkingLevel: 'HIGH' });
    expect((await sentConfig(undefined, 'medium')).thinkingConfig).toEqual({ thinkingLevel: 'MEDIUM' });
    // Nothing is forced when neither the configuration nor the task say anything.
    expect(await sentConfig(undefined)).not.toHaveProperty('thinkingConfig');
  });

  it('uses the time asked for instead of the usual deadline', async () => {
    // A client that never answers and rejects when the deadline passes, as the real one does.
    const client = {
      models: {
        generateContent: ({ config }: RecordedRequest & { config: { abortSignal: AbortSignal } }) =>
          new Promise((_resolve, reject) => {
            config.abortSignal.addEventListener('abort', () => reject(config.abortSignal.reason));
          }),
      },
    } as unknown as Pick<GoogleGenAI, 'models'>;

    const started = Date.now();
    await expect(provider(client).generateStructured({ ...request, timeoutMs: 30 })).rejects.toMatchObject({ code: 'LLM_TIMEOUT' });
    expect(Date.now() - started).toBeLessThan(5_000); // the usual deadline is 30 s
  });

  it('reports a blocked or cut-off answer', async () => {
    await expect(
      provider(fakeClient({ rawText: '', blockReason: 'SAFETY' }).client).generateStructured(request),
    ).rejects.toMatchObject({ code: 'LLM_REFUSAL' });
    await expect(
      provider(fakeClient({ rawText: '{"nombre":', finishReason: FinishReason.MAX_TOKENS }).client).generateStructured(request),
    ).rejects.toMatchObject({ code: 'LLM_TRUNCATED' });
  });
});

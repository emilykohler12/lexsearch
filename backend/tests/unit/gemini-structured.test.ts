import { ApiError, FinishReason, type GoogleGenAI } from '@google/genai';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { logger } from '../../src/lib/logger.js';
import { GeminiLlmProvider } from '../../src/modules/llm/gemini-llm-provider.js';

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

  it('reports a blocked or cut-off answer', async () => {
    await expect(
      provider(fakeClient({ rawText: '', blockReason: 'SAFETY' }).client).generateStructured(request),
    ).rejects.toMatchObject({ code: 'LLM_REFUSAL' });
    await expect(
      provider(fakeClient({ rawText: '{"nombre":', finishReason: FinishReason.MAX_TOKENS }).client).generateStructured(request),
    ).rejects.toMatchObject({ code: 'LLM_TRUNCATED' });
  });
});

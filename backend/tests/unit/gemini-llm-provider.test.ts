import { ApiError, FinishReason, type GoogleGenAI } from '@google/genai';
import { describe, expect, it } from 'vitest';
import { UpstreamError } from '../../src/lib/errors.js';
import { logger } from '../../src/lib/logger.js';
import {
  buildUserMessage,
  GeminiLlmProvider,
  supportsThinkingLevel,
} from '../../src/modules/llm/gemini-llm-provider.js';
import { sourceTitle, toBlocksWithSourceNumbers } from '../../src/modules/rag/rag.service.js';

const input = {
  systemPrompt: 'Respondé con citas.',
  question: '¿Cuál es el plazo para contestar?',
  documents: [
    { title: 'CPCCN — pág. 4', context: 'Categoría: Legislación.', content: 'El demandado deberá contestar la demanda dentro de quince días.' },
    { title: 'Notas', content: 'En el juicio sumarísimo el plazo es de cinco días.' },
  ],
};

interface FakeResponse {
  answer?: unknown;
  rawText?: string;
  finishReason?: FinishReason;
  blockReason?: string;
}

/** The parts of a generateContent request these tests look at. */
interface RecordedRequest {
  model: string;
  contents: Array<{ parts: Array<{ text: string }> }>;
  config: { responseJsonSchema?: unknown; thinkingConfig?: unknown; abortSignal?: unknown; [key: string]: unknown };
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
          text: next.rawText ?? JSON.stringify(next.answer),
          candidates: [{ finishReason: next.finishReason ?? FinishReason.STOP }],
          promptFeedback: next.blockReason ? { blockReason: next.blockReason } : undefined,
          usageMetadata: { promptTokenCount: 900, candidatesTokenCount: 120, thoughtsTokenCount: 300 },
          modelVersion: 'gemini-test-001',
        };
      },
    },
  } as unknown as Pick<GoogleGenAI, 'models'>;
  return { client, requests };
}

const provider = (client: Pick<GoogleGenAI, 'models'>) =>
  new GeminiLlmProvider({ apiKey: 'x', model: 'gemini-test', logger, client });

describe('GeminiLlmProvider', () => {
  it('asks for structured JSON and keeps only quotes that exist in the fragment', async () => {
    const { client, requests } = fakeClient({
      answer: {
        bloques: [
          { texto: 'En el proceso ordinario, ', citas: [] },
          {
            texto: 'el plazo para contestar es de quince días.',
            citas: [{ fragmento: 1, cita: 'contestar la demanda dentro de quince días' }],
          },
          {
            texto: ' En el sumarísimo, cinco días.',
            citas: [
              { fragmento: 2, cita: 'el plazo es de diez días' }, // invented: must not be shown as a quote
              { fragmento: 7, cita: 'no existe' }, // nonexistent fragment: dropped
            ],
          },
        ],
      },
    });

    const answer = await provider(client).generateGroundedAnswer(input);

    expect(answer.model).toBe('gemini-test-001');
    expect(answer.usage).toEqual({ inputTokens: 900, outputTokens: 420 });
    expect(answer.blocks).toEqual([
      { text: 'En el proceso ordinario, ', citations: [] },
      {
        text: 'el plazo para contestar es de quince días.',
        citations: [
          { documentIndex: 0, citedText: 'contestar la demanda dentro de quince días', startChar: 20, endChar: 62 },
        ],
      },
      {
        text: ' En el sumarísimo, cinco días.',
        citations: [{ documentIndex: 1, citedText: '', startChar: null, endChar: null }],
      },
    ]);

    const [request] = requests;
    expect(request!.model).toBe('gemini-test');
    expect(request!.config).toMatchObject({
      systemInstruction: 'Respondé con citas.',
      responseMimeType: 'application/json',
    });
    expect(request!.config.responseJsonSchema).toMatchObject({ type: 'object', required: ['bloques'] });
    expect(request!.config.responseJsonSchema).not.toHaveProperty('$schema');
    const text = request!.contents[0]!.parts[0]!.text;
    expect(text).toContain('numero="1"');
    expect(text).toContain('El demandado deberá contestar la demanda dentro de quince días.');
    expect(text).toContain('Consulta del abogado:\n¿Cuál es el plazo para contestar?');
  });

  it('retries without verbatim quotes when Gemini stops for recitation', async () => {
    const { client, requests } = fakeClient(
      { rawText: '', finishReason: FinishReason.RECITATION },
      { answer: { bloques: [{ texto: 'Quince días.', citas: [{ fragmento: 1, cita: '' }] }] } },
    );

    const answer = await provider(client).generateGroundedAnswer(input);

    expect(requests).toHaveLength(2);
    expect(requests[1]!.contents[0]!.parts[0]!.text).toContain('dejá vacío el campo "cita"');
    expect(answer.blocks[0]!.citations).toEqual([{ documentIndex: 0, citedText: '', startChar: null, endChar: null }]);
  });

  it('turns safety blocks into a clear refusal', async () => {
    const blockedPrompt = fakeClient({ rawText: '', blockReason: 'SAFETY' });
    await expect(provider(blockedPrompt.client).generateGroundedAnswer(input)).rejects.toMatchObject({ code: 'LLM_REFUSAL' });

    const blockedAnswer = fakeClient({ rawText: '', finishReason: FinishReason.SAFETY });
    await expect(provider(blockedAnswer.client).generateGroundedAnswer(input)).rejects.toMatchObject({ code: 'LLM_REFUSAL' });
  });

  it('rejects malformed JSON instead of showing garbage', async () => {
    const { client } = fakeClient({ rawText: '{"bloques": [ { "texto": ' });
    await expect(provider(client).generateGroundedAnswer(input)).rejects.toMatchObject({ code: 'LLM_BAD_RESPONSE' });
  });

  it('falls back to the next model when the main one is busy, out of quota or retired', async () => {
    for (const status of [503, 429, 404]) {
      const { client, requests } = fakeClient(new ApiError({ status, message: 'busy' }), {
        answer: { bloques: [{ texto: 'Quince días.', citas: [] }] },
      });
      const fallbackProvider = new GeminiLlmProvider({
        apiKey: 'x',
        model: 'gemini-main',
        fallbackModels: ['gemini-backup'],
        logger,
        client,
      });

      const answer = await fallbackProvider.generateGroundedAnswer(input);

      expect(requests.map((r) => r.model)).toEqual(['gemini-main', 'gemini-backup']);
      expect(answer.blocks).toEqual([{ text: 'Quince días.', citations: [] }]);
    }
  });

  it('moves on to the next model when one takes too long', async () => {
    const timedOut = () => new DOMException('This operation was aborted', 'AbortError');

    const slow = fakeClient(timedOut(), { answer: { bloques: [{ texto: 'Ok.', citas: [] }] } });
    const answer = await new GeminiLlmProvider({
      apiKey: 'x',
      model: 'gemini-main',
      fallbackModels: ['gemini-backup'],
      logger,
      client: slow.client,
    }).generateGroundedAnswer(input);
    expect(slow.requests.map((r) => r.model)).toEqual(['gemini-main', 'gemini-backup']);
    expect(slow.requests[0]!.config.abortSignal).toBeInstanceOf(AbortSignal);
    expect(answer.blocks).toEqual([{ text: 'Ok.', citations: [] }]);

    const allSlow = fakeClient(timedOut(), timedOut());
    await expect(
      new GeminiLlmProvider({ apiKey: 'x', model: 'a', fallbackModels: ['b'], logger, client: allSlow.client }).generateGroundedAnswer(
        input,
      ),
    ).rejects.toMatchObject({ code: 'LLM_TIMEOUT' });
  });

  it('reports the error of the last model when every model fails', async () => {
    const { client } = fakeClient(new ApiError({ status: 503, message: 'busy' }), new ApiError({ status: 503, message: 'busy' }));
    const fallbackProvider = new GeminiLlmProvider({
      apiKey: 'x',
      model: 'gemini-main',
      fallbackModels: ['gemini-backup'],
      logger,
      client,
    });
    await expect(fallbackProvider.generateGroundedAnswer(input)).rejects.toMatchObject({ code: 'LLM_UNAVAILABLE' });
  });

  it('does not hide real request errors behind a fallback', async () => {
    const { client, requests } = fakeClient(new ApiError({ status: 400, message: 'bad' }));
    const fallbackProvider = new GeminiLlmProvider({
      apiKey: 'x',
      model: 'gemini-main',
      fallbackModels: ['gemini-backup'],
      logger,
      client,
    });
    await expect(fallbackProvider.generateGroundedAnswer(input)).rejects.toMatchObject({ code: 'LLM_BAD_REQUEST' });
    expect(requests).toHaveLength(1);
  });

  it('sets the thinking level only on models that support it', async () => {
    const answer = { answer: { bloques: [{ texto: 'Ok.', citas: [] }] } };
    const modern = fakeClient(answer);
    await new GeminiLlmProvider({ apiKey: 'x', model: 'gemini-3.5-flash', thinkingLevel: 'low', logger, client: modern.client })
      .generateGroundedAnswer(input);
    expect(modern.requests[0]!.config.thinkingConfig).toEqual({ thinkingLevel: 'LOW' });

    const legacy = fakeClient(answer);
    await new GeminiLlmProvider({ apiKey: 'x', model: 'gemini-2.5-flash', thinkingLevel: 'low', logger, client: legacy.client })
      .generateGroundedAnswer(input);
    expect(legacy.requests[0]!.config).not.toHaveProperty('thinkingConfig');

    expect(supportsThinkingLevel('gemini-3.5-flash-lite')).toBe(true);
    expect(supportsThinkingLevel('gemini-2.5-pro')).toBe(false);
  });

  it('explains API errors in Spanish', async () => {
    const cases: Array<[number, string]> = [
      [400, 'LLM_BAD_REQUEST'],
      [403, 'LLM_AUTH'],
      [404, 'LLM_MODEL'],
      [429, 'LLM_RATE_LIMIT'],
      [503, 'LLM_UNAVAILABLE'],
    ];
    for (const [status, code] of cases) {
      const { client } = fakeClient(new ApiError({ status, message: 'error' }));
      const error = await provider(client).generateGroundedAnswer(input).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(UpstreamError);
      expect(error).toMatchObject({ code });
    }
  });
});

describe('buildUserMessage', () => {
  it('wraps each fragment in delimiters that a document cannot forge', () => {
    const first = buildUserMessage(input);
    const second = buildUserMessage(input);
    const tagOf = (text: string) => /<(fragmento-[0-9a-f]{8}) numero="1">/.exec(text)?.[1];
    expect(tagOf(first)).toBeDefined();
    expect(tagOf(first)).not.toBe(tagOf(second));
    expect(first).toContain(`</${tagOf(first)}>`);
  });
});

describe('answer helpers', () => {
  it('numbers citations from 1 and drops indexes outside the sources', () => {
    const blocks = toBlocksWithSourceNumbers(
      [
        {
          text: 'x',
          citations: [
            { documentIndex: 1, citedText: 'b', startChar: 0, endChar: 1 },
            { documentIndex: 7, citedText: 'z', startChar: 0, endChar: 1 },
          ],
        },
      ],
      2,
    );
    expect(blocks[0]!.citations).toEqual([{ sourceNumber: 2, citedText: 'b', startChar: 0, endChar: 1 }]);
  });

  it('formats source titles with pages', () => {
    expect(sourceTitle({ documentTitle: 'LCT', pageStart: null, pageEnd: null })).toBe('LCT');
    expect(sourceTitle({ documentTitle: 'LCT', pageStart: 4, pageEnd: 4 })).toBe('LCT — pág. 4');
    expect(sourceTitle({ documentTitle: 'LCT', pageStart: 4, pageEnd: 5 })).toBe('LCT — págs. 4-5');
  });
});

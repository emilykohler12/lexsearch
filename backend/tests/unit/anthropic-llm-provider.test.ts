import Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it } from 'vitest';
import { UpstreamError } from '../../src/lib/errors.js';
import { logger } from '../../src/lib/logger.js';
import { AnthropicLlmProvider, toAnswerBlocks } from '../../src/modules/llm/anthropic-llm-provider.js';
import { sourceTitle, toBlocksWithSourceNumbers } from '../../src/modules/rag/rag.service.js';

/** Minimal stand-in for the SDK client: only the streaming call the provider uses. */
function fakeClient(result: object | Error) {
  const requests: unknown[] = [];
  const client = {
    beta: {
      messages: {
        stream: (params: unknown) => {
          requests.push(params);
          return {
            finalMessage: async () => {
              if (result instanceof Error) throw result;
              return result;
            },
          };
        },
      },
    },
  } as unknown as Anthropic;
  return { client, requests };
}

const baseMessage = {
  model: 'claude-opus-5',
  stop_reason: 'end_turn',
  usage: { input_tokens: 1200, output_tokens: 80 },
} as const;

const input = {
  systemPrompt: 'Respondé con citas.',
  question: '¿Cuál es el plazo?',
  documents: [
    { title: 'CPCCN — pág. 4', context: 'Categoría: Legislación.', content: 'El plazo para contestar es de quince días.' },
  ],
};

describe('AnthropicLlmProvider', () => {
  it('sends each fragment as a citable document and maps the citations back', async () => {
    const { client, requests } = fakeClient({
      ...baseMessage,
      content: [
        { type: 'thinking', thinking: '', signature: 'sig' },
        { type: 'text', text: 'El plazo es de ', citations: null },
        {
          type: 'text',
          text: 'quince días',
          citations: [
            {
              type: 'char_location',
              cited_text: 'El plazo para contestar es de quince días.',
              document_index: 0,
              document_title: 'CPCCN — pág. 4',
              start_char_index: 0,
              end_char_index: 42,
              file_id: null,
            },
          ],
        },
      ] as Anthropic.Beta.BetaContentBlock[],
    });

    const provider = new AnthropicLlmProvider({ apiKey: 'x', model: 'claude-opus-5', effort: 'medium', logger, client });
    const answer = await provider.generateGroundedAnswer(input);

    expect(answer.model).toBe('claude-opus-5');
    expect(answer.usage).toEqual({ inputTokens: 1200, outputTokens: 80 });
    expect(answer.blocks).toEqual([
      { text: 'El plazo es de ', citations: [] },
      {
        text: 'quince días',
        citations: [
          { documentIndex: 0, citedText: 'El plazo para contestar es de quince días.', startChar: 0, endChar: 42 },
        ],
      },
    ]);

    const request = requests[0] as Record<string, unknown>;
    expect(request).toMatchObject({
      model: 'claude-opus-5',
      fallbacks: 'default',
      betas: ['server-side-fallback-2026-07-01'],
      thinking: { type: 'adaptive' },
      output_config: { effort: 'medium' },
      system: 'Respondé con citas.',
    });
    const [message] = request.messages as Array<{ content: Array<Record<string, unknown>> }>;
    expect(message!.content[0]).toMatchObject({
      type: 'document',
      title: 'CPCCN — pág. 4',
      citations: { enabled: true },
      source: { type: 'text', media_type: 'text/plain', data: input.documents[0]!.content },
    });
    expect(message!.content.at(-1)).toEqual({ type: 'text', text: '¿Cuál es el plazo?' });
  });

  it('turns a refusal into a clear error instead of an empty answer', async () => {
    const { client } = fakeClient({ ...baseMessage, stop_reason: 'refusal', content: [] });
    const provider = new AnthropicLlmProvider({ apiKey: 'x', model: 'claude-opus-5', effort: 'medium', logger, client });
    await expect(provider.generateGroundedAnswer(input)).rejects.toMatchObject({ code: 'LLM_REFUSAL' });
  });

  it('explains authentication problems in Spanish', async () => {
    const authError = Anthropic.APIError.generate(
      401,
      { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } },
      'invalid x-api-key',
      new Headers(),
    );
    const { client } = fakeClient(authError);
    const provider = new AnthropicLlmProvider({ apiKey: 'x', model: 'claude-opus-5', effort: 'medium', logger, client });

    const error = await provider.generateGroundedAnswer(input).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(UpstreamError);
    expect(error).toMatchObject({ code: 'LLM_AUTH' });
  });
});

describe('answer helpers', () => {
  it('ignores non-text blocks and non-document citations', () => {
    expect(toAnswerBlocks([{ type: 'thinking', thinking: '', signature: 's' }] as Anthropic.Beta.BetaContentBlock[])).toEqual([]);
  });

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

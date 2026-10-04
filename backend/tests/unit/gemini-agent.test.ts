import { ApiError, FinishReason, type GoogleGenAI } from '@google/genai';
import { describe, expect, it } from 'vitest';
import { logger } from '../../src/lib/logger.js';
import { GeminiLlmProvider } from '../../src/modules/llm/gemini-llm-provider.js';
import type { AgentTool } from '../../src/modules/llm/llm-provider.js';

interface FakeCall {
  id?: string;
  name: string;
  args: Record<string, unknown>;
}

interface AgentRequest {
  model: string;
  contents: Array<{ role: string; parts: Array<Record<string, unknown>> }>;
  config: { toolConfig: { functionCallingConfig: { mode: string } }; [key: string]: unknown };
}

/** One model turn: either tool calls (with a reasoning signature, as Gemini 3 sends) or final text. */
const toolTurn = (...calls: FakeCall[]) => ({ calls });
const textTurn = (text: string) => ({ text });

function fakeClient(...turns: Array<{ calls?: FakeCall[]; text?: string } | Error>) {
  const requests: AgentRequest[] = [];
  const client = {
    models: {
      generateContent: async (params: AgentRequest) => {
        // Snapshot: the provider keeps pushing into the same array.
        requests.push({ ...params, contents: [...params.contents] });
        const turn = turns.shift();
        if (!turn) throw new Error('unexpected extra request');
        if (turn instanceof Error) throw turn;
        const parts = turn.calls
          ? turn.calls.map((call) => ({ functionCall: call, thoughtSignature: `sig-${call.name}` }))
          : [{ text: turn.text }];
        return {
          functionCalls: turn.calls,
          text: turn.text,
          candidates: [{ finishReason: FinishReason.STOP, content: { role: 'model', parts } }],
          usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 10, thoughtsTokenCount: 5 },
          modelVersion: params.model,
        };
      },
    },
  } as unknown as Pick<GoogleGenAI, 'models'>;
  return { client, requests };
}

function searchTool(results: unknown[] = []) {
  const received: Array<Record<string, unknown>> = [];
  const tool: AgentTool = {
    name: 'buscar_en_biblioteca',
    description: 'Busca',
    parameters: { type: 'object', properties: { consulta: { type: 'string' } }, required: ['consulta'] },
    async execute(args) {
      received.push(args);
      if (args.consulta === 'falla') throw new Error('la base no responde');
      return { fragmentos: results };
    },
  };
  return { tool, received };
}

const provider = (client: Pick<GoogleGenAI, 'models'>, fallbackModels: string[] = []) =>
  new GeminiLlmProvider({ apiKey: 'x', model: 'gemini-main', fallbackModels, logger, client });

const run = (p: GeminiLlmProvider, tools: AgentTool[], maxToolRounds = 4) =>
  p.runAgent({ systemPrompt: 'Redactá.', userMessage: 'Carta documento', tools, maxToolRounds });

describe('GeminiLlmProvider.runAgent', () => {
  it('runs the tools the model asks for and returns its final text', async () => {
    const { tool, received } = searchTool([{ texto: 'Art. 338' }]);
    const { client, requests } = fakeClient(
      toolTurn({ id: 'c1', name: 'buscar_en_biblioteca', args: { consulta: 'plazo contestar' } }),
      textTurn('# CARTA DOCUMENTO'),
    );

    const result = await run(provider(client), [tool]);

    expect(received).toEqual([{ consulta: 'plazo contestar' }]);
    expect(result).toMatchObject({
      text: '# CARTA DOCUMENTO',
      toolCalls: [{ tool: 'buscar_en_biblioteca', args: { consulta: 'plazo contestar' }, ok: true }],
      model: 'gemini-main',
      usage: { inputTokens: 200, outputTokens: 30 },
    });

    // The model's turn goes back untouched (with its signature), followed by the tool result.
    const [, second] = requests;
    expect(second!.contents).toHaveLength(3);
    expect(second!.contents[1]!.parts[0]).toMatchObject({ thoughtSignature: 'sig-buscar_en_biblioteca' });
    expect(second!.contents[2]).toEqual({
      role: 'user',
      parts: [{ functionResponse: { id: 'c1', name: 'buscar_en_biblioteca', response: { resultado: { fragmentos: [{ texto: 'Art. 338' }] } } } }],
    });
  });

  it('reports tool failures and unknown tools to the model instead of crashing', async () => {
    const { tool } = searchTool();
    const { client, requests } = fakeClient(
      toolTurn({ name: 'buscar_en_biblioteca', args: { consulta: 'falla' } }, { name: 'borrar_todo', args: {} }),
      textTurn('Listo'),
    );

    const result = await run(provider(client), [tool]);

    expect(result.toolCalls).toEqual([
      { tool: 'buscar_en_biblioteca', args: { consulta: 'falla' }, ok: false, error: 'la base no responde' },
      { tool: 'borrar_todo', args: {}, ok: false, error: 'unknown tool' },
    ]);
    const responses = requests[1]!.contents[2]!.parts;
    expect(responses).toHaveLength(2); // one answer per call
    expect(responses[1]).toMatchObject({ functionResponse: { name: 'borrar_todo', response: { error: expect.any(String) } } });
  });

  it('forbids more tools once the rounds are used up', async () => {
    const { tool } = searchTool();
    const { client, requests } = fakeClient(
      toolTurn({ name: 'buscar_en_biblioteca', args: { consulta: 'a' } }),
      textTurn('Borrador con lo encontrado'),
    );

    await run(provider(client), [tool], 1);

    expect(requests.map((r) => r.config.toolConfig.functionCallingConfig.mode)).toEqual(['AUTO', 'NONE']);
  });

  it('restarts the whole run on the fallback model when the main one is busy', async () => {
    const { tool } = searchTool();
    const { client, requests } = fakeClient(
      toolTurn({ name: 'buscar_en_biblioteca', args: { consulta: 'a' } }),
      new ApiError({ status: 503, message: 'busy' }),
      textTurn('Borrador del respaldo'),
    );

    const result = await run(provider(client, ['gemini-backup']), [tool]);

    expect(requests.map((r) => r.model)).toEqual(['gemini-main', 'gemini-main', 'gemini-backup']);
    expect(requests[2]!.contents).toHaveLength(1); // fresh start: only the lawyer's request
    expect(result).toMatchObject({ text: 'Borrador del respaldo', model: 'gemini-backup' });
  });

  it('fails clearly when the model returns nothing', async () => {
    const { client } = fakeClient(textTurn(''));
    await expect(run(provider(client), [])).rejects.toMatchObject({ code: 'LLM_BAD_RESPONSE' });
  });
});

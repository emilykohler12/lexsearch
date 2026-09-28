import Anthropic from '@anthropic-ai/sdk';
import { UpstreamError } from '../../lib/errors.js';
import type { Logger } from '../../lib/logger.js';
import type {
  AnswerBlock,
  AnswerCitation,
  GroundedAnswer,
  GroundedAnswerInput,
  LlmProvider,
} from './llm-provider.js';

export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

interface AnthropicProviderOptions {
  apiKey: string;
  model: string;
  effort: Effort;
  logger: Logger;
  /** Injectable for tests. */
  client?: Anthropic;
}

// Re-runs a request on Anthropic's recommended fallback model if a safety
// classifier declines it, instead of failing the lawyer's query.
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

export class AnthropicLlmProvider implements LlmProvider {
  readonly providerName = 'anthropic';
  readonly model: string;
  private readonly effort: Effort;
  private readonly client: Anthropic;
  private readonly logger: Logger;

  constructor(options: AnthropicProviderOptions) {
    this.model = options.model;
    this.effort = options.effort;
    this.logger = options.logger;
    this.client = options.client ?? new Anthropic({ apiKey: options.apiKey });
  }

  async generateGroundedAnswer(input: GroundedAnswerInput): Promise<GroundedAnswer> {
    // Each retrieved fragment goes in its own document block with citations enabled:
    // the API then returns the exact quoted text and which fragment it came from.
    const documents: Anthropic.Beta.BetaRequestDocumentBlock[] = input.documents.map((doc) => ({
      type: 'document',
      source: { type: 'text', media_type: 'text/plain', data: doc.content },
      title: doc.title,
      ...(doc.context ? { context: doc.context } : {}),
      citations: { enabled: true },
    }));

    let message: Anthropic.Beta.BetaMessage;
    try {
      message = await this.client.beta.messages
        .stream({
          model: this.model,
          max_tokens: 16000,
          betas: [FALLBACK_BETA],
          fallbacks: 'default',
          thinking: { type: 'adaptive' },
          output_config: { effort: this.effort },
          system: input.systemPrompt,
          messages: [{ role: 'user', content: [...documents, { type: 'text', text: input.question }] }],
        })
        .finalMessage();
    } catch (error) {
      throw toUpstreamError(error, this.logger);
    }

    if (message.stop_reason === 'refusal') {
      throw new UpstreamError(
        'LLM_REFUSAL',
        'Claude no pudo responder esta consulta por sus políticas de seguridad. Probá reformulando la pregunta.',
        422,
      );
    }
    if (message.stop_reason === 'max_tokens') {
      this.logger.warn({ model: message.model }, 'Answer truncated by max_tokens');
    }

    return {
      blocks: toAnswerBlocks(message.content),
      model: message.model,
      usage: { inputTokens: message.usage.input_tokens, outputTokens: message.usage.output_tokens },
    };
  }
}

/** Keeps the visible text and its citations; drops thinking and other internal blocks. */
export function toAnswerBlocks(content: Anthropic.Beta.BetaContentBlock[]): AnswerBlock[] {
  const blocks: AnswerBlock[] = [];
  for (const block of content) {
    if (block.type !== 'text') continue;
    const citations: AnswerCitation[] = [];
    for (const citation of block.citations ?? []) {
      if (citation.type === 'char_location') {
        citations.push({
          documentIndex: citation.document_index,
          citedText: citation.cited_text,
          startChar: citation.start_char_index,
          endChar: citation.end_char_index,
        });
      }
    }
    blocks.push({ text: block.text, citations });
  }
  return blocks;
}

function toUpstreamError(error: unknown, logger: Logger): Error {
  if (!(error instanceof Anthropic.APIError)) return error as Error;

  // The provider's error message never contains client data; safe to log.
  logger.error({ status: error.status, message: error.message }, 'Claude API error');

  if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
    return new UpstreamError(
      'LLM_AUTH',
      'La API key de Claude no es válida o no tiene permisos. Revisá ANTHROPIC_API_KEY en el archivo .env.',
    );
  }
  if (error instanceof Anthropic.RateLimitError) {
    return new UpstreamError('LLM_RATE_LIMIT', 'Se alcanzó el límite de uso de Claude. Esperá un minuto y volvé a intentar.', 429);
  }
  if (error instanceof Anthropic.NotFoundError) {
    return new UpstreamError('LLM_MODEL', 'El modelo configurado en ANTHROPIC_MODEL no existe o no está disponible para tu cuenta.');
  }
  if (error instanceof Anthropic.BadRequestError) {
    return new UpstreamError(
      'LLM_BAD_REQUEST',
      'Claude rechazó la solicitud. Si es tu primera consulta, revisá que tu cuenta de Anthropic tenga crédito cargado (console.anthropic.com → Billing).',
    );
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return new UpstreamError('LLM_CONNECTION', 'No se pudo conectar con Claude. Revisá tu conexión a internet.');
  }
  return new UpstreamError('LLM_UNAVAILABLE', 'Claude no está disponible en este momento. Probá de nuevo en unos minutos.');
}

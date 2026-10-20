import { UpstreamError, ServiceUnavailableError, safeErrorMessage } from '../../lib/errors.js';
import type { Logger } from '../../lib/logger.js';
import type { InteractionsRepository } from '../interactions/interactions.repository.js';
import type { LlmProvider } from '../llm/llm-provider.js';
import { loadPrompt, PROMPT_VERSIONS } from '../llm/prompts.js';
import {
  buildFeedbackRequest,
  buildTurnRequest,
  findUnverifiedCitations,
  modelTurnSchema,
  normalizeTurn,
  type DialogueTurn,
  type Dossier,
  type NormalizedTurn,
} from './hearing-dialogue.js';
import { modelFeedbackSchema, normalizeFeedback } from './hearing-feedback.js';
import type { HearingFeedback } from './hearings.schemas.js';

export const HEARING_TURN_MODULE = 'hearing-turn';
export const HEARING_FEEDBACK_MODULE = 'hearing-feedback';

/** A turn is a short answer: the lawyer is waiting for it. The feedback reads the whole conversation. */
const TURN_TIMEOUT_MS = 45_000;
const FEEDBACK_TIMEOUT_MS = 90_000;

interface HearingSimulatorDeps {
  llm: LlmProvider | null;
  interactions: InteractionsRepository;
  logger: Logger;
}

export interface SimulatedTurn extends NormalizedTurn {
  /** Norms and rulings it named that the material doesn't mention. */
  unverifiedCitations: string[];
  model: string;
}

/**
 * The judge or the lawyer of the other side: it says the next thing in the conversation, and when the
 * practice ends it tells the lawyer how it went. It only proposes; nothing here has legal effect.
 */
export class HearingSimulator {
  constructor(private readonly deps: HearingSimulatorDeps) {}

  /** Throws when there is no model: the practice can't start without one. */
  private requireLlm(): LlmProvider {
    if (!this.deps.llm) {
      throw new ServiceUnavailableError(
        'LLM_NOT_CONFIGURED',
        'Para practicar una audiencia con IA hace falta configurar GEMINI_API_KEY en el archivo .env y reiniciar el servidor.',
      );
    }
    return this.deps.llm;
  }

  assertConfigured(): void {
    this.requireLlm();
  }

  /** What the character says next: the opening when nobody has spoken yet. */
  async nextTurn(simulationId: string, dossier: Dossier, turns: DialogueTurn[]): Promise<SimulatedTurn> {
    const llm = this.requireLlm();
    const { interactions, logger } = this.deps;
    const prompt = loadPrompt(PROMPT_VERSIONS.hearingSimulator);
    const opening = turns.length === 0;
    // What is recorded: where in the conversation we are and how big the material is (the texts are in the practice itself).
    const input = { simulationId, role: dossier.role, turn: turns.length, materialChars: dossier.materialText.length, withCase: dossier.caseContext !== '' };
    const startedAt = Date.now();

    try {
      const result = await llm.generateStructured({
        systemPrompt: prompt.text,
        userMessage: buildTurnRequest(dossier, turns),
        schema: modelTurnSchema,
        timeoutMs: TURN_TIMEOUT_MS,
        minReasoning: 'low',
      });
      const turn = normalizeTurn(result.data, opening);
      if (!turn) throw new UpstreamError('LLM_EMPTY_RESPONSE', 'La IA no devolvió una respuesta. Probá de nuevo.');

      // The AI is told not to cite what isn't in the material; whatever slipped through is marked for the lawyer.
      const unverifiedCitations = findUnverifiedCitations(turn.content, `${dossier.materialText}\n${dossier.caseContext}`);
      await interactions
        .create({
          module: HEARING_TURN_MODULE,
          input,
          output: { kind: turn.kind, topic: turn.topic, chars: turn.content.length, unverifiedCitations },
          model: result.model,
          promptVersion: prompt.version,
          inputTokens: result.usage.inputTokens,
          outputTokens: result.usage.outputTokens,
          durationMs: Date.now() - startedAt,
          status: 'SUCCESS',
        })
        .catch((error: unknown) => logger.error({ err: error }, 'Could not record a hearing-turn interaction'));
      return { ...turn, unverifiedCitations, model: result.model };
    } catch (error) {
      await this.recordFailure(HEARING_TURN_MODULE, input, prompt.version, llm.model, startedAt, error);
      throw error;
    }
  }

  /** How it went: what was good, what to reinforce and what to have ready, each point with the lawyer's own words. */
  async feedback(simulationId: string, dossier: Dossier, turns: DialogueTurn[]): Promise<{ feedback: HearingFeedback; model: string }> {
    const llm = this.requireLlm();
    const { interactions, logger } = this.deps;
    const prompt = loadPrompt(PROMPT_VERSIONS.hearingFeedback);
    const input = { simulationId, role: dossier.role, turns: turns.length, materialChars: dossier.materialText.length };
    const startedAt = Date.now();

    try {
      const result = await llm.generateStructured({
        systemPrompt: prompt.text,
        userMessage: buildFeedbackRequest(dossier, turns),
        schema: modelFeedbackSchema,
        timeoutMs: FEEDBACK_TIMEOUT_MS,
        minReasoning: 'medium',
      });
      const feedback = normalizeFeedback(result.data, {
        lawyer: turns
          .filter((turn) => turn.speaker === 'USER')
          .map((turn) => turn.content)
          .join('\n'),
        brief: dossier.materialText,
      });
      await interactions
        .create({
          module: HEARING_FEEDBACK_MODULE,
          input,
          output: { strengths: feedback.strengths.length, weaknesses: feedback.weaknesses.length, prepare: feedback.prepare.length },
          model: result.model,
          promptVersion: prompt.version,
          inputTokens: result.usage.inputTokens,
          outputTokens: result.usage.outputTokens,
          durationMs: Date.now() - startedAt,
          status: 'SUCCESS',
        })
        .catch((error: unknown) => logger.error({ err: error }, 'Could not record a hearing-feedback interaction'));
      return { feedback, model: result.model };
    } catch (error) {
      await this.recordFailure(HEARING_FEEDBACK_MODULE, input, prompt.version, llm.model, startedAt, error);
      throw error;
    }
  }

  private async recordFailure(module: string, input: object, promptVersion: string, model: string, startedAt: number, error: unknown): Promise<void> {
    await this.deps.interactions
      .create({
        module,
        input,
        model,
        promptVersion,
        durationMs: Date.now() - startedAt,
        status: 'FAILED',
        errorMessage: safeErrorMessage(error),
      })
      .catch((logError: unknown) => this.deps.logger.error({ err: logError }, 'Could not record a failed interaction'));
  }
}

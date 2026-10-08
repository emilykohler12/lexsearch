import type { Client } from '../../generated/prisma/client.js';
import { NotFoundError, ServiceUnavailableError } from '../../lib/errors.js';
import type { Logger } from '../../lib/logger.js';
import type { InteractionsRepository } from '../interactions/interactions.repository.js';
import type { LlmProvider } from '../llm/llm-provider.js';
import { loadPrompt, PROMPT_VERSIONS } from '../llm/prompts.js';
import { buildIntakeRequest, modelProposalSchema, normalizeProposal, type ClientProposal } from './client-intake.js';
import type { ClientsRepository } from './clients.repository.js';
import type { CreateClientInput, UpdateClientInput } from './clients.schemas.js';

export const CLIENT_INTAKE_MODULE = 'client-intake';

interface ClientsServiceDeps {
  repository: ClientsRepository;
  llm: LlmProvider | null;
  interactions: InteractionsRepository;
  logger: Logger;
}

export class ClientsService {
  constructor(private readonly deps: ClientsServiceDeps) {}

  create(input: CreateClientInput): Promise<Client> {
    return this.deps.repository.create(input);
  }

  list() {
    return this.deps.repository.list();
  }

  async get(id: string): Promise<Client> {
    const client = await this.deps.repository.findById(id);
    if (!client) throw new NotFoundError('El cliente no existe o fue eliminado');
    return client;
  }

  async update(id: string, data: UpdateClientInput): Promise<Client> {
    await this.get(id);
    return this.deps.repository.update(id, data);
  }

  /** Drafts written for the client are kept: the link is cleared (see the Draft relation). */
  async delete(id: string): Promise<void> {
    await this.get(id);
    await this.deps.repository.delete(id);
  }

  /**
   * Reads the notes of a first meeting and proposes the client file. Nothing is saved: the
   * lawyer reviews the proposal in the form and decides what to keep.
   */
  async analyzeNotes(notes: string): Promise<ClientProposal> {
    const { llm, interactions, logger } = this.deps;
    if (!llm) {
      throw new ServiceUnavailableError(
        'LLM_NOT_CONFIGURED',
        'Para completar la ficha con IA hace falta configurar GEMINI_API_KEY en el archivo .env y reiniciar el servidor.',
      );
    }

    const prompt = loadPrompt(PROMPT_VERSIONS.clientIntake);
    const startedAt = Date.now();

    try {
      const result = await llm.generateStructured({
        systemPrompt: prompt.text,
        userMessage: buildIntakeRequest(notes),
        schema: modelProposalSchema,
      });
      const proposal = normalizeProposal(result.data);
      const durationMs = Date.now() - startedAt;

      const interaction = await interactions.create({
        module: CLIENT_INTAKE_MODULE,
        input: { notes },
        output: { proposal: { ...proposal } },
        model: result.model,
        promptVersion: prompt.version,
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        durationMs,
        status: 'SUCCESS',
      });
      logger.info({ interactionId: interaction.id, ms: durationMs }, 'Client notes analyzed');
      return proposal;
    } catch (error) {
      await interactions
        .create({
          module: CLIENT_INTAKE_MODULE,
          input: { notes },
          model: llm.model,
          promptVersion: prompt.version,
          durationMs: Date.now() - startedAt,
          status: 'FAILED',
          errorMessage: error instanceof Error ? error.message : String(error),
        })
        .catch((logError: unknown) => logger.error({ err: logError }, 'Could not record failed interaction'));
      throw error;
    }
  }
}

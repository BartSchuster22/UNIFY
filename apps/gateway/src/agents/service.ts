import type { HermesGatewayService } from '../hermes-control/service.js';
import type { MutationService } from '../mutations/service.js';
import type { MutationInput } from '../mutations/types.js';
import type { PageQuery } from '../hermes-control/client.js';

export type AgentOperation =
  'profile.create' | 'profile.update' | 'profile.rename' | 'profile.delete';

export type AgentMutationBody = {
  expectedSourceVersion: string;
  description?: string;
  newId?: string;
  mode?: 'validate' | 'dry-run' | 'execute';
  confirmed?: boolean;
};

/**
 * Governed Agent management is deliberately a thin projection over native
 * Hermes profiles. UNIFY never persists a competing Agent/profile record.
 */
export class AgentManagementService {
  constructor(
    private readonly hermes: HermesGatewayService,
    private readonly mutations: MutationService | null,
  ) {}

  async list(frameworkId: string, query: PageQuery) {
    const profiles = await this.hermes.profiles(frameworkId, query);
    return {
      ...profiles,
      items: profiles.items.map((profile) => ({
        ...profile,
        kind: 'agent' as const,
        agentId: `${frameworkId}:${profile.id}`,
        nativeProfileId: profile.id,
      })),
    };
  }

  mutation(
    operationType: AgentOperation,
    frameworkId: string,
    nativeProfileId: string,
    body: AgentMutationBody,
  ): MutationInput {
    const mutations = this.requireMutations();
    const payload: Record<string, unknown> = {
      expectedSourceVersion: body.expectedSourceVersion,
    };
    if (body.description !== undefined) payload.description = body.description;
    if (body.newId !== undefined) payload.newId = body.newId;
    return mutations.parse({
      operationType,
      target: {
        owner: 'hermes',
        kind: 'profile',
        nativeId: nativeProfileId,
        frameworkId,
      },
      payload,
      mode: body.mode ?? 'execute',
      confirmed: body.confirmed === true,
    });
  }

  permission(input: MutationInput) {
    return this.requireMutations().permission(input);
  }

  run(actorUserId: string, idempotencyKey: string | undefined, input: MutationInput) {
    return this.requireMutations().run(actorUserId, idempotencyKey, input);
  }

  private requireMutations() {
    if (!this.mutations) throw new Error('Governed Agent mutations are unavailable');
    return this.mutations;
  }
}

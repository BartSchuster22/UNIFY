import type { HermesGatewayService } from '../hermes-control/service.js';
import type { MutationService } from '../mutations/service.js';

export type KanbanMutationBody = {
  expectedSourceVersion: string;
  mode?: 'validate' | 'dry-run' | 'execute';
  body?: string;
  assignee?: string;
  priority?: number;
  triage?: boolean;
  reason?: string;
  result?: string;
};

export class KanbanManagementService {
  constructor(
    private readonly hermes: HermesGatewayService,
    private readonly mutations: MutationService | null,
  ) {}

  async boards(frameworkId: string, query: { cursor?: string; limit?: number }) {
    const response = await this.hermes.boards(frameworkId, query);
    return {
      ...response,
      items: response.items.map((board: Record<string, unknown>) => ({
        ...board,
        owner: 'hermes' as const,
        frameworkId,
        kind: 'kanban-board' as const,
        kanbanBoardId: `${frameworkId}:${String(board.id)}`,
        nativeBoardId: board.id,
      })),
    };
  }

  async cards(frameworkId: string, boardId: string, query: { cursor?: string; limit?: number }) {
    const response = await this.hermes.tasks(frameworkId, boardId, query);
    return {
      ...response,
      items: response.items.map((task: Record<string, unknown>) => ({
        ...task,
        owner: 'hermes' as const,
        frameworkId,
        kind: 'kanban-card' as const,
        kanbanCardId: `${frameworkId}:${boardId}:${String(task.id)}`,
        nativeBoardId: boardId,
        nativeTaskId: task.id,
      })),
    };
  }

  mutation(
    operationType:
      | 'work.task.create'
      | 'work.task.start'
      | 'work.task.block'
      | 'work.task.unblock'
      | 'work.task.complete',
    frameworkId: string,
    boardId: string,
    taskId: string,
    body: KanbanMutationBody & { title?: string },
  ) {
    if (!this.mutations) throw new Error('Governed Kanban mutations are unavailable');
    const { mode = 'execute', expectedSourceVersion, ...payload } = body;
    return this.mutations.parse({
      operationType,
      target: { owner: 'hermes', kind: 'task', nativeId: taskId, frameworkId },
      payload: { ...payload, boardId, expectedSourceVersion },
      mode,
      confirmed: false,
    });
  }

  permission(input: ReturnType<MutationService['parse']>) {
    if (!this.mutations) throw new Error('Governed Kanban mutations are unavailable');
    return this.mutations.permission(input);
  }

  run(
    actorUserId: string,
    idempotencyKey: string | undefined,
    input: ReturnType<MutationService['parse']>,
  ) {
    if (!this.mutations) throw new Error('Governed Kanban mutations are unavailable');
    return this.mutations.run(actorUserId, idempotencyKey, input);
  }
}

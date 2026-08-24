import { describe, expect, it, vi } from 'vitest';
import { KanbanManagementService } from './service.js';

function fixture() {
  const boards = vi.fn().mockResolvedValue({
    meta: { owner: 'hermes', frameworkId: 'hermes-alica', sourceVersion: 'sha256:boards' },
    items: [{ id: 'default', name: 'Default' }],
    page: { hasMore: false },
  });
  const tasks = vi.fn().mockResolvedValue({
    meta: { owner: 'hermes', frameworkId: 'hermes-alica', sourceVersion: 'sha256:tasks' },
    items: [{ id: 'task-1', boardId: 'default', title: 'Do it', status: 'backlog' }],
    page: { hasMore: false },
  });
  const parse = vi.fn((value) => value);
  const permission = vi.fn(() => 'work.manage');
  const run = vi.fn().mockResolvedValue({ operation: { state: 'verified' } });
  const service = new KanbanManagementService(
    { boards, tasks } as never,
    { parse, permission, run } as never,
  );
  return { service, boards, tasks, parse, permission, run };
}

describe('governed Kanban exposure', () => {
  it('projects native boards and cards without becoming a second owner', async () => {
    const { service } = fixture();
    expect(await service.boards('hermes-alica', { limit: 100 })).toMatchObject({
      items: [
        {
          owner: 'hermes',
          kind: 'kanban-board',
          kanbanBoardId: 'hermes-alica:default',
          nativeBoardId: 'default',
        },
      ],
    });
    expect(await service.cards('hermes-alica', 'default', { limit: 100 })).toMatchObject({
      items: [
        {
          owner: 'hermes',
          kind: 'kanban-card',
          kanbanCardId: 'hermes-alica:default:task-1',
          nativeBoardId: 'default',
          nativeTaskId: 'task-1',
        },
      ],
    });
  });

  it('maps lifecycle requests to exact framework and board scoped work mutations', async () => {
    const { service, parse, permission, run } = fixture();
    const input = service.mutation('work.task.block', 'hermes-alica', 'default', 'task-1', {
      expectedSourceVersion: 'sha256:tasks',
      mode: 'execute',
      reason: 'waiting',
    });
    expect(parse).toHaveBeenCalledWith({
      operationType: 'work.task.block',
      target: { owner: 'hermes', kind: 'task', nativeId: 'task-1', frameworkId: 'hermes-alica' },
      payload: { reason: 'waiting', boardId: 'default', expectedSourceVersion: 'sha256:tasks' },
      mode: 'execute',
      confirmed: false,
    });
    expect(service.permission(input as never)).toBe('work.manage');
    await service.run('operator-1', 'phase3-block', input as never);
    expect(permission).toHaveBeenCalledOnce();
    expect(run).toHaveBeenCalledWith('operator-1', 'phase3-block', input);
  });
});

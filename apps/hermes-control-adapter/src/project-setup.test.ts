import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProjectSetupStore } from './project-setup.js';
import { HermesNativeSource } from './source.js';
import type { HermesWorkCommand } from '@aquiero/contracts';
const homes: string[] = [];
afterEach(async () => { for (const path of homes.splice(0)) await rm(path, { recursive: true, force: true }); });
async function fixture() {
  const home = await mkdtemp(join(tmpdir(), 'dsh-selectors-')); homes.push(home);
  const root = join(home, 'workspace'); await mkdir(join(root, 'project-a'), { recursive: true });
  return { home, root, store: new ProjectSetupStore(home) };
}
const command = (payload: Record<string, unknown>): HermesWorkCommand => ({ operation: 'project.create', targetId: 'qa', payload, mode: 'execute', idempotencyKey: 'qa-selectors', requestId: 'request-qa', correlationId: 'qa', actor: { type: 'user', id: 'qa' } });
describe('authoritative project setup', () => {
  it('reads the installed native archived marker and preserves the actual project name', async () => {
    const { store } = await fixture();
    const source = new HermesNativeSource({ projectSetupStore: store, runner: { run: async args => args[1] === 'list'
      ? '  qa  QA Project (archived)  [1 folder(s)]'
      : 'qa  [p_test] (archived)\n  name: QA Project\n  primary: /qa' } });
    const project = (await source.projects()).items[0];
    expect(project?.name).toBe('QA Project');
    expect(project?.archived).toBe(true);
  });
  it('enumerates only bounded approved writable directories, excluding symlinks and hidden state', async () => {
    const { home, root, store } = await fixture();
    await mkdir(join(root, '.private')); await symlink(home, join(root, 'escape'));
    expect((await store.workspaces()).map(x => x.path)).toEqual([root, join(root, 'project-a')]);
    for (const path of [home, '/etc', join(root, 'escape'), root + '/../workspace', join(root, 'missing')]) await expect(store.validateWorkspace(path)).rejects.toThrow();
    expect(await store.validateWorkspace(root)).toBe(root);
  });
  it('rejects a replaced symlink root rather than browsing its target', async () => {
    const { home, root, store } = await fixture(); await rm(root, { recursive: true }); await symlink(home, root);
    expect(await store.workspaces()).toEqual([]); await expect(store.validateWorkspace(root)).rejects.toThrow();
  });
  it('persists project teams across instances with explicit ownership and no cross-project writes', async () => {
    const { home, store } = await fixture();
    const team = { projectManager: 'default', agents: ['builder'], teamConfigurationOwner: 'dsh-hermes-adapter' as const };
    await store.write('qa', team);
    expect(await new ProjectSetupStore(home).read('qa')).toEqual(team);
    expect(await store.read('other')).toBeUndefined();
    await expect(store.write('../other', team)).rejects.toThrow();
  });
  it('rejects stale or cross-framework agent IDs and unsafe paths before invoking any mutating CLI', async () => {
    const { store } = await fixture(); const calls: string[][] = [];
    const source = new HermesNativeSource({ projectSetupStore: store, runner: { async run(args) { calls.push(args); return args.join(' ') === 'profile list' ? ' default test stopped —\n builder test stopped —\n' : ''; } } });
    for (const payload of [{ name: 'QA', projectManager: 'other-framework-agent' }, { name: 'QA', agents: ['removed-agent'] }, { name: 'QA', defaultWorkspacePath: '/etc' }]) await expect(source.executeWork(command(payload))).rejects.toThrow();
    expect(calls.every(args => args[0] === 'profile')).toBe(true);
  });
  it('binds the real native workspace and board and reads back team configuration from its owner store', async () => {
    const { root, store } = await fixture(); const calls: string[][] = [];
    let created = false; let primary = '';
    const source = new HermesNativeSource({ projectSetupStore: store, runner: { async run(args) {
      calls.push(args); const key = args.join(' ');
      if (key === 'profile list') return ' default test stopped —\n builder test stopped —\n';
      if (key === 'project list --all') return created ? 'qa QA [1 folder(s)]\n' : '';
      if (key === 'project show qa') return ` name: QA\n board: qa\n primary: ${primary}\n`;
      if (args[0] === 'project' && args[1] === 'create') created = true;
      if (args[0] === 'project' && args[1] === 'add-folder') primary = args[3]!;
      if (key === 'kanban boards list --json --all') return '[]';
      return '';
    } } });
    await source.executeWork(command({ name: 'QA', defaultWorkspacePath: root, projectManager: 'default', agents: ['builder'], startPmPlanning: false }));
    expect(calls).toContainEqual(['project', 'add-folder', 'qa', root, '--primary']);
    expect(calls).toContainEqual(['kanban', 'boards', 'set-default-workdir', 'qa', root]);
    expect((await source.projects()).items[0]).toMatchObject({ defaultWorkspacePath: root, projectManager: 'default', agents: ['builder'], teamConfigurationOwner: 'dsh-hermes-adapter' });
    expect(calls.some(args => args.includes('promote') || args[0] === 'chat')).toBe(false);
  });
});

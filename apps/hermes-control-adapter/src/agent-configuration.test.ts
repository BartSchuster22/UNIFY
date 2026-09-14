import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentConfigurationStore } from './agent-configuration.js';
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
async function fixture() {
 const root = await mkdtemp(join(tmpdir(), 'agent-sections-')); roots.push(root);
 const home = join(root, 'profiles', 'qa'); await mkdir(home, { recursive: true });
 await writeFile(join(home,'config.yaml'), 'memory:\n  memory_char_limit: 20\n  user_char_limit: 20\n');
 await writeFile(join(home,'profile.yaml'), 'description: Original\nretained: true\n');
 return { root, home, store: new AgentConfigurationStore(root) };
}
const values = { instructions: 'You are a QA agent. Do not execute tasks.', memory: 'QA memory', userMemory: 'QA user', description: 'QA identity' };
describe('authoritative Agent sections', () => {
 it('validates without rewriting content, persists native files with backups and rejects stale edits', async () => {
  const { root, home, store } = await fixture(); const initial = await store.run('qa','read');
  await store.run('qa','validate',{ revision: initial.revision, values });
  expect(await readdir(home)).not.toContain('state');
  expect(await readFile(join(home,'profile.yaml'),'utf8')).toContain('Original');
  const saved = await store.run('qa','write',{ revision: initial.revision, values });
  expect(saved).toMatchObject(values);
  expect(await new AgentConfigurationStore(root).run('qa','read')).toMatchObject(saved);
  expect(await readFile(join(home,'SOUL.md'),'utf8')).toBe(values.instructions);
  expect(await readFile(join(home,'memories','MEMORY.md'),'utf8')).toBe(values.memory);
  expect(await readFile(join(home,'memories','USER.md'),'utf8')).toBe(values.userMemory);
  expect(await readFile(join(home,'profile.yaml'),'utf8')).toContain('retained: true');
  expect(await readdir(join(home,'state','dsh-agent-edit-backups'))).toHaveLength(1);
  await expect(store.run('qa','write',{ revision: initial.revision, values: { ...values, memory: 'overwrite' } })).rejects.toMatchObject({ conflict: true });
  expect((await store.run('qa','read')).memory).toBe(values.memory);
 });
 it('includes native configuration in revisions and refuses unavailable runtime changes', async () => {
  const { home, store } = await fixture(); const before = await store.run('qa','read');
  expect(before.runtime.available).toBe(false);
  const config = await readFile(join(home,'config.yaml'),'utf8');
  await expect(store.run('qa','validate',{ revision: before.revision, values, runtime: { primary: null, fallbacks: [], tools: {}, skills: {} } })).rejects.toThrow();
  expect(await readFile(join(home,'config.yaml'),'utf8')).toBe(config);
  await writeFile(join(home,'config.yaml'), config + 'native_agent_edit: true\n');
  await expect(store.run('qa','write',{ revision: before.revision, values })).rejects.toMatchObject({ conflict: true });
  expect(await readdir(home)).not.toContain('state');
 });
 it('serializes competing editors and detects agent-side changes to memory', async () => {
  const { home, store } = await fixture(); const before = await store.run('qa','read');
  const results = await Promise.allSettled([store.run('qa','write',{ revision: before.revision, values }),store.run('qa','write',{ revision: before.revision, values: { ...values, instructions: 'Different intent' } })]);
  expect(results.filter(x => x.status==='fulfilled')).toHaveLength(1);
  const opened = await store.run('qa','read'); await writeFile(join(home,'memories','MEMORY.md'),'Agent addition');
  await expect(store.run('qa','write',{ revision: opened.revision, values })).rejects.toMatchObject({ conflict: true });
  expect(await readFile(join(home,'memories','MEMORY.md'),'utf8')).toBe('Agent addition');
 });
 it('enforces configured limits, normalizes native entry delimiters, and preserves config', async () => {
  const { home, store } = await fixture(); const before = await store.run('qa','read');
  const config = await readFile(join(home,'config.yaml'),'utf8');
  await expect(store.run('qa','write',{ revision: before.revision, values: { ...values, memory: 'x'.repeat(21) } })).rejects.toThrow('limit');
  const saved = await store.run('qa','write',{ revision: before.revision, values: { ...values, memory: '  memo\n§\nmemo  ' } });
  expect(saved.memory).toBe('memo'); expect(await readFile(join(home,'config.yaml'),'utf8')).toBe(config);
 });
 it('rejects traversal, missing homes and linked documents without touching their targets', async () => {
  const { root, home, store } = await fixture(); const other = join(root,'protected');await writeFile(other,'unchanged');
  await symlink(other, join(home,'SOUL.md'));
  await expect(store.run('qa','read')).rejects.toThrow();
  await expect(store.run('../qa','read')).rejects.toThrow();
  await expect(store.run('missing','read')).rejects.toThrow();
  expect(await readFile(other,'utf8')).toBe('unchanged');
 });
});

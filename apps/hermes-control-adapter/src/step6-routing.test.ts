import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HermesNativeSource, type CommandRunner } from './source.js';
import { ProjectSetupStore } from './project-setup.js';
import { mapBounded } from './bounded-map.js';

const homes: string[] = [];
afterEach(async () => { await Promise.all(homes.splice(0).map(home => rm(home, {recursive:true, force:true}))); });
async function setup(details?: string, list = 'alpha Alpha [1 folder(s)]\n') {
  const home = await mkdtemp(join(tmpdir(), 'step6-routing-')); homes.push(home);
  const workspace = join(home, 'workspace'); await mkdir(workspace);
  const run = vi.fn<CommandRunner['run']>(async args => {
    if (args.join(' ') === 'project list --all') return list;
    if (args[0] === 'project' && args[1] === 'show') return details ?? `name: Alpha\nboard: board-a\nprimary: ${workspace}\n`;
    if (args.includes('create')) return JSON.stringify({id:'t-proof',status:'todo'});
    throw new Error(`Unexpected CLI: ${args.join(' ')}`);
  });
  const source = new HermesNativeSource({runner:{run}, projectSetupStore:new ProjectSetupStore(home)});
  const create = () => source.executeWork({mode:'execute',operation:'task.create',targetId:'proof',idempotencyKey:'proof-key',requestId:'proof',correlationId:'proof',actor:{type:'user',id:'owner'},payload:{boardId:'board-a',title:'Relative file task',body:'Read input.csv; write result.json.',defaultWorkspacePath:undefined}});
  return {home,workspace,run,source,create};
}
describe('Step 6 native project routing', () => {
  it('passes the native project and approved directory without prompt path injection', async () => {
    const f = await setup(); await f.create();
    const args = f.run.mock.calls.find(([args]) => args.includes('create'))![0];
    expect(args).toContain('--project'); expect(args[args.indexOf('--project')+1]).toBe('alpha');
    expect(args[args.indexOf('--workspace')+1]).toBe(`dir:${f.workspace}`);
    expect(args[args.indexOf('--body')+1]).toBe('Read input.csv; write result.json.');
  });
  it('rejects a workspace removed since project setup before creating a task', async () => {
    const f = await setup(); await rm(f.workspace,{recursive:true});
    await expect(f.create()).rejects.toThrow('Workspace is unavailable');
    expect(f.run.mock.calls.some(([a])=>a.includes('create'))).toBe(false);
  });
  it('rejects ambiguous native board mappings', async () => {
    const f = await setup(undefined,'alpha Alpha [1 folder(s)]\nbeta Beta [1 folder(s)]\n');
    await expect(f.create()).rejects.toThrow('multiple projects');
    expect(f.run.mock.calls.some(([a])=>a.includes('create'))).toBe(false);
  });
  it('rejects archived project routing', async () => {
    const f = await setup(undefined,'alpha Alpha [1 folder(s)] [archived]\n');
    await expect(f.create()).rejects.toThrow('archived project');
  });
  it('preserves native defaults for boards without a project', async () => {
    const f = await setup(undefined,''); await f.create();
    const args = f.run.mock.calls.find(([args])=>args.includes('create'))![0];
    expect(args).not.toContain('--project'); expect(args).not.toContain('--workspace');
  });
});
describe('bounded native reads', () => {
  it('limits concurrency, preserves source order and waits for all admitted work', async () => {
    let active=0, peak=0;
    const result = await mapBounded([4,3,2,1,0],2,async n=>{active++;peak=Math.max(peak,active);await new Promise(r=>setTimeout(r,n));active--;return n*2;});
    expect(result).toEqual([8,6,4,2,0]);expect(peak).toBe(2);expect(active).toBe(0);
  });
  it('fails closed rather than manufacturing an empty collection', async () => {
    await expect(mapBounded([1,2,3],2,async n=>{if(n===2)throw new Error('native unavailable');return n;})).rejects.toThrow('native unavailable');
  });
});

describe('Step 6 native execution evidence', () => {
  it('exposes native outcomes/artifacts/session without treating the task prompt as a result', async () => {
    const native = JSON.parse(await readFile(new URL('./fixtures/step6-native-runtime.json', import.meta.url), 'utf8'));
    const evidence = native.tasks.t_aba997f6;
    const run = vi.fn(async (args: string[]) => args.includes('show') ? JSON.stringify(evidence) : JSON.stringify([{...evidence.task, status:'running'}]));
    const source = new HermesNativeSource({runner:{run}});
    const task = (await source.tasks('qa-evidence')).items[0]!;
    expect(task.status).toBe('done');
    expect(task.runs?.[0]).toMatchObject({id:1,outcome:'completed',sessionId:'20260914_215917_654218',artifacts:['/opt/data/workspace/qa-browser-work-0db5b665/result.json']});
    expect(task.runs?.[0]?.summary).not.toBe(task.body);
    expect(task.executionUnavailable).toBeUndefined();
  });
  it('keeps task identity and explicitly marks unavailable details instead of inventing a result', async () => {
    const source = new HermesNativeSource({runner:{run:async args=>{if(args.includes('show'))throw new Error('timeout');return JSON.stringify([{id:'t-proof',title:'Read result.json',status:'running'}]);}}});
    expect((await source.tasks('qa-evidence')).items[0]).toMatchObject({id:'t-proof',executionUnavailable:true});
    expect((await source.tasks('qa-evidence')).items[0]?.runs).toBeUndefined();
  });
});

it('reads production native collections without per-project or per-task CLI fanout', async()=>{
 const run=vi.fn(async()=>{throw new Error('Unexpected CLI fanout');});
 const nativeWorkRead=vi.fn(async(kind:string)=>kind==='projects'?[{slug:'qa-bulk',name:'QA bulk',board_slug:'qa-bulk',primary_path:'/qa',archived:false}]:[{task:{id:'t-bulk',title:'Bulk proof',status:'done',workspace_path:'/qa',project_id:'p-bulk'},runs:[{id:3,status:'done',outcome:'completed',summary:'Real native summary',metadata:{worker_session_id:'session-bulk'}}]}]);
 const source=new HermesNativeSource({runner:{run},nativeWorkRead});
 expect((await source.projects()).items[0]).toMatchObject({id:'qa-bulk',boardId:'qa-bulk',defaultWorkspacePath:'/qa'});
 expect((await source.tasks('qa-bulk')).items[0]).toMatchObject({id:'t-bulk',runs:[{id:3,summary:'Real native summary',sessionId:'session-bulk'}]});
 expect(run).not.toHaveBeenCalled();expect(nativeWorkRead).toHaveBeenCalledTimes(2);
});

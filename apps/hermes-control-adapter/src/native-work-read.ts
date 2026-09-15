import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

// Pinned native APIs, one subprocess per collection, no per-row CLI startup.
export const nativeWorkReadBridge = String.raw`
import dataclasses,json,re,sys
kind,identity=sys.argv[1:]
if kind=='projects':
 from hermes_cli import projects_db as p
 with p.connect_closing() as c:
  c.execute('BEGIN')
  out=[x.to_dict() for x in p.list_projects(c,include_archived=True)]
elif kind=='tasks':
 if not re.fullmatch(r'[a-zA-Z0-9][a-zA-Z0-9._-]{0,199}',identity):raise ValueError('Invalid board')
 from hermes_cli import kanban_db as k
 path=k.kanban_db_path(board=identity)
 if not path.is_file():raise ValueError('Board unavailable')
 with k.connect_closing(path) as c:
  c.execute('BEGIN')
  ids=[r[0] for r in c.execute('SELECT id FROM tasks ORDER BY id LIMIT 1001')]
  if len(ids)>1000:raise ValueError('Board exceeds bounded task inventory')
  out=[{'task':dataclasses.asdict(k.get_task(c,i)),'runs':[dataclasses.asdict(r) for r in k.list_runs(c,i)]} for i in ids]
else:raise ValueError('Unknown collection')
print(json.dumps(out))
`;
export async function readNativeWork(kind:'projects'|'tasks', identity=''):Promise<unknown[]> {
  const {stdout}=await promisify(execFile)('python3',['-c',nativeWorkReadBridge,kind,identity],{timeout:10_000,maxBuffer:16*1024*1024});
  const value:unknown=JSON.parse(stdout);
  if(!Array.isArray(value))throw new Error('Invalid native collection');
  return value;
}

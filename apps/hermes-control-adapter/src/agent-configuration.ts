import { runtimeBridge } from './agent-runtime.js';
import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';

// Pinned Hermes layout and memory serialization; no arbitrary client-supplied file paths.
const bridge = String.raw`
import sys,os,json,re,hashlib,fcntl,tempfile,uuid,contextlib
from pathlib import Path
import yaml
base=Path(sys.argv[1]).absolute(); ident=sys.argv[2]; mode=sys.argv[3]
if not re.fullmatch(r'[a-z0-9][a-z0-9_-]{0,127}',ident): raise ValueError('Invalid Agent ID')
home=base if ident=='default' else base/'profiles'/ident
if not home.is_dir(): raise ValueError('Agent home is unavailable')
for p in [base,base/'profiles',home,home/'memories']:
 if p.is_symlink(): raise ValueError('Linked Agent directories are not editable')
paths={'instructions':home/'SOUL.md','memory':home/'memories/MEMORY.md','userMemory':home/'memories/USER.md','metadata':home/'profile.yaml','config':home/'config.yaml'}
for p in [*paths.values(),home/'config.yaml']:
 if p.is_symlink(): raise ValueError('Linked Agent files are not editable')
def raw(p):
 if not p.exists(): return None
 if not p.is_file() or p.stat().st_size>262144: raise ValueError('Agent file is not a bounded text file')
 return p.read_text(encoding='utf-8')
config=yaml.safe_load(raw(home/'config.yaml') or '{}') or {}
if not isinstance(config,dict): raise ValueError('Agent configuration is invalid')
mc=config.get('memory') or {}
limits={'instructions':65536,'memory':int(mc.get('memory_char_limit',2200)),'userMemory':int(mc.get('user_char_limit',1375))}
if any(v<1 or v>65536 for v in limits.values()): raise ValueError('Agent memory limits are unsupported')
${runtimeBridge}
def snapshot():
 global config,limits
 values={k:raw(p) for k,p in paths.items()}
 config=yaml.safe_load(values['config'] or '{}') or {}
 if not isinstance(config,dict):raise ValueError('Agent configuration is invalid')
 mc=config.get('memory') or {}
 limits={'instructions':65536,'memory':int(mc.get('memory_char_limit',2200)),'userMemory':int(mc.get('user_char_limit',1375))}
 if any(v<1 or v>65536 for v in limits.values()):raise ValueError('Agent memory limits are unsupported')
 revision='sha256:'+hashlib.sha256(json.dumps(values,sort_keys=True,ensure_ascii=False).encode()).hexdigest()
 meta=yaml.safe_load(values['metadata'] or '{}') or {}
 if not isinstance(meta,dict): raise ValueError('Agent identity metadata is invalid')
 return values,{'id':ident,'description':str(meta.get('description') or '').strip(),'instructions':values['instructions'] or '', 'memory':values['memory'] or '', 'userMemory':values['userMemory'] or '', 'revision':revision,'limits':limits}
def atomic(p,text):
 fd,name=tempfile.mkstemp(prefix='.dsh-edit-',dir=p.parent)
 try:
  with os.fdopen(fd,'w',encoding='utf-8') as f: f.write(text);f.flush();os.fsync(f.fileno())
  os.replace(name,p)
 finally:
  if os.path.exists(name): os.unlink(name)
@contextlib.contextmanager
def lock(p):
 if p.is_symlink(): raise ValueError('Linked lock files are not editable')
 fd=os.open(p,os.O_CREAT|os.O_RDWR|os.O_NOFOLLOW,0o600)
 try:fcntl.flock(fd,fcntl.LOCK_EX);yield
 finally:os.close(fd)
payload=json.load(sys.stdin)
if mode in ['write','initialize']: (home/'memories').mkdir(exist_ok=True,mode=0o700)
with contextlib.ExitStack() as stack:
 stack.enter_context(lock(home/'.dsh-agent-edit.lock'))
 for key in ['memory','userMemory']:
  p=paths[key]
  if p.parent.exists():stack.enter_context(lock(p.with_suffix(p.suffix+'.lock')))
 before,state=snapshot()
 if mode=='read':
  try:
   import io
   with contextlib.redirect_stdout(io.StringIO()):state['runtime'],_=runtime_inventory(config)
  except Exception:state['runtime']={'available':False,'reason':'Native runtime inventory is unavailable; existing settings are preserved'}
  print(json.dumps(state));sys.exit(0)
 if mode!='initialize' and payload.get('revision')!=state['revision']:
  print(json.dumps({'error':'conflict'}));sys.exit(0)
 values=payload.get('values')
 if not isinstance(values,dict) or set(values)!=set(['instructions','memory','userMemory','description']):raise ValueError('Invalid Agent sections')
 for key,value in values.items():
  if not isinstance(value,str) or '\x00' in value:raise ValueError('Agent sections must be text')
  if key in ['memory','userMemory']:values[key]='\n§\n'.join(dict.fromkeys(x.strip() for x in value.split('\n§\n') if x.strip()))
  if len(values[key])>(5000 if key=='description' else limits[key]):raise ValueError('Agent section exceeds its configured limit')
 if 'runtime' in payload:
  import io
  with contextlib.redirect_stdout(io.StringIO()):
   inventory,chain=runtime_inventory(config);candidate=apply_runtime(config,payload['runtime'],inventory,chain)
  if candidate!=config:values['config']=yaml.safe_dump(candidate,sort_keys=False,allow_unicode=True)
 if any(raw(paths[k])!=v for k,v in before.items()):
  print(json.dumps({'error':'conflict'}));sys.exit(0)
 if mode=='validate': print(json.dumps(state));sys.exit(0)
 backup=home/'state'/'dsh-agent-edit-backups'
 for p in [home/'state',backup]:
  if p.is_symlink():raise ValueError('Linked backup directories are not supported')
 backup.mkdir(parents=True,exist_ok=True,mode=0o700);backup=backup/uuid.uuid4().hex;backup.mkdir(mode=0o700)
 for k,v in before.items():
  if v is not None:atomic(backup/(k+'.bak'),v)
 description=values.pop('description').strip()
 if description!=state['description']:
  meta=yaml.safe_load(before['metadata'] or '{}') or {};meta['description']=description;meta['description_auto']=False
  values['metadata']=yaml.safe_dump(meta,sort_keys=False,allow_unicode=True)
 values={k:v for k,v in values.items() if (before[k] or '')!=v}
 written=[]
 try:
  for key,text in values.items():atomic(paths[key],text);written.append(key)
  after,result=snapshot()
  if any(after[k]!=v for k,v in values.items()):raise ValueError('Agent readback did not match')
 except Exception:
  for key in reversed(written):
   if raw(paths[key])==values[key]:
    if before[key] is None:paths[key].unlink()
    else:atomic(paths[key],before[key])
  raise
 atomic(backup/'status.json',json.dumps({'status':'verified','before':state['revision'],'after':result['revision']}))
 print(json.dumps(result))
`;
export class AgentConfigurationError extends Error {
  constructor(readonly conflict: boolean, message: string) { super(message); }
}
export class AgentConfigurationStore {
  constructor(private readonly home = process.env.HERMES_HOME || join(homedir(), '.hermes')) {}
  async run(id: string, mode: 'read' | 'validate' | 'write' | 'initialize', payload: unknown = {}): Promise<Record<string, any>> {
    return new Promise((resolve, reject) => {
      const child = spawn('python3', ['-c', bridge, this.home, id, mode], { stdio: ['pipe','pipe','pipe'] });
      let output = ''; let errors = '';
      const timer = setTimeout(() => child.kill('SIGKILL'), 90_000);
      child.stdout.on('data', chunk => { output += chunk; if (output.length > 1024 * 1024) child.kill('SIGKILL'); });
      child.stderr.on('data', chunk => { errors = (errors + chunk).slice(-2000); });
      child.on('error', error => { clearTimeout(timer); reject(error); });
      child.on('close', code => {
        clearTimeout(timer);
        if (code !== 0) return reject(new AgentConfigurationError(false, errors.includes('exceeds its configured limit') ? 'Agent section exceeds its configured limit' : 'Agent configuration is unavailable or invalid; no success is claimed'));
        try { const result = JSON.parse(output); if (result.error === 'conflict') reject(new AgentConfigurationError(true, 'Agent files changed; reload before saving')); else resolve(result); }
        catch { reject(new AgentConfigurationError(false, 'Agent configuration returned invalid data')); }
      });
      child.stdin.on('error', () => undefined);
      child.stdin.end(JSON.stringify(payload));
    });
  }
}

import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';

// Profile identifiers are an adapter projection. All content stays in Hermes SessionDB.
export function conversationIdentity(id: string) {
  if (!id.startsWith('p:')) return { profile: 'default', nativeId: id };
  const match = /^p:([a-z0-9][a-z0-9_-]{0,127}):([a-zA-Z0-9_-]{1,200})$/.exec(id);
  if (!match || match[1] === 'default') throw new Error('Invalid profile conversation identifier');
  return { profile: match[1]!, nativeId: match[2]! };
}
export function profileConversationId(profile: string, id: string) {
  const qualified = `p:${profile}:${id}`;
  conversationIdentity(qualified);
  return qualified;
}

export const profileConversationBridge = String.raw`
import sys,json,re,hashlib,os
from pathlib import Path
base=Path(sys.argv[1]).absolute();profile=sys.argv[2];mode=sys.argv[3];q=json.load(sys.stdin)
if not re.fullmatch(r'[a-z0-9][a-z0-9_-]{0,127}',profile) or (profile=='default' and mode!='configuration'):raise ValueError('Invalid named profile')
home=base if profile=='default' else base/'profiles'/profile
for p in [base,base/'profiles',home,home/'state.db',home/'state.db-wal',home/'state.db-shm']:
 if p.is_symlink():raise ValueError('Linked profile storage is forbidden')
if not home.is_dir():raise ValueError('Profile does not exist')
config_path=home/'config.yaml'
if config_path.is_symlink():raise ValueError('Linked configuration is forbidden')
import yaml
config=yaml.safe_load(config_path.read_text()) if config_path.exists() else {}
if not isinstance(config,dict):raise ValueError('Invalid profile configuration')
m=config.get('model') or {};model=m.get('default') if isinstance(m,dict) else m
provider=m.get('provider') if isinstance(m,dict) else None
if mode=='configuration':print(json.dumps({'model':model,'provider':provider}));sys.exit(0)
if mode=='list' and not (home/'state.db').exists():print('[]');sys.exit(0)
os.environ['HERMES_HOME']=str(home)
from hermes_state import SessionDB
db=SessionDB(db_path=home/'state.db')
def public(row):
 return {k:row[k] for k in ['id','session_id','title','source','started_at','updated_at','model','profile_name'] if k in row}
def internal(row):
 return row and row.get('source')=='api_server' and not any(row.get(k) for k in ['chat_id','thread_id','session_key'])
if mode=='list':
 print(json.dumps([public(r) for r in db.list_sessions_rich(source='api_server',limit=500,min_message_count=0) if internal(r)]));sys.exit(0)
if mode=='create':
 key=q['key'];title=q['title']
 if not isinstance(model,str) or not model.strip() or model=='hermes-agent':raise ValueError('Configure a real model for this profile first')
 if q.get('model') and q['model']!=model:raise ValueError('Selected model changed; reload the profile')
 if not isinstance(key,str) or not key or len(key)>1000 or not isinstance(title,str) or not title.strip() or len(title)>500:raise ValueError('Invalid create request')
 sid='dsh_'+hashlib.sha256((profile+'\0'+key).encode()).hexdigest()[:32]
 row=db.get_session(sid)
 if row:
  if not internal(row) or row.get('title')!=title:raise ValueError('Session identity conflict')
 else:
  db.create_session(session_id=sid,source='api_server',profile_name=profile,model=model)
  db.set_session_title(sid,title)
 row=db.get_session(sid)
 if not internal(row):raise ValueError('Session creation was not verified')
 print(json.dumps({'session':public(row)}));sys.exit(0)
sid=q['id']
if not isinstance(sid,str) or not re.fullmatch(r'[a-zA-Z0-9_-]{1,200}',sid):raise ValueError('Invalid session ID')
row=db.get_session(sid)
if not internal(row):raise ValueError('Session is unavailable or belongs to an external channel')
if mode=='get':print(json.dumps({'session':public(row)}));sys.exit(0)
if mode=='messages':print(json.dumps({'data':db.get_messages(sid,limit=500)}));sys.exit(0)
raise ValueError('Unsupported native conversation operation')
`;

export class ProfileConversations {
  constructor(private readonly home = process.env.HERMES_HOME || join(homedir(), '.hermes')) {}
  async run(
    profile: string,
    mode: 'list' | 'create' | 'get' | 'messages' | 'configuration',
    payload: unknown = {},
  ): Promise<any> {
    return new Promise((resolve, reject) => {
      const child = spawn('python3', ['-c', profileConversationBridge, this.home, profile, mode], {
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      let output = '';
      const timer = setTimeout(() => child.kill('SIGKILL'), 15_000);
      child.stdout.on('data', (x) => {
        output += x;
        if (output.length > 4 * 1024 * 1024) child.kill('SIGKILL');
      });
      child.stderr.resume(); // Never publish CLI/environment details or secrets.
      child.on('error', (e) => {
        clearTimeout(timer);
        reject(e);
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        if (code !== 0)
          return reject(
            new Error('Native profile conversation is unavailable; no fallback runtime was used'),
          );
        try {
          resolve(JSON.parse(output));
        } catch {
          reject(new Error('Invalid native conversation response'));
        }
      });
      child.stdin.on('error', () => undefined);
      child.stdin.end(JSON.stringify(payload));
    });
  }
}

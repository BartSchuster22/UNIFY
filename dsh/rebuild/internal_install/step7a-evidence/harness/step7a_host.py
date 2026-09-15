import hashlib,json,os,sqlite3,subprocess,sys,time
from pathlib import Path
os.umask(0o077)
ROOT=Path('/opt/dsh2-internal-dev3');SAVE=Path('/var/lib/alica-dsh-internal/step7a-acceptance');BUNDLE=Path('/var/lib/alica-dsh-internal/dev3-step6-2/bundle');PIN='9fada00ddd15fbaf19638ad532072c15ce336587399fbb31ba2f07f1f06a5382'
NAMES={'/dsh2-internal-dev3-'+s+'-1' for s in ['hermes','unify-core','uniui','caddy','keycloak','memory-v4','postgresql']}
FILES=['config.yaml','profile.yaml','SOUL.md','memories/MEMORY.md','memories/USER.md','.env','auth.json']
def run(args,timeout=400):
 p=subprocess.run(args,capture_output=True,text=True,timeout=timeout)
 if p.returncode:raise RuntimeError('Command failed: '+args[0]+' exit '+str(p.returncode)+' '+p.stderr[-1500:])
 return p.stdout

def rows():return json.loads(run(['docker','inspect',*run(['docker','ps','-aq']).split()]))
def identities(rs):return {r['Name']:{'id':r['Id'],'image':r['Image'],'started':r['State']['StartedAt'],'running':r['State']['Running']} for r in rs}
def home(rs):return Path(next(m['Source'] for r in rs if r['Name']=='/dsh2-internal-dev3-hermes-1' for m in r['Mounts'] if m['Destination']=='/opt/data'))
def hashes(h):return {n:hashlib.sha256((h/n).read_bytes()).hexdigest() if (h/n).is_file() else None for n in FILES}
def boards(h):
 out={}
 for db in sorted(h.glob('**/kanban.db')):
  c=sqlite3.connect('file:'+str(db)+'?mode=ro',uri=True);c.row_factory=sqlite3.Row
  out[str(db.relative_to(h))]={'tasks':[dict(r) for r in c.execute('SELECT * FROM tasks ORDER BY id')],'runs':[dict(r) for r in c.execute('SELECT * FROM task_runs ORDER BY id')]};c.close()
 return out

def verify():
 base=json.loads((SAVE/'baseline.json').read_text());rs=rows();h=home(rs);assert hashes(h)==base['ownerHashes'],'Owner file changed'
 current=identities(rs);assert {n:r for n,r in current.items() if n not in NAMES}==base['unrelated'],'Unrelated container changed'
 bs=boards(h)
 for k,v in base['boards'].items():assert bs[k]==v,'Pre-existing board changed: '+k
 owned=[r for r in rs if r['Name'] in NAMES];assert len(owned)==7
 assert all(r['State']['Running'] and r['State']['Health']['Status']=='healthy' for r in owned)
 sys.path.insert(0,str(BUNDLE));from install import Installer
 i=Installer(BUNDLE,PIN,ROOT,json.loads((ROOT/'operations/request.json').read_text()));assert i.plan()['state']=='installed'
 sys.path.insert(0,'/usr/local/lib/alica-dsh-ops/dsh2-internal-dev3');from doghouse_dsh.broker import Broker,SERVICES
 by={r['Config']['Labels']['com.docker.compose.service']:r for r in owned}
 Broker(ROOT/'operations/broker.json').verify_identity([by[s] for s in SERVICES])
 from doghouse_dsh.engine import Engine
 engine=Engine(ROOT/'operations/ops.db');assert not engine.meta('maintenance',False);engine.db.close()
 run(['systemctl','is-active','--quiet','alica-dsh2-internal-dev3-broker.service','alica-dsh2-internal-dev3-observer.service'])
 return {'maintenanceCleared':True,'brokerAndObserverActive':True,'brokerIdentityVerified':True,'ownerFilesUnchanged':True,'preexistingBoardsAndRunsUnchanged':True,'unrelatedContainersUnchanged':True,'healthyServices':7,'installerState':'installed','identities':{n:r for n,r in current.items() if n in NAMES}}

def lifecycle(action):return json.loads(run(['/usr/bin/python3',str(BUNDLE/'ops.py'),action,'--bundle',str(BUNDLE),'--release-sha256',PIN,'--root',str(ROOT),'--request',str(ROOT/'operations/request.json')]))
mode=sys.argv[1]
assert os.geteuid()==0
if mode=='baseline':
 assert not SAVE.exists();SAVE.mkdir(mode=0o700);rs=rows();h=home(rs);bs=boards(h)
 assert all(t['status'] not in ['running','ready','todo','scheduled','review'] for b in bs.values() for t in b['tasks']),'Existing active work'
 for n in FILES:
  if (h/n).is_file():(SAVE/n.replace('/','_')).write_bytes((h/n).read_bytes())
 ids=identities(rs);data={'ownerHashes':hashes(h),'home':str(h),'unrelated':{n:r for n,r in ids.items() if n not in NAMES},'owned':{n:r for n,r in ids.items() if n in NAMES},'boards':bs}
 (SAVE/'baseline.json').write_text(json.dumps(data));print(json.dumps({'baselineCaptured':True,**verify()}))
elif mode=='verify':print(json.dumps(verify()))
elif mode=='restart':
 label=sys.argv[2];assert label in ['continuity','interruption'];assert not (SAVE/(label+'.json')).exists()
 before=verify();rs=rows();h=home(rs);qas=[p.name for p in (h/'profiles').iterdir() if p.is_dir() and p.name.startswith('qa-step7a-')];assert len(qas)==1
 for path,b in boards(h).items():
  assert all(t['status'] not in ['running','ready','todo','scheduled','review'] or qas[0] in Path(path).parts for t in b['tasks']),'Unrelated active work prevents restart'
 events=[];started=time.monotonic()
 try:
  events.append({'action':'stop','result':lifecycle('stop')})
  stopped=rows();assert all(not r['State']['Running'] for r in stopped if r['Name'] in NAMES)
  events.append({'allSevenStopped':True})
 finally:
  # Even a failed stop assertion must attempt supported service restoration.
  events.append({'action':'start','result':lifecycle('start')})
 after=verify();assert all(after['identities'][n]['started']!=before['identities'][n]['started'] for n in NAMES)
 data={'label':label,'elapsedSeconds':round(time.monotonic()-started,2),'events':events,'before':before,'after':after}
 (SAVE/(label+'.json')).write_text(json.dumps(data));print(json.dumps(data))
else:raise ValueError(mode)

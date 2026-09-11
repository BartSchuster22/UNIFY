"""Live post-restore proof on QA5; replays only an existing completed request."""
import hashlib,json,os,sqlite3,sys,time
from pathlib import Path
os.environ['DSH_STAGE5_QA_CELL']='dsh2-stage5-qa5'
sys.path.insert(0,'/srv/alica-dsh-qa/qa')
from qa_common import CELL,ROOT,OUT,APP,http,backend  # type: ignore[import-not-found]
import host_operations as q
import backup_dsh2 as b
import logical_state
import urllib.error
end=time.monotonic()+30
while True:
 try:
  if http(APP,'/api/state')[0]==401:break
 except (urllib.error.URLError,TimeoutError):pass
 assert time.monotonic()<end,'Reference TLS service not ready'
 time.sleep(0.25)
assert CELL=='dsh2-stage5-qa5'
manifest=json.loads(Path('/var/lib/alica-stage6-recovery/restored-manifest.json').read_text())
rows={r['name']:r for r in manifest['entries']}
def digest(p):return hashlib.sha256(p.read_bytes()).hexdigest()
for name in ['owner.json','compose.json']:
 assert digest(ROOT/name)==rows['root-'+CELL+'/'+name]['sha256']
for p in (ROOT/'secrets').iterdir():
 if p.is_file():assert digest(p)==rows['root-'+CELL+'/secrets/'+p.name]['sha256']
assert digest(OUT/'test-owner-password')==rows['qa-'+CELL+'/test-owner-password']['sha256']
code="from cron import jobs;from hermes_cli import kanban_db;import json;alljobs=jobs.list_jobs(include_disabled=True);assert not jobs.list_jobs();c=kanban_db.connect();tasks=[dict(r) for r in c.execute('SELECT id,session_id,status FROM tasks ORDER BY id')];print(json.dumps({'tasks':tasks,'jobs':alljobs}))"
summary=json.loads(b.run(['docker','exec',CELL+'-hermes-1','/opt/hermes/.venv/bin/python','-c',code]));assert summary==manifest['metadata']['nativeBefore'],'Native tasks/schedule changed'
snapshot=q.snap();assert q.healthy(snapshot) and not snapshot['maintenance']
assert snapshot['snapshot']['nativeWork']['observed'] and snapshot['snapshot']['nativeWork']['active']==0
before=logical_state.snapshot()
passwords=json.loads((OUT/'customer-passwords.json').read_text())
def login(name):
 s,data,h=http(APP,'/api/login','POST',{'username':name,'password':passwords[name]},{'Origin':APP});assert s==200
 return {'Cookie':h['Set-Cookie'].split(';',1)[0],'X-CSRF-Token':data['csrf'],'Origin':APP}
a=login('alice');other=login('bob');assert http(APP,'/api/state')[0]==401
id=json.loads((OUT/'first-request.json').read_text())['id']
db=sqlite3.connect('file:'+str(OUT/'reference-data/reference.sqlite3')+'?mode=ro',uri=True)
key,payload,rid=db.execute('SELECT client_key,payload,receipt FROM requests WHERE id=?',(id,)).fetchone();db.close()
payload=json.loads(payload);assert set(payload)=={'contractVersion','question','operation','subject'},'Unexpected predecessor input shape'
s,answer,_=http(APP,'/api/requests','POST',{'question':payload['question'],'operation':payload['operation'],'key':key},a);assert s==202 and answer['id']==id
s,state,_=http(APP,'/api/state',headers=a);assert s==200
saved=next(row for row in state['requests'] if row['id']==id);assert saved['state']=='result-ready' and saved['receiptId']==rid
s,other_state,_=http(APP,'/api/state',headers=other);assert s==200 and all(row['id']!=id for row in other_state['requests'])
probe="import os,json,ssl,urllib.request;from pathlib import Path;base=os.environ['REFERENCE_CORE_URL'];assert base=='https://stage5.qa.invalid:8443';ctx=ssl.create_default_context(cafile=os.environ['REFERENCE_CORE_CA_FILE']);token=Path(os.environ['REFERENCE_CORE_TOKEN_FILE']).read_text().strip();req=urllib.request.Request(base+"+repr('/api/v1/application/requests/'+rid)+",headers={'Authorization':'Bearer '+token});handler=type('NoRedirect',(urllib.request.HTTPRedirectHandler,),{'redirect_request':lambda self,*a,**k:None})();opener=urllib.request.build_opener(urllib.request.ProxyHandler({}),urllib.request.HTTPSHandler(context=ctx),handler);response=opener.open(req,timeout=20);v=json.load(response);print(json.dumps({'status':response.status,'phase':v['receipt']['phase']}))"
result=json.loads(b.run(['docker','exec','dsh5-reference-qa5','python3','-I','-c',probe]));assert result=={'status':200,'phase':'result-ready'}
after=logical_state.snapshot();assert before==after,'Replay or restart changed durable logical work/effects'
report={'schema':'stage6-live-restore-check/v1','checkedAt':time.time(),'allSevenServicesHealthy':True,'ownerAndSecretsPreserved':True,'nativeTaskSessionAndPausedSchedulePreserved':True,'maintenanceOff':True,'activeNativeWork':0,'existingApplicationReceiptReadable':True,'originalCustomerCredentialsWork':True,'customerIsolationPreserved':True,'sameRequestReplayDeduplicated':True,'noNewTaskOrBusinessEffect':True,'logicalDatabasesUnchangedByReplay':len(before['databases']),'passed':True,'wholeStage6Accepted':False}
Path('/var/lib/alica-stage6-recovery/live-restore-check.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report))

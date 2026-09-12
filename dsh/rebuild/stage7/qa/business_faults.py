"""Real app callback outage and scoped Hermes HTTPS-egress failure on enrolled QA5."""
import json,sqlite3,subprocess,time,uuid
from qa_common import *
import host_operations as q
assert CELL=='dsh2-stage7-qa3'
q.OUT=OUT/'business-faults.json';q.RESULT={'schema':'stage7-business-faults/v1','cases':[],'complete':False}
NAME='dsh7-reference-qa3'
def login():
 s,d,h=wait(lambda:http(APP,'/api/login','POST',{'username':'alice','password':json.loads((OUT/'customer-passwords.json').read_text())['alice']},{'Origin':APP}),60);assert s==200
 return {'Cookie':h['Set-Cookie'].split(';')[0],'X-CSRF-Token':d['csrf'],'Origin':APP}
def submit(auth,question):
 body={'key':str(uuid.uuid4()),'operation':'research','question':question}
 s,r,_=http(APP,'/api/requests','POST',body,auth);assert s==202
 return body,r['id']
def app_row(auth,id):
 s,d,_=http(APP,'/api/state',headers=auth);assert s==200
 return next(r for r in d['requests'] if r['id']==id)
def wait(fn,seconds=240):
 end=time.monotonic()+seconds
 while time.monotonic()<end:
  try:r=fn()
  except OSError:r=None
  if r:return r
  time.sleep(1)
 raise AssertionError('bounded-business-observation-timeout')
def receipt(id):
 s,r,_=backend('/api/v1/application/requests/'+id);assert s==200;return r
def native_count(id):
 code="import json,sys;from hermes_cli import kanban_db;c=kanban_db.connect();n=c.execute('SELECT count(*) FROM tasks WHERE session_id=?',('alica-app-'+json.load(sys.stdin)['id'],)).fetchone()[0];c.close();print(json.dumps({'count':n}))"
 p=subprocess.run(['docker','exec','-i','--user','10000:10001',CELL+'-hermes-1','env','HERMES_HOME=/opt/data','HOME=/opt/data','PYTHONPATH=/opt/hermes','/opt/hermes/.venv/bin/python','-c',code],input=json.dumps({'id':id}),text=True,capture_output=True,timeout=30);assert p.returncode==0
 return json.loads(p.stdout)['count']
def effects(id):
 for path in (OUT/'reference-data').iterdir():
  if not path.is_file():continue
  with path.open('rb') as f:
   if f.read(16)!=b'SQLite format 3\0':continue
  c=sqlite3.connect('file:'+str(path)+'?mode=ro',uri=True)
  try:
   if c.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='effects'").fetchone():return c.execute('SELECT count(*) FROM effects WHERE receipt=?',(id,)).fetchone()[0]
  finally:c.close()
 raise AssertionError('effect-ledger-not-found')
def callback():
 q.until(q.healthy);before=q.actions();auth=login()
 body,id=submit(auth,'Quote the full RFC 2606 reservation list and its introductory sentence verbatim. Preserve capitalization.')
 row=wait(lambda: (r if (r:=app_row(auth,id))['receiptId'] else None));rid=row['receiptId']
 stopped=False
 try:
  assert row['state']!='result-ready','callback-fault-window-missed'
  q.cmd(['docker','stop','--time','5',NAME]);stopped=True
  def failed_delivery():
   r=receipt(rid);d=r.get('delivery') or {}
   return r if r['receipt']['phase']=='result-ready' and d.get('last_error') and d.get('state')!='delivered' else None
  wait(failed_delivery);assert native_count(rid)==1 and q.actions()==before
 finally:
  if stopped:q.cmd(['docker','start',NAME])
 wait(lambda: http(APP,'/')[0]==200,30)
 delivered=wait(lambda: (r if (r:=receipt(rid)).get('delivery',{}).get('state')=='delivered' else None))
 wait(lambda:app_row(auth,id)['state']=='result-ready')
 assert http(APP,'/api/requests','POST',body,auth)[1]['id']==id
 assert native_count(rid)==1 and effects(rid)==1 and q.actions()==before
 return {'actualCallbackReceiverStopped':True,'deliveryRecovered':True,'nativeTaskCount':1,'businessEffectCount':1,'sameKeyReplayDeduplicated':True,'noBrokerRecoveryIssued':True,'receiptId':rid}
def provider():
 q.until(q.healthy);before=q.actions();auth=login();name=CELL+'-hermes-1'
 meta=json.loads(q.cmd(['docker','inspect',name]))[0];assert meta['Config']['Labels']['com.docker.compose.project']==CELL
 ips=[v['IPAddress'] for v in meta['NetworkSettings']['Networks'].values()];assert ips and all(ips)
 rules=[]
 try:
  for ip in ips:
   rule=['DOCKER-USER','-s',ip+'/32','-p','tcp','--dport','443','-m','comment','--comment','alica-stage7-qa3-provider','-j','REJECT']
   q.cmd(['iptables','-I',*rule]);rules.append(rule)
  _,id=submit(auth,'Using RFC 2606, quote the introductory reservation sentence and all four reserved TLDs exactly. This is an isolated provider outage acceptance request.')
  row=wait(lambda: (r if (r:=app_row(auth,id))['state'] in ('rejected','cancelled','result-ready') else None))
  assert row['state']=='rejected' and row['error'],'provider-outage-did-not-produce-explicit-failure'
  lines=q.cmd(['iptables','-L','DOCKER-USER','-nvx']).splitlines();assert any(int(l.split()[0])>0 for l in lines if 'alica-stage7-qa3-provider' in l)
  assert q.actions()==before and native_count(row['receiptId'])==1 and effects(row['receiptId'])==0
  after=json.loads(q.cmd(['docker','inspect',name]))[0];assert after['Id']==meta['Id'] and after['RestartCount']==meta['RestartCount']
  return {'actualProviderEgressRejected':True,'failureExplicit':True,'healthyRuntimeNotRestarted':True,'noBrokerRecoveryIssued':True,'nativeTaskCount':1,'businessEffectCount':0,'receiptId':row['receiptId']}
 finally:
  for rule in reversed(rules):q.cmd(['iptables','-D',*rule])
  q.until(q.healthy)
if __name__=='__main__':
 q.case('callback-outage-and-no-duplicate-business-effect',callback)
 q.case('provider-outage-no-runtime-restart',provider)
 q.RESULT['complete']=True;q.save();print(json.dumps({'businessFaultSuiteComplete':True,'wholeStage7Accepted':False}))

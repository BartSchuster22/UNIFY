#!/usr/bin/env python3
"""Bounded real native integration fixture. Reads access-only credential on stdin, never logs it."""
import hashlib,io,json,pathlib,subprocess,sys,tarfile,time
ROOT=pathlib.Path('/srv/alica-dsh-development')
IMAGE='sha256:6dcfb52a1fdf81191ea2b9aba036c2127c0b3ba2837281c1c491d9640998aedc'
NAME='dsh3-native-live-qa';LABEL='com.alica.stage3.native-live'
OUT=ROOT/'stage3-tests/native-live'/str(time.time_ns());OUT.mkdir(parents=True,exist_ok=False)
def run(args,**kw):return subprocess.run(args,check=True,capture_output=True,**kw)
def docker(*a,**kw):return run(['sudo','-n','docker',*a],**kw)
def snapshot():
 ids=docker('ps','-aq').stdout.decode().split()
 rows=json.loads(docker('inspect',*ids).stdout) if ids else []
 return {r['Id']:{'name':r['Name'],'image':r['Image'],'running':r['State']['Running'],'status':r['State']['Status']} for r in rows}
assert subprocess.run(['sudo','-n','docker','inspect',NAME],capture_output=True).returncode!=0,'Fixture name occupied'
assert int(next(l.split()[1] for l in pathlib.Path('/proc/meminfo').read_text().splitlines() if l.startswith('MemAvailable:')))>2300000
credential=json.loads(sys.stdin.buffer.read(32768));assert set(credential)=={'access_token'} and len(credential['access_token'])>100
before=snapshot();cid=None;report={'qualified':False,'liveInference':False,'refreshTokenImported':False,'fixtureOnlyNotInstallerAcceptance':True}
try:
 cid=docker('run','-d','--name',NAME,'--label',LABEL+'=owned','--network','bridge','--cpus','1','--memory','1536m','--memory-swap','1536m','--pids-limit','128','--cap-drop','ALL','--security-opt','no-new-privileges','--read-only','--tmpfs','/tmp:rw,size=128m','--tmpfs','/native-home:rw,size=256m','--entrypoint','/usr/bin/env',IMAGE,'-i','PATH=/opt/hermes/.venv/bin:/usr/bin:/bin','HOME=/native-home','HERMES_HOME=/native-home','PYTHONPATH=/opt/hermes','PYTHONDONTWRITEBYTECODE=1','python','-c','import time;time.sleep(900)').stdout.decode().strip()
 def py(code,data=b'',timeout=30):
  p=subprocess.run(['sudo','-n','docker','exec','-i',NAME,'/usr/bin/env','-i','PATH=/opt/hermes/.venv/bin:/usr/bin:/bin','HOME=/native-home','HERMES_HOME=/native-home','PYTHONPATH=/opt/hermes:/tmp/qa','PYTHONDONTWRITEBYTECODE=1','python','-c',code],input=data,capture_output=True,timeout=timeout)
  if p.returncode:raise RuntimeError('Native fixture subprocess failed; exit='+str(p.returncode))
  return p.stdout
 source=(ROOT/'repos/UNIFY/integrations/hermes/application-runtime/worker.py').read_bytes()
 report['workerSha256']=hashlib.sha256(source).hexdigest()
 py("import sys;from pathlib import Path;p=Path('/tmp/qa');p.mkdir();(p/'worker.py').write_bytes(sys.stdin.buffer.read())",source)
 provision="""import contextlib,json,os,sys
from pathlib import Path
raw=json.load(sys.stdin)
from hermes_cli.auth import write_credential_pool,_update_config_for_provider,DEFAULT_CODEX_BASE_URL
with open(os.devnull,'w') as quiet,contextlib.redirect_stdout(quiet),contextlib.redirect_stderr(quiet):
 write_credential_pool('openai-codex',[{'id':'dsh3-access-only','source':'manual:api_key','access_token':raw['access_token'],'api_key':raw['access_token'],'auth_type':'api_key'}])
 _update_config_for_provider('openai-codex',DEFAULT_CODEX_BASE_URL,'gpt-6-astra')
from hermes_cli import projects_db
c=projects_db.connect();p=projects_db.create_project(c,name='Stage3 native live QA',slug='native-live-qa');c.close()
print(json.dumps({'nativeProviderConfigured':True,'projectCreated':bool(p),'refreshTokenImported':False}))
"""
 report['provision']=json.loads(py(provision,json.dumps(credential).encode()));credential.clear()
 scope={'receiptId':'33333333-3333-4333-8333-333333333333','applicationId':'44444444-4444-4444-8444-444444444444','projectId':'native-live-qa','subject':'customer-a'}
 payload={**scope,'payload':{'contractVersion':'alica-application/v1','operation':'research','question':'Which four top-level DNS names does RFC 2606 reserve? Cite the RFC and quote the exact list, preserving its whitespace.','subject':'customer-a'},'sourceUrls':['https://www.rfc-editor.org/rfc/rfc2606.txt']}
 def action(act,body):
  args=['sudo','-n','docker','exec','-i',NAME,'/usr/bin/env','-i','PATH=/opt/hermes/.venv/bin:/usr/bin:/bin','HOME=/native-home','HERMES_HOME=/native-home','PYTHONPATH=/opt/hermes:/tmp/qa','PYTHONDONTWRITEBYTECODE=1','python','/tmp/qa/worker.py',act,'--receipt',body['receiptId']]
  r=run(args,input=json.dumps(body).encode(),timeout=190);return json.loads(r.stdout)
 started=time.monotonic();answer=action('execute',payload);report['durationSeconds']=round(time.monotonic()-started,2);report['execution']=answer;report['liveInferenceAttempted']=True
 if answer['state']!='completed':
  # Diagnostic has no credential output: classify real AIAgent initialization failure.
  report['diagnostic']=json.loads(py("""import contextlib,json,os
with open(os.devnull,'w') as quiet,contextlib.redirect_stdout(quiet),contextlib.redirect_stderr(quiet):
 try:
  import worker
  s=worker.NativeStore();a=worker.native_agent(s.sessions,'alica-app-33333333-3333-4333-8333-333333333333');result={'agentConstructed':True,'toolsEmpty':not a.tools};a.close();s.close()
 except Exception as e:result={'agentConstructed':False,'exceptionClass':type(e).__name__}
print(json.dumps(result))
"""))
  raise RuntimeError('Native research did not complete')
 report['liveInference']=True
 lookup=action('lookup',scope);duplicate=action('execute',payload);assert lookup==answer and duplicate==answer
 report['durableLookupAndDuplicateIdentical']=True
 evidence=answer['result']['evidence'];assert evidence and evidence[0]['url']==payload['sourceUrls'][0]
 assert all(f['quote'] in evidence[f['sourceIndex']]['excerpt'] for f in answer['result']['findings'] if f['validated'])
 report['sourceQuotesVerified']=True
 erased=action('erase',scope);assert erased['state']=='missing';assert action('lookup',scope)['state']=='missing';report['nativeErased']=True
 report['qualified']=True
except Exception as e:report['blockerClass']=type(e).__name__;report['blocker']=str(e) if isinstance(e,RuntimeError) else 'Fixture assertion or transport failed; no upstream secret output'
finally:
 credential.clear()
 if cid:
  row=json.loads(docker('inspect',NAME).stdout)[0];assert row['Id']==cid and row['Config']['Labels'].get(LABEL)=='owned'
  docker('rm','-f',NAME)
 report['existingWorkloadsUnchanged']=before==snapshot();assert report['existingWorkloadsUnchanged']
 report['fixtureRemoved']=True
 (OUT/'result.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps({k:v for k,v in report.items() if k!='execution'}));print('Full evidence: '+str(OUT/'result.json'))
if not report['qualified']:sys.exit(1)

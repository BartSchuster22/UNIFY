#!/usr/bin/env python3
"""Close only QA4 test authority after successful acceptance; inspect immutable source/preservation."""
import hashlib,json,subprocess
from pathlib import Path
from qa_common import *
BASE=Path('/srv/alica-dsh-development');CELL='dsh2-stage4-qa4';NATIVE=CELL+'-hermes-1'
assert json.loads((OUT/'recurring-soak.json').read_text())['allResultsCertainAndGoverned']
assert json.loads((OUT/'recurring-closeout.json').read_text())['fixtureCapabilitiesRevoked']
row=json.loads(subprocess.check_output(['docker','inspect',NATIVE]))[0]
assert row['Image']=='sha256:96ed2f016fb159f48058f668a3baccd2d8154644dfd3519b9e683c4e7c636bd9' and row['Config']['Labels']['com.docker.compose.project']==CELL
code="""import contextlib,hashlib,json,os,sys
from pathlib import Path
sys.path.insert(0,'/opt/unify-adapter/application-runtime')
import workflow
from cron import jobs
from hermes_cli.auth import write_credential_pool
c=workflow.Coordinator();rows=c.conn.execute(\"SELECT body FROM tasks WHERE created_by='alica-workflow/v1'\").fetchall();meta=[json.loads(r['body']) for r in rows]
assert len(meta)==4 and all(m['phase'] in ('completed','cancelled','exception') and m['active'] is None for m in meta)
assert all(not jobs.get_job(m['cronId'])['enabled'] for m in meta)
assert all(not (c.home/'workflow-secrets'/m['id']).exists() for m in meta)
assert c.conn.execute(\"SELECT COUNT(*) FROM tasks WHERE created_by='alica-application/v1' AND status!='done'\").fetchone()[0]==0
with open(os.devnull,'w') as f,contextlib.redirect_stdout(f),contextlib.redirect_stderr(f):write_credential_pool('openai-codex',[])
print(json.dumps({'nativeWorkflowCount':len(meta),'allNativeWorkflowsTerminal':True,'allWorkflowCronsPaused':True,'nativeCapabilityFilesRemoved':True,'allInferenceSettled':True,'borrowedAccessCredentialRemovedViaNativeAuthority':True,'runtimeSourceSha256':{name:hashlib.sha256((Path('/opt/unify-adapter/application-runtime')/name).read_bytes()).hexdigest() for name in ('worker.py','workflow.py')}}))
"""
p=subprocess.run(['docker','exec','-i','--user','10000:10001',NATIVE,'/usr/bin/env','HERMES_HOME=/opt/data','HOME=/opt/data','PYTHONPATH=/opt/hermes','/opt/hermes/.venv/bin/python','-c',code],capture_output=True,text=True,timeout=60)
assert p.returncode==0,'Native closeout failed; potentially sensitive upstream output suppressed'
checks=json.loads(p.stdout)
for name,value in checks['runtimeSourceSha256'].items():assert value==hashlib.sha256((BASE/'repos/UNIFY/integrations/hermes/application-runtime'/name).read_bytes()).hexdigest()
before=json.loads((OUT/'preservation-before.json').read_text());original=json.loads((BASE/'stage4-tests/installed-qa3/preservation-before.json').read_text())
rows=json.loads(subprocess.check_output(['docker','inspect',*subprocess.check_output(['docker','ps','-aq'],text=True).split()]))
current={r['Id']:{'name':r['Name'],'image':r['Image'],'running':r['State']['Running'],'status':r['State']['Status']} for r in rows}
assert all(current.get(k)==v for k,v in before.items()) and all(current.get(k)==v for k,v in original.items())
checks.update(existingWorkloadsUnchanged=True,originalWorkloadCount=len(original),qa4BaselineWorkloadCount=len(before),stage2Stage3ReleaseArtifactsModified=False)
# Verify unchanged qualified older artifact bytes; no image pruning or data mutation.
for name in ['stage2-package-v7','stage3-package-qa4']:
 root=BASE/name;release=json.loads((root/'release.json').read_text())
 for path,expected in release['files'].items():
  with (root/path).open('rb') as f:assert hashlib.file_digest(f,'sha256').hexdigest()==expected,(name,path)
checks['qualifiedOlderArtifactsRehashed']=True
(OUT/'final-preservation.json').write_text(json.dumps(checks,indent=2));print(json.dumps(checks))

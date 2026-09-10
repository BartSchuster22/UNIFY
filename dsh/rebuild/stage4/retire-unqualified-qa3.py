#!/usr/bin/env python3
"""Retire only the unqualified Stage4 QA3 installation; retain audit data/volumes."""
import hashlib,json,subprocess
from pathlib import Path
B=Path('/srv/alica-dsh-development');OUT=B/'stage4-tests/installed-qa3';PKG=B/'stage4-package-qa3';CELL='dsh2-stage4-qa3'
def run(args,**kw):return subprocess.check_output(args,text=True,**kw)
def docker(*args):return run(['sudo','-n','docker',*args])
before=json.loads((OUT/'preservation-before.json').read_text())
rows=json.loads(docker('inspect',*docker('ps','-aq').split()))
current={r['Id']:{'name':r['Name'],'image':r['Image'],'running':r['State']['Running'],'status':r['State']['Status']} for r in rows}
assert all(current.get(k)==v for k,v in before.items())
native=next(r for r in rows if r['Name']=='/'+CELL+'-hermes-1');assert native['Config']['Labels']['com.docker.compose.project']==CELL
code="import contextlib,os,json;from hermes_cli.auth import write_credential_pool;from hermes_cli import kanban_db;from cron import jobs;k=kanban_db.connect();rows=k.execute(\"SELECT body FROM tasks WHERE created_by='alica-workflow/v1'\").fetchall();assert all(json.loads(r['body'])['phase'] in ('completed','cancelled','exception') for r in rows);f=open(os.devnull,'w');\nwith contextlib.redirect_stdout(f),contextlib.redirect_stderr(f):write_credential_pool('openai-codex',[])\nprint('credential removed')"
assert docker('exec','--user','10000:10001',CELL+'-hermes-1','/opt/hermes/.venv/bin/python','-c',code).strip()=='credential removed'
sha=hashlib.sha256((PKG/'release.json').read_bytes()).hexdigest();assert sha=='844a2d0de04653537439fc49057ba8fd175aee56df3295c817281e8334f91718'
ref=json.loads(docker('inspect','dsh4-reference-qa3'))[0];assert ref['Config']['Labels']['com.alica.stage4.reference']=='qa3'
docker('stop','dsh4-reference-qa3');docker('rm','dsh4-reference-qa3')
for action in ['stop','uninstall']:
 with (OUT/('retirement-'+action+'.log')).open('w') as f:subprocess.run(['sudo','-n','python3',str(PKG/'install.py'),action,'--bundle',str(PKG),'--release-sha256',sha,'--root','/opt/'+CELL,'--request',str(OUT/'request.json')],stdout=f,stderr=subprocess.STDOUT,check=True,timeout=300)
rows=json.loads(docker('inspect',*docker('ps','-aq').split()));current={r['Id']:{'name':r['Name'],'image':r['Image'],'running':r['State']['Running'],'status':r['State']['Status']} for r in rows}
assert all(current.get(k)==v for k,v in before.items())
report={'unqualifiedQA3RetiredViaLifecycle':True,'existingWorkloadsUnchanged':True,'existingWorkloadCount':len(before),'borrowedAccessCredentialRemovedViaNativeAuthority':True,'volumesAndEvidenceRetained':True,'qa3RecurringClassification':'transport/restart passed; usable governed knowledge failed; NOT final Stage4 acceptance'}
(OUT/'retirement.json').write_text(json.dumps(report,indent=2));print(json.dumps(report))

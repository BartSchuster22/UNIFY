#!/usr/bin/env python3
"""Read-only final live-store checks, then remove the access-only QA credential via Hermes."""
import hashlib,json,subprocess,uuid
from qa_common import *
reg=json.loads((OUT/'registration.json').read_text());aid=str(uuid.UUID(reg['applicationId']));before=json.loads((OUT/'preservation-before.json').read_text())
ids=subprocess.check_output(['docker','ps','-aq'],text=True).split();rows=json.loads(subprocess.check_output(['docker','inspect',*ids]))
current={r['Id']:{'name':r['Name'],'image':r['Image'],'running':r['State']['Running'],'status':r['State']['Status']} for r in rows}
assert all(current.get(k)==v for k,v in before.items())
for r in rows:
 if r['Id'] not in before:
  labels=r['Config'].get('Labels') or {};assert labels.get('com.docker.compose.project')=='dsh2-stage3-qa4' or labels.get('com.alica.stage3.reference')=='qa4',r['Name']
checks={'existingWorkloadsUnchanged':True,'existingWorkloadCount':len(before)}
sql=f"SELECT count(*) FROM application_receipts WHERE application_id='{aid}' AND (phase<>'deleted' OR payload IS NOT NULL OR result IS NOT NULL OR native_reference IS NOT NULL);"
x=subprocess.check_output(['docker','exec','-i','dsh2-stage3-qa4-postgresql-1','psql','-XAt','-v','ON_ERROR_STOP=1','-U','unify_bootstrap','-d','unify'],input=sql.encode()).decode().strip();assert x=='0',x
checks['allFixtureCoreReceiptsLogicallyScrubbed']=True
code="import sqlite3,json;d=sqlite3.connect('/data/memoryv4.sqlite3');print(d.execute(\"SELECT count(*) FROM records WHERE json_extract(attrs_json,'$.applicationId')=?\",('"+aid+"',)).fetchone()[0]);d.close()"
x=subprocess.check_output(['docker','exec','dsh2-stage3-qa4-memory-v4-1','python','-c',code],text=True).strip();assert x=='0',x
checks['fixtureMemoryRecordsAbsent']=True
code="import json;from hermes_cli import kanban_db;from hermes_state import SessionDB;k=kanban_db.connect();assert k.execute(\"SELECT count(*) FROM tasks WHERE json_extract(body,'$.scope.applicationId')=?\",('"+aid+"',)).fetchone()[0]==0;k.close();print('native records absent')"
assert subprocess.check_output(['docker','exec','--user','10000:10001','dsh2-stage3-qa4-hermes-1','/opt/hermes/.venv/bin/python','-c',code],text=True).strip()=='native records absent'
checks['fixtureNativeTasksAbsent']=True
# Credential authority remains the native framework. No refresh token was copied.
code="import contextlib,os;from hermes_cli.auth import write_credential_pool;f=open(os.devnull,'w');\nwith contextlib.redirect_stdout(f),contextlib.redirect_stderr(f):write_credential_pool('openai-codex',[])\nprint('access-only QA credential removed')"
assert subprocess.check_output(['docker','exec','--user','10000:10001','dsh2-stage3-qa4-hermes-1','/opt/hermes/.venv/bin/python','-c',code],text=True).strip()=='access-only QA credential removed'
checks['borrowedAccessCredentialRemovedViaNativeAuthority']=True
checks['productionReady']=False;checks['physicalBackupErasure']=False
(OUT/'closeout-acceptance.json').write_text(json.dumps(checks,indent=2));print(json.dumps(checks))

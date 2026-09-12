#!/usr/bin/env python3
"""Access-only provider setup; no refresh token and no changes to Herman."""
import json,socket,subprocess,sys
from qa_host import assert_qa_host
assert_qa_host()
import os
cell=os.environ.get('DSH_STAGE7_QA_CELL','dsh2-stage7-qa3')
assert cell=='dsh2-stage7-qa3'
name=cell+'-hermes-1'
r=json.loads(subprocess.check_output(['docker','inspect',name]))[0]
assert r['Config']['Labels']['com.docker.compose.project']==cell and r['Image']=='sha256:96ed2f016fb159f48058f668a3baccd2d8154644dfd3519b9e683c4e7c636bd9'
credential=json.loads(sys.stdin.buffer.read(32768));assert set(credential)=={'access_token'}
code="""import contextlib,json,os,sys
raw=json.load(sys.stdin)
from hermes_cli.auth import write_credential_pool,_update_config_for_provider,DEFAULT_CODEX_BASE_URL
with open(os.devnull,'w') as quiet,contextlib.redirect_stdout(quiet),contextlib.redirect_stderr(quiet):
 write_credential_pool('openai-codex',[{'id':'dsh7-installed-access-only','source':'manual:api_key','access_token':raw['access_token'],'api_key':raw['access_token'],'auth_type':'api_key'}])
 _update_config_for_provider('openai-codex',DEFAULT_CODEX_BASE_URL,'gpt-6-astra')
from hermes_cli import projects_db
c=projects_db.connect();p=projects_db.get_project(c,'installed-app-qa') or projects_db.create_project(c,name='Stage7 installed app QA',slug='installed-app-qa');c.close()
print(json.dumps({'nativeProviderConfigured':True,'project':p,'refreshTokenImported':False}))
"""
p=subprocess.run(['docker','exec','-i','--user','10000:10001',name,'/usr/bin/env','HERMES_HOME=/opt/data','HOME=/opt/data','PYTHONPATH=/opt/hermes','/opt/hermes/.venv/bin/python','-c',code],input=json.dumps(credential).encode(),capture_output=True,timeout=60)
credential.clear()
if p.returncode:print('Native provider setup failed without exposing upstream stderr');sys.exit(1)
print(p.stdout.decode())

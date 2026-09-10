#!/usr/bin/env python3
"""Access-only native provider setup in the newly installed, exact-owned QA2 cell."""
import json,subprocess,sys
name='dsh2-stage3-qa2-hermes-1'
r=json.loads(subprocess.check_output(['docker','inspect',name]))[0]
assert r['Config']['Labels']['com.docker.compose.project']=='dsh2-stage3-qa2' and r['Image']=='sha256:5f54b237bc64e0829d4a053a4d909b523ed5a2bc3af680c0a05bca062c5eef93'
credential=json.loads(sys.stdin.buffer.read(32768));assert set(credential)=={'access_token'}
code="""import contextlib,json,os,sys
raw=json.load(sys.stdin)
from hermes_cli.auth import write_credential_pool,_update_config_for_provider,DEFAULT_CODEX_BASE_URL
with open(os.devnull,'w') as quiet,contextlib.redirect_stdout(quiet),contextlib.redirect_stderr(quiet):
 write_credential_pool('openai-codex',[{'id':'dsh3-installed-access-only','source':'manual:api_key','access_token':raw['access_token'],'api_key':raw['access_token'],'auth_type':'api_key'}])
 _update_config_for_provider('openai-codex',DEFAULT_CODEX_BASE_URL,'gpt-6-astra')
from hermes_cli import projects_db
c=projects_db.connect();p=projects_db.get_project(c,'installed-app-qa') or projects_db.create_project(c,name='Stage3 installed app QA',slug='installed-app-qa');c.close()
print(json.dumps({'nativeProviderConfigured':True,'project':p,'refreshTokenImported':False}))
"""
p=subprocess.run(['docker','exec','-i','--user','10000:10001',name,'/usr/bin/env','HERMES_HOME=/opt/data','HOME=/opt/data','PYTHONPATH=/opt/hermes','/opt/hermes/.venv/bin/python','-c',code],input=json.dumps(credential).encode(),capture_output=True,timeout=45)
credential.clear()
if p.returncode:print('Native provider setup failed without exposing upstream stderr');sys.exit(1)
print(p.stdout.decode())

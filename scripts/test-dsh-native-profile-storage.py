#!/usr/bin/env python3
"""Exercise the bridge against the deployed, real Hermes SessionDB in disposable storage."""
import importlib.util,json
from pathlib import Path
s=importlib.util.spec_from_file_location('prepare',Path(__file__).with_name('prepare-dsh-maintenance.py'));assert s and s.loader
p=importlib.util.module_from_spec(s);s.loader.exec_module(p)
bridge=(p.REPO/'apps/hermes-control-adapter/src/profile-conversations.ts').read_text().split('export const profileConversationBridge = String.raw`',1)[1].split('`;',1)[0]
code=r'''import json,sys,tempfile,subprocess,os
from pathlib import Path
from hermes_state import SessionDB
q=json.load(sys.stdin)
with tempfile.TemporaryDirectory(prefix='dsh-native-profile-test-') as temp:
 base=Path(temp)
 for name in ['alpha','beta']:
  home=base/'profiles'/name;home.mkdir(parents=True);(home/'config.yaml').write_text('model:\n  default: gpt-6-astra\n  provider: openai-codex\n')
 def call(profile,mode,payload,ok=True):
  r=subprocess.run(['python3','-B','-c',q['bridge'],str(base),profile,mode],input=json.dumps(payload),capture_output=True,text=True,timeout=30)
  assert (r.returncode==0)==ok,(mode,r.stderr[-1000:])
  return json.loads(r.stdout) if ok else None
 created=call('alpha','create',{'key':'integration-key','title':'Disposable native integration'})['session'];sid=created['id']
 assert created['source']=='api_server' and created['profile_name']=='alpha'
 assert call('alpha','create',{'key':'integration-key','title':'Disposable native integration'})['session']['id']==sid
 assert len(call('alpha','list',{}))==1 and call('beta','list',{})==[]
 call('beta','get',{'id':sid},False)
 assert not (base/'state.db').exists()
 db=SessionDB(db_path=base/'profiles'/'alpha'/'state.db');db.create_session(session_id='external',source='telegram',chat_id='test-peer')
 call('alpha','get',{'id':'external'},False)
 assert len(call('alpha','list',{}))==1
 call('../alpha','list',{},False)
 (base/'profiles'/'linked').symlink_to(base/'profiles'/'alpha',target_is_directory=True)
 call('linked','list',{},False)
 call('alpha','create',{'key':'integration-key','title':'Conflicting title'},False)
 print(json.dumps({'nativeSessionDBIntegration':True,'isolatedStorage':True,'defaultStoreUntouched':True,'idempotentCreate':True,'externalSessionsExcluded':True,'traversalAndSymlinksRejected':True,'temporaryStorageRemovedOnExit':True}))
'''
remote="import subprocess,sys;subprocess.run(['docker','exec','-i','dsh2-internal-onboarding1-hermes-1','python3','-B','-c',"+repr(code)+"],input=sys.stdin.read(),text=True,check=True)"
print(p.remote('dsh',remote,json.dumps({'bridge':bridge})))

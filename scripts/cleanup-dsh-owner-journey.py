#!/usr/bin/env python3
"""Remove only resources recorded by the disposable owner-journey check."""
import importlib.util,json,os,subprocess,sys
from pathlib import Path
from playwright.sync_api import sync_playwright
H=Path('/home/herman/.config/dsh-maintenance-recovery');os.umask(0o077)
q=json.loads((H/'qa-browser.json').read_text());raw=json.loads((H/'owner-journey-resources.json').read_text())
assert len(raw['sessions'])==1
resources={'profile':raw['agent'],'title':raw['agent']+'-acceptance','sessionId':raw['sessions'][0]}
assert resources['profile']=='qa-journey-'+q['username'].rsplit('-',1)[-1][:12]
assert resources['title']==resources['profile']+'-acceptance'
s=importlib.util.spec_from_file_location('qa',Path(__file__).with_name('dsh-maintenance-qa-identity.py'));assert s and s.loader
qa=importlib.util.module_from_spec(s);s.loader.exec_module(qa)
code=r'''import os,json,subprocess,urllib.request,urllib.error
from pathlib import Path
r=json.loads(os.environ['QA_RESOURCES'])
token=Path(os.environ['HERMES_API_TOKEN_FILE']).read_text().strip()
u='http://127.0.0.1:'+os.environ['HERMES_API_PORT']+'/api/sessions/'+r['sessionId']
def req(method):
 with urllib.request.urlopen(urllib.request.Request(u,method=method,headers={'Authorization':'Bearer '+token}),timeout=15) as response:return json.loads(response.read())
try:
 current=req('GET');assert current['session']['title']==r['title'];req('DELETE')
except urllib.error.HTTPError as e:assert e.code==404
try:req('GET');raise RuntimeError('QA session remains')
except urllib.error.HTTPError as e:assert e.code==404
if (Path('/opt/data/profiles')/r['profile']).exists():subprocess.run(['hermes','profile','delete',r['profile'],'--yes'],check=True,capture_output=True,text=True)
assert not (Path('/opt/data/profiles')/r['profile']).exists()
print(json.dumps({'qaSessionAbsent':True,'qaProfileAbsent':True}))
'''
remote="import subprocess;subprocess.run(['docker','exec','-e',"+repr('QA_RESOURCES='+json.dumps(resources))+",'dsh2-internal-onboarding1-hermes-1','python3','-c',"+repr(code)+"],check=True)"
receipt=json.loads(qa.P.remote('dsh',remote))
with sync_playwright() as p:
 b=p.chromium.launch(headless=True);c=b.new_context(storage_state=str(H/'qa-browser-storage.json'));page=c.new_page();page.goto('https://dsh-next.aquiero.com/work',wait_until='domcontentloaded')
 probe=page.evaluate("async()=>(await fetch('/api/v1/auth/preferences')).status")
 if probe==200:
  status=page.evaluate("async()=>{let c=document.cookie.split('; ').find(x=>x.startsWith('aquiero_csrf='));return(await fetch('/api/v1/auth/logout',{method:'POST',headers:{'x-csrf-token':decodeURIComponent(c.split('=').slice(1).join('='))}})).status}")
  assert status in [200,204],{'logoutStatus':status}
 else:assert probe==401,{'preferencesStatus':probe}
 assert page.evaluate("async()=>(await fetch('/api/v1/auth/preferences')).status")==401
 b.close()
subprocess.run([sys.executable,str(Path(__file__).with_name('dsh-maintenance-qa-identity.py')),'delete'],check=True)
(H/'qa-browser-storage.json').unlink()
assert not (H/'qa-browser.json').exists() and not (H/'qa-browser-storage.json').exists()
receipt.update(browserLoggedOut=True,localCredentialsRemoved=True)
(H/'owner-journey-cleanup.json').write_text(json.dumps(receipt,indent=2));print(json.dumps(receipt))

import json,os,time,subprocess
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
os.umask(0o077)
R=Path('/home/herman/alica-internal-tls');QA=json.loads((R/'step7a-current.json').read_text())['qa'];BASE='https://dsh-dev.aquiero.com';SSH=['ssh','-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-i','/home/herman/.ssh/alica_v1_deploy_ed25519','deploy@167.233.135.142']
def remote(script,args,container=True,timeout=500):
 command=('sudo -n docker exec -u 10000:10000 -i dsh2-internal-dev3-hermes-1 python - ' if container else 'sudo -n python3 - ')+args
 p=subprocess.run(SSH+[command],input=(R/script).read_text(),text=True,capture_output=True,timeout=timeout)
 assert p.returncode==0,(p.returncode,p.stderr[-2000:]);return json.loads(p.stdout)
def snap(name):
 d=remote('step7a_export_native.py',QA);(R/name).write_text(json.dumps(d,indent=2));return d
mode=__import__('sys').argv[1] if len(__import__('sys').argv)>1 else ''
if mode=='wait':
 with sync_playwright() as p:
  b=p.chromium.launch(headless=True);c=b.new_context(storage_state=str(R/'private/step7a-browser-state.json'));deadline=time.monotonic()+600
  while time.monotonic()<deadline:
   r=c.request.get(BASE+'/api/v1/frameworks/hermes-alica/work/boards/'+QA+'/tasks',timeout=120000);assert r.ok,(r.status,r.text());t=next(t for t in r.json()['items'] if t['title']=='Step 7A browser file acceptance')
   if t['status']=='done':break
   assert t['status'] in ['triage','ready','running'],t
   time.sleep(5)
  assert t['status']=='done' and len(t['runs'])==1,t;b.close()
 d=snap('step7a-completed-native.json');assert d['independentlyCalculatedCents']==1195;print('Primary task completed with verified model-written artifact',flush=True)
elif mode=='restart':
 before=snap('step7a-continuity-before.json');assert len(before['tasks'])==2
 assert {t['runs'][0]['outcome'] for t in before['tasks'].values()}=={'completed','cancelled'}
 result=remote('step7a_host.py','restart continuity',False);(R/'step7a-continuity-lifecycle.json').write_text(json.dumps(result,indent=2))
 # Observe beyond one native dispatcher tick before comparing durable state.
 time.sleep(70)
 after=snap('step7a-continuity-after.json')
 for key in ['tasks','profileHashes','workspaceHashes','artifactSha256','sessions']:assert before[key]==after[key],key+' changed after restart'
 print('Restart continuity: seven services restarted; native history, sessions, profile and artifacts unchanged; no redispatch',flush=True)

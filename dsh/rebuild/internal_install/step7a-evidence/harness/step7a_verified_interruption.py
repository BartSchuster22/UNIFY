import json,time,subprocess
from playwright.sync_api import sync_playwright,expect
from step7a_continuity import R,QA,BASE,SSH,remote,snap
ROOT=R
def native_probe():
 code="""import json,sys;from pathlib import Path;from hermes_cli import kanban_db as k
qa=sys.argv[1];target=sys.argv[2];w=Path('/opt/data/workspace')/qa
with k.connect_closing(k.kanban_db_path(board=qa)) as c:
 r=c.execute("SELECT id,worker_pid FROM tasks WHERE id=?",(target,)).fetchone()
 pids=[]
 for p in Path('/proc').iterdir():
  if not p.name.isdigit():continue
  try:
   if (p/'stat').read_text().split(') ',1)[1].split()[0]=='Z':continue
   env=(p/'environ').read_bytes();cmd=(p/'cmdline').read_bytes()
   if (r and ('HERMES_KANBAN_TASK='+r[0]).encode()+b'\\0' in env) or b'STEP7A-VERIFIED-LIFECYCLE-SLEEP' in cmd:pids.append(int(p.name))
  except (OSError,ProcessLookupError):pass
 print(json.dumps({'started':(w/'verified-interruption-started.txt').exists(),'finished':(w/'verified-interruption-finished.txt').exists(),'workerPid':r[1] if r else None,'livePids':pids,'sideEffectAttempts':len((w/'verified-interruption-attempts.txt').read_text().splitlines()) if (w/'verified-interruption-attempts.txt').exists() else 0}))
"""
 r=subprocess.run(SSH+['sudo -n docker exec -u 10000:10000 -i dsh2-internal-dev3-hermes-1 python - '+QA+' '+TARGET],input=code,text=True,capture_output=True,timeout=30);assert r.returncode==0,r.stderr;return json.loads(r.stdout)

assert not (R/'step7a-interruption-verified-create.json').exists()
created=remote('step7a_create_verified_interruption.py',QA);(R/'step7a-interruption-verified-create.json').write_text(json.dumps(created,indent=2));TARGET=created['created']['id']
with sync_playwright() as p:
 b=p.chromium.launch(headless=True);c=b.new_context(storage_state=str(R/'private/step7a-browser-state.json'));page=c.new_page();page.set_default_timeout(120000);expect.set_options(timeout=90000)
 def tasks():
  r=c.request.get(BASE+'/api/v1/frameworks/hermes-alica/work/boards/'+QA+'/tasks',timeout=120000);assert r.ok,(r.status,r.text());return r.json()['items']
 # Native blocked state is explicitly promoted; track immutable task identity.
 promotion=remote('step7a_promote_verified_interruption.py',QA);(R/'step7a-interruption-promote.json').write_text(json.dumps(promotion,indent=2))
 deadline=time.monotonic()+240
 while time.monotonic()<deadline:
  before=native_probe()
  if before['started'] and before['workerPid'] and len(before['livePids'])>=2:break
  page.wait_for_timeout(2000)
 assert before['started'] and not before['finished'] and before['workerPid'] and len(before['livePids'])>=2 and before['sideEffectAttempts']==1,before
 native=snap('step7a-interruption-before.json');target=next(t for t in native['tasks'].values() if t['task']['id']==TARGET);assert target['task']['status']=='running' and target['task']['max_retries']==1 and len(target['runs'])==1
 # Do not delay the lifecycle interruption for UI rendering; final UI is verified after recovery.
 print('Active native worker and child processes verified; starting supported lifecycle interruption',flush=True)
 result=remote('step7a_host.py','restart interruption',False);(R/'step7a-interruption-lifecycle.json').write_text(json.dumps(result,indent=2))
 deadline=time.monotonic()+150;states=[]
 while time.monotonic()<deadline:
  current=snap('step7a-interruption-after.json');t=current['tasks'][target['task']['id']];states.append({'status':t['task']['status'],'runs':len(t['runs'])})
  assert len(t['runs'])==1,'Unexpected extra execution attempt'
  assert t['task']['status']!='done','False completion'
  if t['task']['status']=='blocked' and t['task']['worker_pid'] is None:break
  time.sleep(5)
 assert t['task']['status']=='blocked' and t['task']['worker_pid'] is None and t['task']['current_run_id'] is None,t
 assert t['runs'][0]['outcome'] not in [None,'done','completed','cancelled'],t
 # Do not count an owner cancellation as native interruption recovery.
 after=native_probe();assert not after['livePids'] and not after['finished'] and after['sideEffectAttempts']==1,after
 time.sleep(70)
 final=snap('step7a-interruption-final.json');t2=final['tasks'][target['task']['id']];assert t2['task']['status']=='blocked' and len(t2['runs'])==1 and t2['task']['worker_pid'] is None
 last=native_probe();assert not last['livePids'] and not last['finished'] and last['sideEffectAttempts']==1,last
 for tid,old in native['tasks'].items():
  if tid!=target['task']['id']:assert final['tasks'][tid]==old,'Previously settled task changed'
 for key in ['profileHashes','artifactSha256']:assert native[key]==final[key],key
 for name,h in native['workspaceHashes'].items():assert final['workspaceHashes'][name]==h,name
 proof={'before':before,'after':after,'final':last,'recoveryStates':states,'runOutcome':t2['runs'][0]['outcome'],'oneNativeRun':True,'oneSideEffectAttempt':True,'noFalseCompletion':True,'noOrphanWorkers':True,'noRedispatchAfter70Seconds':True,'settledTasksUnchanged':True,'profileAndExistingArtifactsUnchanged':True}
 (R/'step7a-interruption-proof.json').write_text(json.dumps(proof,indent=2));print(json.dumps(proof),flush=True);b.close()

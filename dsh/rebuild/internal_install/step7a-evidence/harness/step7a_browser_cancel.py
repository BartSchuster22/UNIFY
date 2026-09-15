import json,time,os,re,subprocess
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
os.umask(0o077)
ROOT=Path('/home/herman/alica-internal-tls');QA=json.loads((ROOT/'step7a-current.json').read_text())['qa'];BASE='https://dsh-dev.aquiero.com'
SSH=['ssh','-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-i','/home/herman/.ssh/alica_v1_deploy_ed25519','deploy@167.233.135.142']
def native_probe():
 code="""import json,sys;from pathlib import Path;from hermes_cli import kanban_db as k
qa=sys.argv[1];w=Path('/opt/data/workspace')/qa
with k.connect_closing(k.kanban_db_path(board=qa)) as c:
 r=c.execute("SELECT id,worker_pid FROM tasks WHERE title='Step 7A verified cancellation'").fetchone()
 pids=[]
 for p in Path('/proc').iterdir():
  if not p.name.isdigit():continue
  try:
   if (p/'stat').read_text().split(') ',1)[1].split()[0]=='Z':continue
   env=(p/'environ').read_bytes();cmd=(p/'cmdline').read_bytes()
   if (r and ('HERMES_KANBAN_TASK='+r[0]).encode()+b'\\0' in env) or b'STEP7A-VERIFIED-CANCEL-SLEEP' in cmd:pids.append(int(p.name))
  except (OSError,ProcessLookupError):pass
 print(json.dumps({'started':(w/'cancel-verified-started.txt').exists(),'finished':(w/'cancel-verified-finished.txt').exists(),'workerPid':r[1] if r else None,'livePids':pids}))
"""
 r=subprocess.run(SSH+['sudo -n docker exec -u 10000:10000 -i dsh2-internal-dev3-hermes-1 python - '+QA],input=code,text=True,capture_output=True,timeout=30);assert r.returncode==0,r.stderr;return json.loads(r.stdout)
with sync_playwright() as p:
 b=p.chromium.launch(headless=True);c=b.new_context(storage_state=str(ROOT/'private/step7a-browser-state.json'));page=c.new_page();page.set_default_timeout(120000);expect.set_options(timeout=90000)
 def get():
  r=c.request.get(BASE+'/api/v1/frameworks/hermes-alica/work/boards/'+QA+'/tasks',timeout=120000);assert r.ok,(r.status,r.text());return r.json()['items']
 assert not any(t['title']=='Step 7A verified cancellation' for t in get())
 page.goto(BASE+'/work?workPage=add&framework=hermes-alica&project='+QA,wait_until='networkidle');page.get_by_text('Task',exact=True).click()
 page.get_by_role('textbox',name='Task name',exact=True).fill('Step 7A verified cancellation')
 page.get_by_role('textbox',name='Prompt',exact=True).fill("Cancellation acceptance only. Use the enabled terminal tool to execute exactly this bounded Python command in your project workspace: python -c \"from pathlib import Path; import time; Path('cancel-verified-started.txt').write_text('STEP7A-VERIFIED-CANCEL-SLEEP'); time.sleep(180); Path('cancel-verified-finished.txt').write_text('finished')\". Set the terminal timeout to 240 seconds. Do not put it in the background, shorten or skip the sleep, use any other workspace, or create cancel-verified-finished.txt separately. The owner will cancel this task while the command is sleeping. Do not mark complete before the command returns.")
 page.get_by_role('combobox',name='Assigned agent',exact=True).click();page.get_by_role('option',name=re.compile(re.escape('('+QA+')'))).click()
 page.get_by_role('button',name='Promote to ready',exact=True).click();expect(page.get_by_text('Created and promoted Step 7A verified cancellation to ready.',exact=True)).to_be_visible()
 page.goto(BASE+'/work?workPage=board&framework=hermes-alica&project='+QA,wait_until='networkidle')
 deadline=time.monotonic()+180;before={}
 while time.monotonic()<deadline:
  before=native_probe()
  if before['started'] and before['workerPid'] and len(before['livePids'])>=2:break
  page.wait_for_timeout(2000)
 assert before.get('started') and before['workerPid'] and len(before['livePids'])>=2,before
 task=next(t for t in get() if t['title']=='Step 7A verified cancellation');assert task['status']=='running' and len(task['runs'])==1
 page.reload(wait_until='networkidle');expect(page.get_by_text('Step 7A verified cancellation',exact=True)).to_be_visible()
 page.once('dialog',lambda d:d.accept())
 with page.expect_response(lambda r:r.url.endswith('/api/v1/mutations') and r.request.method=='POST',timeout=120000) as pending:page.get_by_role('button',name='Cancel run',exact=True).click()
 r=pending.value;reply=r.json();assert r.ok and reply['operation']['state']=='verified',(r.status,reply)
 assert r.request.post_data_json['payload']['runId']==task['runs'][0]['id']
 after=native_probe();assert not after['livePids'] and not after['finished'] and after['workerPid'] is None,after
 deadline=time.monotonic()+40;states=[]
 while time.monotonic()<deadline:
  current=next(t for t in get() if t['id']==task['id']);states.append(current['status'])
  assert current['status']=='blocked' and len(current['runs'])==1 and current['runs'][0]['outcome']=='cancelled',current
  page.wait_for_timeout(5000)
 page.reload(wait_until='networkidle')
 while page.locator('details:not([open]) > summary').count():page.locator('details:not([open]) > summary').first.click()
 expect(page.get_by_text('Cancelled by owner; worker termination verified',exact=True)).to_be_visible()
 proof={'qa':QA,'before':before,'after':after,'request':r.request.post_data_json,'response':reply,'task':current,'postCancellationStates':states,'inflightReloadPreservedTask':True,'noRedispatch':True,'cancelledSummaryVisible':True}
 (ROOT/'step7a-remediation-cancel.json').write_text(json.dumps(proof,indent=2));page.screenshot(path=str(ROOT/'step7a-remediation-cancel.png'),full_page=True);print(json.dumps({'browserCancellationPassed':True,'noRedispatch':True,'before':before,'after':after}));b.close()

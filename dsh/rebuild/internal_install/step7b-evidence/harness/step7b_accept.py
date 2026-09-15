import json,os,subprocess,time,sys
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
os.umask(0o077)
R=Path('/home/herman/alica-internal-tls');QA=json.loads((R/'step7b-current.json').read_text())['qa'];BASE='https://dsh-dev.aquiero.com'
SSH=['ssh','-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-i','/home/herman/.ssh/alica_v1_deploy_ed25519','deploy@167.233.135.142']
def save(name,j): (R/('step7b-'+name+'.json')).write_text(json.dumps(j,indent=2));return j
def remote(script,args,container=True):
 cmd='sudo -n docker exec -u 10000:10000 -i dsh2-internal-dev3-hermes-1 python - ' if container else 'sudo -n python3 - '
 p=subprocess.run(SSH+[cmd+args],input=(R/script).read_text(),capture_output=True,text=True,timeout=400);assert p.returncode==0,p.stderr[-2500:];return json.loads(p.stdout)
def native(mode):return remote('step7b_native.py',mode+' '+QA)
def login():subprocess.run(['/home/herman/stage7-browser-venv/bin/python',str(R/'step7b_login.py')],check=True,timeout=240)
if not (R/'step7b-baseline.json').exists():save('baseline',remote('step7b_host.py','baseline',False))
else:save('baseline-recheck',remote('step7b_host.py','verify',False))
if not (R/'step7b-prepare.json').exists():save('prepare',native('prepare'))
login()
with sync_playwright() as p:
 b=p.chromium.launch(headless=True);c=b.new_context(storage_state=str(R/'private/step7b-browser-state.json'),timezone_id='UTC');page=c.new_page();page.set_default_timeout(90000);expect.set_options(timeout=60000)
 def openpage():page.goto(BASE+'/work?workPage=cronjobs&framework=hermes-alica',wait_until='networkidle');expect(page.get_by_role('heading',name='Cronjobs',exact=True)).to_be_visible()
 def mutate(button,label):
  with page.expect_response(lambda r:r.url.endswith('/api/v1/mutations') and r.request.method=='POST',timeout=120000) as pending:button.click()
  r=pending.value;assert r.ok and r.json()['operation']['state']=='verified',(r.status,r.text());save(label,{'request':r.request.post_data_json,'response':r.json()})
 openpage()
 if not (R/'step7b-create.json').exists():
  page.get_by_role('button',name='New Cronjob').click();page.get_by_role('textbox',name='Cronjob name',exact=True).fill(QA);page.get_by_role('textbox',name='Title',exact=True).fill('Step 7B bounded scheduling');page.get_by_role('textbox',name='Prompt',exact=True).fill('Disposable scheduling probe. Do not use tools, schedule other jobs, or modify any owner data.');page.get_by_role('combobox',name='Schedule mode',exact=True).click();page.get_by_role('option',name='One-time date/time',exact=True).click();page.get_by_label('Run date/time',exact=True).fill('2099-01-01T00:00')
  mutate(page.get_by_role('button',name='Save Cronjob',exact=True),'create')
 row=page.get_by_role('row').filter(has_text=QA);expect(row).to_be_visible()
 if not (R/'step7b-pause.json').exists():mutate(row.get_by_role('button',name='Pause',exact=True),'pause')
 save('binding',native('bind'));before=save('before',native('snapshot'));assert not before['job']['enabled'] and not before['attempts'];assert before['job']['no_agent'];page.reload(wait_until='networkidle');expect(row.get_by_text('paused',exact=True)).to_be_visible();page.screenshot(path=str(R/'step7b-paused-before.png'),full_page=True)
 save('lifecycle',remote('step7b_host.py','restart continuity',False));after=save('after-restart',native('snapshot'));assert after['job']==before['job'] and not after['attempts'];time.sleep(70);assert not native('snapshot')['attempts'];print('Paused schedule retained across seven-service restart; zero invocations',flush=True)
 c.close();login();c=b.new_context(storage_state=str(R/'private/step7b-browser-state.json'),timezone_id='UTC');page=c.new_page();page.set_default_timeout(90000);openpage();row=page.get_by_role('row').filter(has_text=QA);expect(row.get_by_text('paused',exact=True)).to_be_visible();save('due',native('due'));page.reload(wait_until='networkidle');mutate(row.get_by_role('button',name='Resume',exact=True),'resume')
 armed=save('armed',native('snapshot'));assert armed['job']['enabled'] and not armed['attempts']
 active_cycle=save('active-lifecycle',remote('step7b_host.py','restart scheduled',False));save('active-after-restart',native('snapshot'));print('Active one-shot carried through supported cell restart',flush=True)
 c.close();login();c=b.new_context(storage_state=str(R/'private/step7b-browser-state.json'),timezone_id='UTC');page=c.new_page();page.set_default_timeout(90000);openpage();row=page.get_by_role('row').filter(has_text=QA)
 deadline=time.monotonic()+240
 while time.monotonic()<deadline:
  done=native('snapshot')
  if done['job'].get('state')=='completed':break
  time.sleep(5)
 save('completed',done);assert done['job']['state']=='completed' and done['job']['last_status']=='ok' and len(done['attempts'])==1,done;assert done['job']['next_run_at'] is None
 from datetime import datetime
 started=active_cycle['after']['identities']['/dsh2-internal-dev3-hermes-1']['started']
 assert datetime.fromisoformat(done['attempts'][0]['utc'])>=datetime.fromisoformat(__import__('re').sub(r'(\.\d{6})\d+', r'\1', started.replace('Z', '+00:00')))
 page.reload(wait_until='networkidle');expect(row.get_by_text('completed',exact=True)).to_be_visible();page.screenshot(path=str(R/'step7b-completed.png'),full_page=True)
 time.sleep(70);final=save('final',native('snapshot'));assert final['attempts']==done['attempts'] and final['job']==done['job'];page.reload(wait_until='networkidle');page.once('dialog',lambda d:d.accept());mutate(row.get_by_role('button',name='Remove',exact=True),'remove');expect(page.get_by_role('row').filter(has_text=QA)).to_have_count(0);page.screenshot(path=str(R/'step7b-removed.png'),full_page=True);b.close()
save('cleanup',native('cleanup'));save('protection',remote('step7b_host.py','verify',False));save('acceptance',{'pausedRestartContinuity':True,'activePendingRestartContinuity':True,'freshOwnerLogin':True,'scheduledScriptOnlyExecution':True,'oneInvocation':True,'noDuplicateAfter70Seconds':True,'browserCreatePauseResumeRemove':True,'nativeScriptBinding':True,'healthyServices':7,'scope':'bounded one-shot scheduling; no model-backed cron, recurring cadence, or in-flight cron recovery claim'})
print('Step 7B bounded scheduling acceptance and cleanup PASS',flush=True)

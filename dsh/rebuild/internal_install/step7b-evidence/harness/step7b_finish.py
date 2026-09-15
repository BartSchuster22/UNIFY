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
from datetime import datetime
import re
save('ui-update',remote('step7b_read_update.py','',False))
done=json.loads((R/'step7b-completed.json').read_text());final=save('final',native('snapshot'));assert len(final['attempts'])==1 and final['attempts']==done['attempts'] and final['job']==done['job']
assert (datetime.fromisoformat(final['observedAt'])-datetime.fromisoformat(done['observedAt'])).total_seconds()>=70
cycle=json.loads((R/'step7b-active-lifecycle.json').read_text());started=cycle['after']['identities']['/dsh2-internal-dev3-hermes-1']['started'];assert datetime.fromisoformat(done['attempts'][0]['utc'])>=datetime.fromisoformat(re.sub(r'(\.\d{6})\d+',r'\1',started.replace('Z','+00:00')))
login()
with sync_playwright() as p:
 b=p.chromium.launch();c=b.new_context(storage_state=str(R/'private/step7b-browser-state.json'));page=c.new_page();page.set_default_timeout(60000);expect.set_options(timeout=60000)
 page.goto(BASE+'/work?workPage=cronjobs&framework=hermes-alica',wait_until='networkidle');row=page.get_by_role('row').filter(has_text=QA);expect(row.get_by_text('completed',exact=True)).to_be_visible();expect(page.get_by_text('Active 0',exact=True)).to_be_visible();page.screenshot(path=str(R/'step7b-completed.png'),full_page=True)
 page.get_by_text('Active 0',exact=True).click();expect(row).to_have_count(0);page.get_by_text('All 1',exact=True).click();expect(row).to_have_count(1);page.reload(wait_until='networkidle');expect(page.get_by_text('Active 0',exact=True)).to_be_visible()
 page.get_by_text('Hermes overview',exact=True).click();expect(page.get_by_role('heading',name='0 active',exact=True)).to_be_visible();page.screenshot(path=str(R/'step7b-overview-fixed.png'),full_page=True)
 save('active-filter-fixed',{'allCount':1,'activeCount':0,'completedExcludedFromActive':True,'completedRetainedInAll':True,'overviewActiveCount':0,'survivesReload':True})
 page.goto(BASE+'/work?workPage=cronjobs&framework=hermes-alica',wait_until='networkidle');row=page.get_by_role('row').filter(has_text=QA);page.once('dialog',lambda d:d.accept())
 with page.expect_response(lambda r:r.url.endswith('/api/v1/mutations') and r.request.method=='POST') as pending:row.get_by_role('button',name='Remove',exact=True).click()
 response=pending.value;assert response.ok and response.json()['operation']['state']=='verified';save('remove',{'request':response.request.post_data_json,'response':response.json()});expect(row).to_have_count(0);page.reload(wait_until='networkidle');expect(page.get_by_role('row').filter(has_text=QA)).to_have_count(0);page.screenshot(path=str(R/'step7b-removed.png'),full_page=True);b.close()
save('cleanup',native('cleanup'));save('protection',remote('step7b_final_host.py','verify',False));save('acceptance',{'pausedRestartContinuity':True,'activePendingRestartContinuity':True,'freshOwnerLogin':True,'scheduledScriptOnlyExecution':True,'oneInvocation':True,'noDuplicateAfter70Seconds':True,'browserCreatePauseResumeRemove':True,'nativeScriptBinding':True,'activeClassificationFixedAndDeployed':True,'healthyServices':7,'scope':'bounded script-only one-shot; no model-backed cron, recurring cadence, or in-flight cron recovery claim'})
print('Step 7B scheduling and corrected UI acceptance, protection and cleanup PASS',flush=True)

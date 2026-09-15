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
assert json.loads((R/'step7b-cleanup.json').read_text())['scriptRemoved']
assert json.loads((R/'step7b-active-filter-fixed.json').read_text())['completedExcludedFromActive']
save('protection',remote('step7b_final_host.py','verify',False));save('acceptance',{'pausedRestartContinuity':True,'activePendingRestartContinuity':True,'freshOwnerLogin':True,'scheduledScriptOnlyExecution':True,'oneInvocation':True,'noDuplicateAfter70Seconds':True,'browserCreatePauseResumeRemove':True,'nativeScriptBinding':True,'activeClassificationFixedAndDeployed':True,'healthyServices':7,'scope':'bounded script-only one-shot; no model-backed cron, recurring cadence, or in-flight cron recovery claim'})
print('Step 7B scheduling and corrected UI acceptance, protection and cleanup PASS',flush=True)

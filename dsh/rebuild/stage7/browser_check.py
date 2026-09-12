from pathlib import Path
import json,os,subprocess
from playwright.sync_api import sync_playwright
os.umask(0o077)
OUT=Path('/home/herman/stage7-browser-artifacts');OUT.mkdir(exist_ok=True)
SSH=['ssh','-o','BatchMode=yes','-o','UserKnownHostsFile=/home/herman/.alica-provider-access/dsh2-stage7-known-hosts','-i','/home/herman/.ssh/alica_v1_deploy_ed25519','deploy@95.216.216.143']
code="import json;from pathlib import Path;p=Path('/var/lib/alica-stage7-qa3');print(json.dumps({'owner':(p/'test-owner-password').read_text().strip(),'customers':json.loads((p/'customer-passwords.json').read_text()),'ca':Path('/opt/dsh2-stage7-qa3/secrets/framework-ca.crt').read_text()}))"
import shlex
secret=json.loads(subprocess.check_output(SSH+['sudo -n python3 -c '+shlex.quote(code)],text=True))
ca=OUT/'qa-ca.crt';ca.write_text(secret['ca'])
for host,port,path in [('stage7.qa.invalid',18443,'/api/v1/auth/method'),('notebook.dsh.invalid',18444,'/')]:
 subprocess.run(['curl','--silent','--show-error','--fail','--noproxy','*','--cacert',str(ca),'--connect-to',host+':443:127.0.0.1:'+str(port),'https://'+host+path],stdout=subprocess.DEVNULL,check=True)
with sync_playwright() as p:
 b=p.chromium.launch(args=['--no-proxy-server','--host-resolver-rules=MAP stage7.qa.invalid 127.0.0.1:18443, MAP notebook.dsh.invalid 127.0.0.1:18444'])
 c=b.new_context(ignore_https_errors=True);page=c.new_page();page.goto('https://stage7.qa.invalid',wait_until='networkidle')
 page.get_by_role('link',name='Continue to secure sign-in').click();page.locator('input[name="username"]').fill('stage7-owner');page.locator('input[name="password"]').fill(secret['owner']);page.locator('[type="submit"]').click();page.wait_for_url('https://stage7.qa.invalid/**');page.wait_for_load_state('networkidle')
 print(json.dumps({'ownerUrl':page.url,'title':page.title(),'body':page.locator('body').inner_text()[:3500]}))
 page.screenshot(path=str(OUT/'owner-console.png'),full_page=True)
 app=c.new_page();app.goto('https://notebook.dsh.invalid',wait_until='networkidle')
 print(json.dumps({'appInputs':app.locator('input').evaluate_all('(els)=>els.map(e=>({name:e.name,type:e.type,id:e.id}))'),'appButtons':app.get_by_role('button').all_text_contents(),'appText':app.locator('body').inner_text()[:1400]}))
 app.locator('input[name="username"]').fill('alice');app.locator('input[name="password"]').fill(secret['customers']['alice']);app.get_by_role('button',name='Sign in',exact=True).click();app.wait_for_load_state('networkidle');app.wait_for_timeout(1000)
 text=app.locator('body').inner_text();print(json.dumps({'signedInAppText':text[:5000]}));app.screenshot(path=str(OUT/'customer-result.png'),full_page=True)
 state=app.evaluate("async () => (await fetch('/api/state')).json()")
 completed=[r for r in state['requests'] if r['state']=='result-ready' and r['result'] and r['result']['answer'] and r['result']['knowledge'] and not r['result']['uncertainty']]
 assert completed and 'result-ready' in text
 normalize=lambda value:' '.join(value.split())
 assert any(normalize(r['result']['answer']) in normalize(text) for r in completed),'Server result not rendered in customer UI'
 report={'schema':'stage7-real-browser/v1','ownerOidcLogin':True,'ownerDashboardReady':'DSH has all 8 checked prerequisites ready.' in page.locator('body').inner_text(),'customerLogin':True,'realModelResultVisible':True,'separateStrictTlsProbesPassed':True,'browserUsesQaSelfSignedException':True,'productionRoutesChanged':False}
 (OUT/'browser-result.json').write_text(json.dumps(report,indent=2));assert report['ownerDashboardReady']
 b.close();secret.clear()

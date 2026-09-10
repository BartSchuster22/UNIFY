#!/usr/bin/env python3
"""Real headless Chromium UI; exact QA leaf SPKI pin, no global TLS bypass."""
import base64,hashlib,json,os,subprocess
from pathlib import Path
from qa_common import OUT,APP
os.environ['PLAYWRIGHT_BROWSERS_PATH']='/srv/alica-dsh-development/tooling/stage3-browser/browsers'
os.environ['PLAYWRIGHT_HOST_PLATFORM_OVERRIDE']='ubuntu24.04-x64'
base=Path('/srv/alica-dsh-development/tooling/stage3-browser')
os.environ['LD_LIBRARY_PATH']=str(base/'libs/usr/lib/x86_64-linux-gnu')
fonts=base/'fonts.conf';fonts.write_text('<fontconfig><dir>'+str(base/'libs/usr/share/fonts/truetype/liberation')+'</dir><cachedir>'+str(base/'font-cache')+'</cachedir></fontconfig>');os.environ['FONTCONFIG_FILE']=str(fonts)
cert=OUT/'reference-secrets/tls.crt'
pem=subprocess.check_output(['openssl','x509','-in',str(cert),'-pubkey','-noout'])
der=subprocess.check_output(['openssl','pkey','-pubin','-outform','DER'],input=pem);pin=base64.b64encode(hashlib.sha256(der).digest()).decode()
from playwright.sync_api import sync_playwright,expect
pw=json.loads((OUT/'customer-passwords.json').read_text());reg=json.loads((OUT/'registration.json').read_text());first=json.loads((OUT/'first-result.json').read_text())
errors=[];urls=[]
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True,args=['--host-resolver-rules=MAP notebook.dsh.invalid 10.83.0.10','--ignore-certificate-errors-spki-list='+pin,'--no-proxy-server'])
 context=browser.new_context(viewport={'width':1280,'height':900},ignore_https_errors=False)
 context.route('**/*',lambda r:r.continue_() if r.request.url.startswith(APP+'/') else r.abort())
 page=context.new_page();page.on('pageerror',lambda e:errors.append(str(e)));page.on('request',lambda r:urls.append(r.url))
 assert page.goto(APP+'/').status==200
 expect(page.locator('#login')).to_be_visible()
 page.locator('[name=username]').fill('alice');page.locator('[name=password]').fill('deliberately-wrong-fixture-password');page.locator('#login button').click()
 expect(page.locator('#notice')).not_to_be_empty();expect(page.locator('#workspace')).to_be_hidden()
 page.locator('[name=password]').fill(pw['alice']);page.locator('#login button').click()
 expect(page.locator('#workspace')).to_be_visible(timeout=20000)
 expect(page.locator('#requests')).to_contain_text('result-ready',timeout=20000)
 expect(page.locator('#requests')).to_contain_text('.test')
 page.locator('[name=operation]').select_option('correction');assert page.locator('#corrects option').count()>1
 text=page.content();assert reg['credential']['token'] not in text and reg['callbackSigningSecret'] not in text
 assert all(u.startswith(APP+'/') for u in urls) and not errors,errors
 page.screenshot(path=str(OUT/'browser-result.png'),full_page=True)
 page.locator('#logout').click();expect(page.locator('#login')).to_be_visible();expect(page.locator('#workspace')).to_be_hidden()
 browser.close()
report={'realChromiumUi':True,'wrongPasswordDenied':True,'loginResultRenderingCorrectionSelectionLogout':True,'browserOnlyContactsApplication':True,'backendSecretsAbsentFromDom':True,'pageErrors':errors,'tls':'exact fixture leaf SPKI pin; independent Python TLS hostname/CA verification also passed','hostDependencies':'downloaded and extracted into isolated tooling; no host package install'}
(OUT/'browser-acceptance.json').write_text(json.dumps(report,indent=2));print(json.dumps(report))

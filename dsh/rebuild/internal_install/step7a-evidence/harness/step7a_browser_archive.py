import json,os
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
os.umask(0o077)
ROOT=Path('/home/herman/alica-internal-tls');QA=json.loads((ROOT/'step7a-current.json').read_text())['qa'];BASE='https://dsh-dev.aquiero.com'
with sync_playwright() as p:
 b=p.chromium.launch(headless=True);c=b.new_context(storage_state=str(ROOT/'private/step7a-browser-state.json'));page=c.new_page();page.set_default_timeout(120000);expect.set_options(timeout=90000)
 page.goto(BASE+'/work?workPage=details&framework=hermes-alica&project='+QA,wait_until='networkidle');page.once('dialog',lambda d:d.accept())
 with page.expect_response(lambda r:r.url.endswith('/api/v1/mutations') and r.request.method=='POST',timeout=120000) as pending:page.get_by_role('button',name='Archive',exact=True).click()
 r=pending.value;assert r.ok and r.json()['operation']['state']=='verified',(r.status,r.text());print(json.dumps({'qaProjectArchivedThroughBrowser':True}));b.close()

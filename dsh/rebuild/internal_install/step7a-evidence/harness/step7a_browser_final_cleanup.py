import json,os
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
os.umask(0o077)
ROOT=Path('/home/herman/alica-internal-tls');BASE='https://dsh-dev.aquiero.com';QA=json.loads((ROOT/'step7a-current.json').read_text())['qa']
with sync_playwright() as p:
 b=p.chromium.launch(headless=True);c=b.new_context(storage_state=str(ROOT/'private/step7a-browser-state.json'));page=c.new_page();page.set_default_timeout(90000);expect.set_options(timeout=60000);errors=[]
 page.on('pageerror',lambda e:errors.append(str(e)))
 def get(path):
  r=c.request.get(BASE+'/api/v1/frameworks/hermes-alica/'+path,timeout=60000);assert r.ok,(r.status,r.text());return r.json()['items']
 profiles=get('profiles');assert [x['id'] for x in profiles]==['default'],profiles
 projects=get('work/projects');assert next(x for x in projects if x['id']==QA)['archived']
 page.goto(BASE+'/work?workPage=overview&framework=hermes-alica',wait_until='networkidle')
 expect(page.get_by_role('heading',name='Work & Kanban',exact=True)).to_be_visible()
 expect(page.get_by_text('Loading native work data…',exact=True)).to_have_count(0)
 expect(page.get_by_text('Hermes work request failed',exact=True)).to_have_count(0)
 page.get_by_role('button',name='Refresh',exact=True).click()
 expect(page.get_by_text('Loading native work data…',exact=True)).to_have_count(0)
 expect(page.get_by_text('Hermes work request failed',exact=True)).to_have_count(0)
 assert not errors,errors
 proof={'ownerSessionWorksWithoutDisposableAgent':True,'profiles':profiles,'projectArchived':True,'workViewAndRefreshHealthyAfterCleanup':True,'javascriptErrors':errors}
 (ROOT/'step7a-final-browser-cleanup.json').write_text(json.dumps(proof,indent=2));print(json.dumps(proof));page.screenshot(path=str(ROOT/'step7a-final-cleanup.png'),full_page=True);b.close()

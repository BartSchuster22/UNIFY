import json,time
from pathlib import Path
from playwright.sync_api import sync_playwright
R=Path('/home/herman/alica-internal-tls');qa=json.loads((R/'step7b-current.json').read_text())['qa'];base='https://dsh-dev.aquiero.com'
with sync_playwright() as p:
 b=p.chromium.launch();c=b.new_context(storage_state=str(R/'private/step7b-browser-state.json'));page=c.new_page();deadline=time.monotonic()+120
 while time.monotonic()<deadline:
  res=c.request.get(base+'/api/v1/frameworks/hermes-alica/work/cronjobs',timeout=30000);assert res.ok
  jobs=res.json()['items'];job=next((x for x in jobs if x['name']==qa),None)
  if job and job['status']=='completed':break
  time.sleep(3)
 assert job and job['status']=='completed',jobs
 page.goto(base+'/work?workPage=cronjobs&framework=hermes-alica',wait_until='networkidle');before=page.locator('body').inner_text();active=page.get_by_text('Active 1',exact=True)
 if active.count():active.click()
 row=page.get_by_role('row').filter(has_text=qa)
 proof={'nativeStatus':job['status'],'bodyBeforeFilter':before,'completedJobCountedActive':active.count()==1,'completedJobVisibleUnderActiveFilter':active.count()==1 and row.count()==1}
 (R/'step7b-active-filter.json').write_text(json.dumps(proof,indent=2));page.screenshot(path=str(R/'step7b-active-filter.png'),full_page=True);print(json.dumps(proof));b.close()

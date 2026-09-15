import json,sys
from playwright.sync_api import sync_playwright,expect
from step7a_continuity import R,QA,BASE
label=sys.argv[1];assert label in ['continuity','interruption']
with sync_playwright() as p:
 b=p.chromium.launch(headless=True);c=b.new_context(storage_state=str(R/'private/step7a-browser-state.json'));page=c.new_page();page.set_default_timeout(120000);expect.set_options(timeout=90000)
 def get(path):
  r=c.request.get(BASE+'/api/v1/frameworks/hermes-alica/'+path,timeout=120000);assert r.ok,(r.status,r.text());return r.json()['items']
 project=next(x for x in get('work/projects') if x['id']==QA);assert project['defaultWorkspacePath']=='/opt/data/workspace/'+QA and project['projectManager']==QA and project['agents']==[QA]
 tasks=get('work/boards/'+QA+'/tasks');assert all(len(t['runs'])==1 for t in tasks)
 page.goto(BASE+'/work?workPage=board&framework=hermes-alica&project='+QA,wait_until='networkidle')
 for t in tasks:expect(page.get_by_text(t['title'],exact=True)).to_be_visible()
 while page.locator('details:not([open]) > summary').count():page.locator('details:not([open]) > summary').first.click()
 for t in tasks:
  run=t['runs'][0]
  if run.get('summary'):expect(page.get_by_text(run['summary'],exact=True)).to_be_visible()
  if run.get('error'):expect(page.get_by_text(run['error'],exact=True).first).to_be_visible()
 page.screenshot(path=str(R/('step7a-'+label+'-board.png')),full_page=True)
 page.goto(BASE+'/?view=profiles&framework=hermes-alica',wait_until='networkidle');page.get_by_role('button',name='Edit '+QA,exact=True).click();d=page.get_by_role('dialog');expect(d.get_by_role('combobox',name='Primary model',exact=True)).to_have_value('gpt-5.6-sol · openai-codex')
 doc=get('profiles/'+QA+'/configuration')[0];assert 'MEMORY-STEP7A-CEDAR' in doc['memory'] and 'USER-STEP7A-AMBER' in doc['userMemory'];assert doc['runtime']['settings']['tools']['terminal'];assert doc['runtime']['settings']['skills']['qa-enabled-proof'] and not doc['runtime']['settings']['skills']['qa-disabled-proof']
 page.screenshot(path=str(R/('step7a-'+label+'-agent.png')),full_page=True)
 proof={'label':label,'ownerAuthenticatedAfterRestart':True,'workspaceAndTeamRetained':True,'modelMemoryToolsSkillsRetained':True,'taskTitlesAndRunFeedbackVisible':True,'taskRunCounts':{t['id']:len(t['runs']) for t in tasks},'project':project}
 (R/('step7a-'+label+'-browser.json')).write_text(json.dumps(proof,indent=2));print(json.dumps({k:v for k,v in proof.items() if k!='project'}));b.close()

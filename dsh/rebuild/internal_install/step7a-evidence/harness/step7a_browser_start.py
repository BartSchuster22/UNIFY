import json,re,os
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
os.umask(0o077)
BASE='https://dsh-dev.aquiero.com';QA=json.loads(Path('/home/herman/alica-internal-tls/step7a-current.json').read_text())['qa'];WORK='/opt/data/workspace/'+QA;ROOT=Path('/home/herman/alica-internal-tls')
with sync_playwright() as p:
 b=p.chromium.launch(headless=True);c=b.new_context();page=c.new_page();page.set_default_timeout(120000);expect.set_options(timeout=90000)
 page.goto(BASE,wait_until='networkidle');page.get_by_role('link',name='Continue to secure sign-in').click();page.wait_for_load_state('networkidle');page.locator('input[name="username"]').fill('internal-owner');page.locator('input[name="password"]').fill((ROOT/'private/owner-new-password').read_text().strip());page.locator('button[type="submit"],input[type="submit"]').click();page.wait_for_load_state('networkidle')
 def get(r):
  v=c.request.get(BASE+'/api/v1/frameworks/hermes-alica/'+r,timeout=120000);assert v.ok,(v.status,v.text());return v.json()
 existing=[x for x in get('work/projects')['items'] if x['id']==QA]
 if not existing:
  page.goto(BASE+'/work?workPage=add&framework=hermes-alica',wait_until='networkidle')
  page.get_by_role('textbox',name='Project name',exact=True).fill('Step 7A disposable runtime acceptance');page.get_by_role('textbox',name='Project slug optional',exact=True).fill(QA);page.get_by_role('textbox',name='Project goal',exact=True).fill('One bounded CSV-to-JSON file task with native tool, skill and memory evidence. No background planning.')
  for label,value in [('Default workspace path',WORK),('Project manager agent',re.compile(re.escape('('+QA+')'))),('Worker agents',re.compile(re.escape('('+QA+')')))]:
   page.get_by_role('combobox',name=label,exact=True).click();page.get_by_role('option',name=value,exact=isinstance(value,str)).click()
  page.keyboard.press('Escape')
  with page.expect_response(lambda r:r.url.endswith('/api/v1/mutations') and r.request.method=='POST') as pending:page.get_by_role('button',name='Save',exact=True).click()
  r=pending.value;assert r.ok,(r.status,r.text());assert r.json()['operation']['state']=='verified'
 project=next(x for x in get('work/projects')['items'] if x['id']==QA);assert project['defaultWorkspacePath']==WORK and project['projectManager']==QA and project['agents']==[QA]
 page.goto(BASE+'/?view=profiles&framework=hermes-alica',wait_until='networkidle');page.get_by_role('button',name='Edit '+QA,exact=True).click();d=page.get_by_role('dialog');expect(d.get_by_role('combobox',name='Primary model',exact=True)).to_have_value('gpt-5.6-sol · openai-codex')
 doc=get('profiles/'+QA+'/configuration')['items'][0];assert doc['runtime']['settings']['skills']['qa-enabled-proof'];assert not doc['runtime']['settings']['skills']['qa-disabled-proof'];assert doc['runtime']['settings']['tools']['terminal'];assert 'MEMORY-STEP7A-CEDAR' in doc['memory'];assert 'USER-STEP7A-AMBER' in doc['userMemory']
 c.storage_state(path=str(ROOT/'private/step7a-browser-state.json'))
 proof={'qa':QA,'projectCreatedThroughBrowser':True,'projectWorkspaceAndTeamReadBack':True,'browserSelectedModel':'gpt-5.6-sol','nativeMemoryVisible':True,'enabledAndDisabledSkillsVisible':True,'terminalEnabledForBoundedLifecycleProbe':True};(ROOT/'step7a-browser-setup.json').write_text(json.dumps(proof));print(json.dumps(proof))
 assert not any(t['title']=='Step 7A browser file acceptance' for t in get('work/boards/'+QA+'/tasks')['items']), 'Existing task must be observed, not recreated'
 page.goto(BASE+'/work?workPage=add&framework=hermes-alica&project='+QA,wait_until='networkidle');page.get_by_text('Task',exact=True).click()
 page.get_by_role('textbox',name='Task name',exact=True).fill('Step 7A browser file acceptance')
 page.get_by_role('textbox',name='Prompt',exact=True).fill('Read input.csv in the project workspace '+WORK+'. Use the enabled qa-enabled-proof skill and write result.json with total_cents, the instruction/memory/user-memory/skill codes, and the three item names in rows. Reread and verify the generated file. Do not edit files outside this workspace, enable tools, spawn agents, or modify credentials. Report the actual output path and tool results. Mark this task complete only after verifying the file.')
 page.get_by_role('combobox',name='Assigned agent',exact=True).click();page.get_by_role('option',name=re.compile(re.escape('('+QA+')'))).click()
 events=[]
 def capture(r):
  if r.url.endswith('/api/v1/mutations') and r.request.method=='POST':events.append({'request':r.request.post_data_json,'status':r.status,'response':r.json()})
 page.on('response',capture)
 page.get_by_role('button',name='Promote to ready',exact=True).click()
 expect(page.get_by_text('Created and promoted Step 7A browser file acceptance to ready.',exact=True)).to_be_visible()
 page.goto(BASE+'/work?workPage=board&framework=hermes-alica&project='+QA,wait_until='networkidle');expect(page.get_by_text('Step 7A browser file acceptance',exact=True)).to_be_visible()
 before=page.locator('main').inner_text() if page.locator('main').count() else page.locator('body').inner_text()
 page.reload(wait_until='networkidle');expect(page.get_by_text('Step 7A browser file acceptance',exact=True)).to_be_visible()
 (ROOT/'step7a-dispatch-browser.json').write_text(json.dumps({'qa':QA,'events':events,'reloadPreservedTask':True,'boardText':before},indent=2));page.screenshot(path=str(ROOT/'step7a-board-start.png'),full_page=True)
 print(json.dumps({'browserCreatedAndPromotedTask':True,'reloaded':True,'mutationStatuses':[x['status'] for x in events]}));b.close()

import json,os,re,subprocess,shlex,uuid,copy,time,contextlib
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
os.umask(0o077)
BASE='https://dsh-dev.aquiero.com';QA='qa-edit-concurrency-'+uuid.uuid4().hex[:8]
ROOT=Path(os.environ['DSH_QA_OUTPUT_DIR']);ROOT.mkdir(parents=True,exist_ok=True)
PASSWORD_FILE=Path(os.environ['DSH_QA_PASSWORD_FILE'])
SSH=['ssh','-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-i',os.environ['DSH_QA_SSH_KEY'],os.environ['DSH_QA_SSH_HOST']]
report={'qaProfile':QA,'modelCallsStarted':False}
def command(code,interactive=False):
 return SSH+['sudo -n docker exec '+('-i ' if interactive else '')+'--user 10000 -e HERMES_HOME=/opt/data/profiles/'+QA+' -e HERMES_PROFILE='+QA+' dsh2-internal-dev3-hermes-1 python3 -u -c '+shlex.quote("import os,json;from pathlib import Path;from hermes_constants import get_hermes_home;assert get_hermes_home()==Path('/opt/data/profiles/"+QA+"');"+code)]
def native(code):
 p=subprocess.run(command(code),capture_output=True,text=True,timeout=90);assert p.returncode==0,p.stderr;return json.loads(p.stdout)
labels={'description':'Agent description','instructions':'Agent instructions (SOUL.md)','memory':'Agent memory (MEMORY.md)','userMemory':'User memory (USER.md)'}
with sync_playwright() as pw:
 browser=pw.chromium.launch(headless=True);ctx=browser.new_context();page=ctx.new_page();errors=[];expect.set_options(timeout=90000)
 ctx.on('page',lambda p:p.on('pageerror',lambda e:errors.append(str(e))));page.on('pageerror',lambda e:errors.append(str(e)))
 page.set_default_timeout(150000)
 created=False
 try:
  page.goto(BASE,wait_until='networkidle');page.get_by_role('link',name='Continue to secure sign-in').click();page.wait_for_load_state('networkidle')
  page.locator('input[name="username"]').fill('internal-owner');page.locator('input[name="password"]').fill(PASSWORD_FILE.read_text().strip());page.locator('button[type="submit"],input[type="submit"]').click();page.wait_for_load_state('networkidle')
  def get(resource):
   r=ctx.request.get(BASE+'/api/v1/frameworks/hermes-alica/'+resource);assert r.ok,(r.status,r.text());return r.json()
  def cfg():return get('profiles/'+QA+'/configuration')['items'][0]
  def dialog(p=page):return p.get_by_role('dialog')
  def fill(v,p=page):
   for k,label in labels.items():dialog(p).get_by_label(label,exact=True).fill(v[k])
  def check(v,p=page):
   for k,label in labels.items():expect(dialog(p).get_by_label(label,exact=True)).to_have_value(v[k])
  def mutation(button,mode,status=201,p=page):
   with p.expect_response(lambda r:r.url.endswith('/api/v1/mutations') and r.request.post_data_json.get('mode')==mode,timeout=180000) as pending:dialog(p).get_by_role('button',name=button,exact=True).click()
   r=pending.value;assert r.status==status,(r.status,r.text());assert r.request.post_data_json['target']['nativeId']==QA;return r
  def dry(p=page):
   dialog(p).get_by_role('checkbox',name=re.compile('I confirm this')).check();return mutation('Validate and dry-run','dry-run',p=p)
  def reopen(p=page):
   p.goto(BASE+'/?view=profiles&framework=hermes-alica',wait_until='networkidle');p.get_by_role('button',name='Edit '+QA,exact=True).click();expect(dialog(p).get_by_label(labels['instructions'],exact=True)).to_be_enabled()
  def reload(p=page):
   p.once('dialog',lambda d:d.accept());dialog(p).get_by_role('button',name='Reload authoritative files',exact=True).click();expect(dialog(p).get_by_label(labels['instructions'],exact=True)).to_be_enabled()
  initial={'description':'Disposable concurrency verification','instructions':'Disposable verification instructions. No model tasks.','memory':'Initial QA memory.','userMemory':'Initial QA user preference.'}
  page.goto(BASE+'/?view=profiles&framework=hermes-alica',wait_until='networkidle');assert QA not in [x['id'] for x in get('profiles')['items']]
  page.get_by_role('button',name='Create Agent',exact=True).click();dialog().get_by_label('Agent ID',exact=True).fill(QA);fill(initial);dry();assert QA not in [x['id'] for x in get('profiles')['items']]
  mutation('Create Agent','execute');created=True;expect(dialog()).not_to_be_visible();assert all(cfg()[k]==v for k,v in initial.items());reopen();check(initial)
  report['createDryRunNoProfile']=True;report['createSaveReopen']=True
  baseline=cfg();inventory=baseline['runtime'];assert inventory['available'];models=inventory['models'];assert len(models)>=2
  edited={**initial,'description':'Edited QA identity','instructions':'Edited verification instructions. No tasks.','memory':'Human edited memory.','userMemory':'Human edited user preference.'}
  fill(edited)
  def choose(label,m):
   dialog().get_by_role('combobox',name=label,exact=True).click();name=m['model']+' · '+m['provider']+('' if m['authenticated'] else ' (needs authorization)');page.get_by_role('option',name=name,exact=True).click()
  primary=models[0];fallback=models[1];choose('Primary model',primary)
  dialog().get_by_role('button',name='Add fallback',exact=True).click();choose('Fallback 1 model',fallback)
  t=inventory['tools'][0];s=inventory['skills'][0];tool_id=t['id'];skill_id=s['id']
  for title in ['Tools','Skills']:dialog().get_by_role('button',name=re.compile('^'+title)).click()
  dialog().get_by_label('Filter native toolsets',exact=True).fill(tool_id);dialog().get_by_role('checkbox',name='Enable toolset '+tool_id,exact=True).set_checked(not inventory['settings']['tools'][tool_id])
  dialog().get_by_label('Filter installed skills',exact=True).fill(skill_id);dialog().get_by_role('checkbox',name='Enable skill '+skill_id,exact=True).set_checked(not inventory['settings']['skills'][skill_id])
  dry();assert cfg()['revision']==baseline['revision'];mutation('Save Agent','execute');expect(dialog()).not_to_be_visible();reopen();check(edited)
  saved=cfg();settings=saved['runtime']['settings'];assert settings['primary']['model']==primary['model'];assert settings['fallbacks'][0]['model']==fallback['model'];assert settings['tools'][tool_id]!=inventory['settings']['tools'][tool_id];assert settings['skills'][skill_id]!=inventory['settings']['skills'][skill_id]
  def native_read(expected):
   code="from hermes_cli.config import load_config;from hermes_cli.fallback_config import get_fallback_chain;from agent.prompt_builder import load_soul_md;from tools.memory_tool import MemoryStore;from hermes_cli.skills_config import get_disabled_skills;from hermes_cli import tools_config as tc;from utils import is_truthy_value;import yaml;c=load_config();m=MemoryStore();m.load_from_disk();e=json.loads("+repr(json.dumps(expected))+");assert load_soul_md().strip()==e['instructions'].strip();assert m.memory_entries==e['memory'].split('\\n§\\n');assert m.user_entries==e['userMemory'].split('\\n§\\n');assert yaml.safe_load((get_hermes_home()/'profile.yaml').read_text())['description']==e['description'];assert c['model']['default']==e['runtime']['settings']['primary']['model'];assert [(x['provider'],x['model']) for x in get_fallback_chain(c)]==[(x['provider'],x['model']) for x in e['runtime']['settings']['fallbacks']];n="+repr(tool_id)+";active=is_truthy_value(c.get(n,{}).get('enabled',True),default=True) if n in tc._CONFIG_ONLY_TOOLSETS else n in tc._get_platform_tools(c,tc._toolset_configuration_platform(n),include_default_mcp_servers=False);assert active==e['runtime']['settings']['tools'][n];assert ("+repr(skill_id)+" not in get_disabled_skills(c))==e['runtime']['settings']['skills']["+repr(skill_id)+"];print(json.dumps({'identity':True,'instructions':True,'memory':True,'userMemory':True,'primary':True,'fallbacks':True,'toolset':True,'skill':True}))"
   return native(code)
  def runtime_form_check(state):
   model=state['runtime']['settings']['primary'];meta=next(m for m in models if m['provider']==model['provider'] and m['model']==model['model'])
   label=lambda m:m['model']+' · '+m['provider']+('' if m['authenticated'] else ' (needs authorization)')
   expect(dialog().get_by_role('combobox',name='Primary model',exact=True)).to_have_value(label(meta))
   expect(dialog().get_by_role('combobox',name='Fallback 1 model',exact=True)).to_have_value(label(fallback))
   for title in ['Tools','Skills']:
    button=dialog().get_by_role('button',name=re.compile('^'+title))
    if button.get_attribute('aria-expanded')!='true':button.click()
   dialog().get_by_label('Filter native toolsets',exact=True).fill(tool_id);dialog().get_by_label('Filter installed skills',exact=True).fill(skill_id)
   expect(dialog().get_by_role('checkbox',name='Enable toolset '+tool_id,exact=True)).to_be_checked(checked=state['runtime']['settings']['tools'][tool_id])
   expect(dialog().get_by_role('checkbox',name='Enable skill '+skill_id,exact=True)).to_be_checked(checked=state['runtime']['settings']['skills'][skill_id])
  runtime_form_check(saved)
  report['nativeReadBack']=native_read(saved);report['allSectionsSaveReopen']=True
  # Two independent browser drafts share one revision, then submit overlapping saves.
  other=ctx.new_page();other.set_default_timeout(150000);reopen(other);check(edited,other)
  draft_a={**edited,'instructions':'Human A concurrent instructions.'};draft_b={**edited,'instructions':'Human B concurrent instructions.'};fill(draft_a);fill(draft_b,other);dry();dry(other)
  starts={};ends={}
  def watch(p,name):
   p.on('request',lambda r:starts.setdefault(name,time.monotonic()) if r.url.endswith('/api/v1/mutations') and r.post_data_json.get('mode')=='execute' else None)
   p.on('response',lambda r:ends.setdefault(name,time.monotonic()) if r.url.endswith('/api/v1/mutations') and r.request.post_data_json.get('mode')=='execute' else None)
  watch(page,'a');watch(other,'b')
  pred=lambda r:r.url.endswith('/api/v1/mutations') and r.request.post_data_json.get('mode')=='execute'
  with page.expect_response(pred,timeout=180000) as pa,other.expect_response(pred,timeout=180000) as pb:
   dialog().get_by_role('button',name='Save Agent',exact=True).click();dialog(other).get_by_role('button',name='Save Agent',exact=True).click()
  responses={'a':pa.value,'b':pb.value};assert sorted(r.status for r in responses.values())==[201,409],[(k,r.status,r.text()) for k,r in responses.items()];assert max(starts.values())<min(ends.values()),(starts,ends)
  winner='a' if responses['a'].status==201 else 'b';loser=other if winner=='a' else page;loser_draft=draft_b if winner=='a' else draft_a;check(loser_draft,loser);current=cfg();assert current['instructions']==(draft_a if winner=='a' else draft_b)['instructions'];expect(dialog(loser).get_by_role('button',name='Save Agent',exact=True)).to_be_disabled()
  reload(loser);check(current,loser);merged={k:current[k] for k in labels};merged['instructions']='Human A concurrent instructions.\nHuman B concurrent instructions.';fill(merged,loser);dry(loser);mutation('Save Agent','execute',p=loser);report['simultaneousBrowserSaves']={'overlappingRequests':True,'statuses':[201,409],'losingDraftPreserved':True,'reloadMergeSave':True}
  other.close();reopen();current=cfg();check(current)
  # An actual native memory_tool call holds its real file lock while the browser submits.
  draft={k:current[k] for k in labels};draft['memory']='Human draft during native memory write.';fill(draft);dry()
  code="from tools.memory_tool import MemoryStore,memory_tool;import contextlib,sys;m=MemoryStore();m.load_from_disk();original=m._file_lock\n@contextlib.contextmanager\ndef gate(path):\n with original(path):\n  print('LOCKED',flush=True);assert sys.stdin.readline().strip()=='go';yield\nm._file_lock=gate\nr=json.loads(memory_tool(action='add',target='memory',content='Native concurrent memory addition.',store=m));assert r.get('success'),r;print(json.dumps({'nativeToolSucceeded':True}))"
  proc=subprocess.Popen(command(code,True),stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
  try:
   assert proc.stdout is not None
   assert proc.stdout.readline().strip()=='LOCKED'
   with page.expect_response(pred,timeout=180000) as pending:
    with page.expect_request(lambda r:r.url.endswith('/api/v1/mutations') and r.post_data_json.get('mode')=='execute'):dialog().get_by_role('button',name='Save Agent',exact=True).click()
    out,err=proc.communicate('go\n',timeout=90);assert proc.returncode==0,err;assert json.loads(out)['nativeToolSucceeded']
   assert pending.value.status==409,(pending.value.status,pending.value.text())
  finally:
   if proc.poll() is None:proc.kill();proc.wait()
  check(draft);after=cfg();assert 'Native concurrent memory addition.' in after['memory'];assert 'Human draft during native memory write.' not in after['memory'];reload();check(after)
  merged={k:after[k] for k in labels};merged['memory']+='\n§\nHuman draft during native memory write.';fill(merged);dry();mutation('Save Agent','execute');reopen();check(merged);report['simultaneousNativeMemoryWrite']={'realNativeToolAndLock':True,'browserSubmittedWhileNativeLockHeld':True,'staleSaveStatus':409,'draftPreserved':True,'nativeAdditionPreservedAfterMerge':True}
  # Native config co-edit while browser has a reviewed runtime draft.
  before=cfg();choose('Primary model',fallback);dry();native("from hermes_cli.config import load_config,save_config;c=load_config();c['qa_step4_native_edit']='retained';save_config(c);print(json.dumps({'saved':True}))")
  mutation('Save Agent','execute',409);expect(dialog().get_by_role('combobox',name='Primary model',exact=True)).to_have_value(fallback['model']+' · '+fallback['provider']+('' if fallback['authenticated'] else ' (needs authorization)'));assert cfg()['runtime']['settings']['primary']==before['runtime']['settings']['primary'];reload();check(merged);choose('Primary model',fallback);dry();mutation('Save Agent','execute');reopen();check(merged)
  report['nativeConfigCoedit']={'staleSaveStatus':409,'runtimeDraftPreserved':True,'reloadMergeSave':True};native("from hermes_cli.config import load_config;assert load_config()['qa_step4_native_edit']=='retained';print(json.dumps({'nativeAdditionPreserved':True}))")
  runtime_form_check(cfg());report['finalNativeReadBack']=native_read(cfg());assert not errors,errors;report['javascriptErrors']=errors
  page.screenshot(path=str(ROOT/'agent-edit-concurrency-proof.png'),full_page=True)
  print(json.dumps({'verificationPassed':report}),flush=True)
 finally:
  if created:
   cleanup="import io,contextlib;from hermes_cli.profiles import delete_profile;from hermes_constants import set_hermes_home_override;set_hermes_home_override('/opt/data');os.environ['HERMES_HOME']='/opt/data';os.environ['HERMES_PROFILE']='default'\nwith contextlib.redirect_stdout(io.StringIO()):delete_profile("+repr(QA)+",yes=True)\nassert not Path('/opt/data/profiles/"+QA+"').exists();print(json.dumps({'qaRemoved':True}))"
   report['cleanup']=native(cleanup);print(json.dumps(report['cleanup']),flush=True)
  browser.close()
(ROOT/'agent-edit-concurrency-proof.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report),flush=True)

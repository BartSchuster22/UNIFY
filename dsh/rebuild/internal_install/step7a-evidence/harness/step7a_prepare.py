import json,os,uuid,contextlib,io,shutil
from pathlib import Path
os.umask(0o077)
from hermes_constants import get_hermes_home
assert get_hermes_home()==Path('/opt/data')
assert os.getuid()==Path('/opt/data').stat().st_uid, 'Run QA setup as the runtime owner, not container root'
from hermes_cli.profiles import create_profile
qa='qa-step7a-'+uuid.uuid4().hex[:8]
with contextlib.redirect_stdout(io.StringIO()):home=create_profile(qa,no_alias=True,no_skills=True,description='Disposable Step 7A model-backed acceptance')
workspace=Path('/opt/data/workspace')/qa;workspace.mkdir(mode=0o700)
assert home==Path('/opt/data/profiles')/qa
# Private disposable authorization; never edit the owner credential store.
if Path('/opt/data/auth.json').is_file():shutil.copyfile('/opt/data/auth.json',home/'auth.json');(home/'auth.json').chmod(0o600)
from hermes_constants import set_hermes_home_override
set_hermes_home_override(str(home));os.environ['HERMES_HOME']=str(home);os.environ['HERMES_PROFILE']=qa
from hermes_cli.config import load_config,save_config
from hermes_cli.runtime_provider import resolve_runtime_provider
from hermes_cli.inventory import load_picker_context,build_model_options_payload
from hermes_cli import tools_config as tc
catalog=build_model_options_payload(load_picker_context(),include_unconfigured=True)
choices=[{'provider':p['slug'],'model':m,'authenticated':bool(p.get('authenticated'))} for p in catalog['providers'] for m in p.get('models',[]) if isinstance(m,str)]
selected=next(x for x in choices if x['provider']=='openai-codex' and x['model']=='gpt-5.6-sol')
c=load_config();c['model']={'provider':selected['provider'],'default':selected['model']};c['fallback_providers']=[];c['agent']['max_turns']=12;c['terminal']={'backend':'local','cwd':str(workspace)};c['platform_toolsets']={'cli':['file','memory','skills','terminal']};c['skills']={'disabled':['qa-disabled-proof']}
save_config(c)
(home/'SOUL.md').write_text('You are a bounded acceptance agent. Work only in '+str(workspace)+'. Do not read credentials, spawn other agents, or modify anything outside that workspace except your native memory tool. Instruction proof code: SOUL-STEP7A-ORCHID. Load qa-enabled-proof only for a CSV file task. For a lifecycle sleep task obey its exact bounded command instead.\n')
(home/'memories/MEMORY.md').write_text('Agent memory proof code: MEMORY-STEP7A-CEDAR.\n')
(home/'memories/USER.md').write_text('User memory proof code: USER-STEP7A-AMBER.\n')
for name,description,content in [('qa-enabled-proof','Bounded QA file workflow and output schema.','Skill proof code: SKILL-STEP7A-COBALT. Read input.csv, total each row quantity * unit_price using the available tools or careful reasoning, and write result.json with total_cents and codes. Only use files in the provided disposable workspace.'),('qa-disabled-proof','Disabled QA skill must not appear in active skill discovery.','Disabled sentinel: DISABLED-STEP7A-NEVER.')]:
 p=home/'skills'/name;p.mkdir();(p/'SKILL.md').write_text('---\nname: '+name+'\ndescription: '+description+'\n---\n'+content+'\n')
(workspace/'input.csv').write_text('item,quantity,unit_price_cents\nalpha,3,125\nbeta,2,240\ngamma,4,85\n')
resolved=resolve_runtime_provider(requested='openai-codex',target_model='gpt-5.6-sol')
report={'qa':qa,'workspace':str(workspace),'home':str(home),'selected':selected,'credentialAvailable':bool(resolved.get('api_key')),'resolvedProvider':resolved.get('provider'),'toolsets':list(tc._get_platform_tools(c,'cli')),'models':choices}
Path('/tmp/step7a-current.json').write_text(json.dumps(report));print(json.dumps(report))

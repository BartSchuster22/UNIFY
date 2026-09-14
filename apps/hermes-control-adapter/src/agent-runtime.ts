// Native helpers are loaded inside the selected profile's isolated Python process.
export const runtimeBridge = String.raw`
def runtime_inventory(cfg):
 import copy
 os.environ['HERMES_HOME']=str(home);os.environ['HERMES_PROFILE']=ident
 from hermes_constants import set_hermes_home_override
 set_hermes_home_override(str(home))
 from hermes_cli.inventory import load_picker_context,build_model_options_payload
 from hermes_cli.fallback_config import get_fallback_chain
 from hermes_cli import tools_config as tc
 from hermes_cli.skills_config import get_disabled_skills
 from tools.skills_tool import _find_all_skills
 from toolsets import resolve_toolset
 from utils import is_truthy_value
 catalog=build_model_options_payload(load_picker_context(),include_unconfigured=True)
 models=[{'provider':p['slug'],'model':m,'authenticated':bool(p.get('authenticated'))} for p in catalog['providers'] for m in p.get('models',[]) if isinstance(m,str)]
 providers=[{'id':p['slug'],'authenticated':bool(p.get('authenticated'))} for p in catalog['providers']]
 model=cfg.get('model');primary=None
 if isinstance(model,dict) and model.get('default'):primary={'provider':str(model.get('provider') or catalog.get('provider') or 'auto'),'model':str(model['default'])}
 elif isinstance(model,str) and model:primary={'provider':str(catalog.get('provider') or 'auto'),'model':model}
 chain=get_fallback_chain(cfg)
 def reference(entry):return hashlib.sha256(json.dumps(entry,sort_keys=True,default=str).encode()).hexdigest()
 fallbacks=[{'provider':e['provider'],'model':e['model'],'ref':reference(e)} for e in chain]
 rows=tc._get_effective_configurable_toolsets();platforms={tc._toolset_configuration_platform(n) for n,_,_ in rows}
 enabled={p:tc._get_platform_tools(cfg,p,include_default_mcp_servers=False) for p in platforms}
 tools=[]
 for name,label,desc in rows:
  platform=tc._toolset_configuration_platform(name);section=cfg.get(name);section=section if isinstance(section,dict) else {}
  active=is_truthy_value(section.get('enabled',True),default=True) if name in tc._CONFIG_ONLY_TOOLSETS else name in enabled[platform]
  tools.append({'id':name,'label':tc.gui_toolset_label(label),'description':desc,'platform':platform,'enabled':active,'configured':bool(tc._toolset_has_keys(name,cfg)),'tools':sorted(set(resolve_toolset(name)))})
 disabled=get_disabled_skills(cfg);skills=[{'id':s['name'],'description':s.get('description',''),'enabled':s['name'] not in disabled} for s in _find_all_skills(skip_disabled=True)]
 return {'available':True,'settings':{'primary':primary,'fallbacks':fallbacks,'tools':{t['id']:t['enabled'] for t in tools},'skills':{s['id']:s['enabled'] for s in skills}},'models':models,'providers':providers,'tools':tools,'skills':skills},chain

def apply_runtime(cfg,incoming,current,chain):
 import copy
 if not isinstance(incoming,dict) or set(incoming)!={'primary','fallbacks','tools','skills'}:raise ValueError('Invalid runtime settings')
 updated=copy.deepcopy(cfg);saved=current['settings'];pairs={(m['provider'],m['model']) for m in current['models']}
 def check_model(value):
  if not isinstance(value,dict) or set(value)-{'provider','model','ref'}:raise ValueError('Invalid model selection')
  if not isinstance(value.get('provider'),str) or not isinstance(value.get('model'),str):raise ValueError('Invalid model selection')
  if (value['provider'],value['model']) not in pairs:raise ValueError('Model is not in this profile runtime inventory')
 primary=incoming['primary']
 if primary!=saved['primary']:
  check_model(primary)
  from hermes_cli.web_server import _apply_main_model_assignment
  updated['model']=_apply_main_model_assignment(updated.get('model',{}),primary['provider'],primary['model'])
 if incoming['fallbacks']!=saved['fallbacks']:
  if not isinstance(incoming['fallbacks'],list) or len(incoming['fallbacks'])>20:raise ValueError('Invalid fallback chain')
  old={v['ref']:e for v,e in zip(saved['fallbacks'],chain)};result=[];seen=set()
  for entry in incoming['fallbacks']:
   if not isinstance(entry,dict) or set(entry)-{'provider','model','ref'}:raise ValueError('Invalid fallback')
   ref=entry.get('ref');previous=old.get(ref) if ref else None
   if ref and (previous is None or entry.get('provider')!=previous['provider']):raise ValueError('Invalid fallback reference')
   if not previous or entry.get('model')!=previous['model']:check_model(entry)
   value=copy.deepcopy(previous) if previous else {};value.update(provider=entry['provider'],model=entry['model'])
   identity=(value['provider'],value['model'],value.get('base_url',''))
   if identity in seen:raise ValueError('Duplicate fallback route')
   seen.add(identity);result.append(value)
  updated['fallback_providers']=result;updated.pop('fallback_model',None)
 from hermes_cli import tools_config as tc
 # Native helper mutates the candidate, but commit belongs to the guarded transaction.
 tc.save_config=lambda _:None
 for kind in ['tools','skills']:
  values=incoming[kind]
  if not isinstance(values,dict) or set(values)!=set(saved[kind]) or any(type(v)!=bool for v in values.values()):raise ValueError('Runtime inventory changed or invalid selection; reload')
 changed_platforms={t['platform'] for t in current['tools'] if incoming['tools'][t['id']]!=saved['tools'][t['id']] and t['id'] not in tc._CONFIG_ONLY_TOOLSETS}
 for platform in changed_platforms:
  enabled=tc._get_platform_tools(updated,platform,include_default_mcp_servers=False)
  for t in current['tools']:
   if t['platform']==platform and t['id'] not in tc._CONFIG_ONLY_TOOLSETS:
    if incoming['tools'][t['id']]:enabled.add(t['id'])
    else:enabled.discard(t['id'])
  preserve_no_mcp='no_mcp' in (updated.get('platform_toolsets',{}).get(platform) or [])
  tc._save_platform_tools(updated,platform,enabled)
  if preserve_no_mcp:updated['platform_toolsets'][platform].append('no_mcp')
 for name in tc._CONFIG_ONLY_TOOLSETS:
  if name in incoming['tools'] and incoming['tools'][name]!=saved['tools'][name]:updated.setdefault(name,{})['enabled']=incoming['tools'][name]
 if incoming['skills']!=saved['skills']:
  from hermes_cli.skills_config import get_disabled_skills
  disabled=get_disabled_skills(updated)
  for name,enabled in incoming['skills'].items():
   if enabled:disabled.discard(name)
   else:disabled.add(name)
  updated.setdefault('skills',{})['disabled']=sorted(disabled)
 return updated
`;

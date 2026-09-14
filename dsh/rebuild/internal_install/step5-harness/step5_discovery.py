import json,os,sys,time,atexit,functools,hashlib
from pathlib import Path
QA='qa-runtime-live-977d4eef';HOME=Path('/opt/data/profiles')/QA;WORK=Path('/opt/data/workspace')/QA
assert os.environ['HERMES_HOME']==str(HOME) and HOME.is_dir() and WORK.is_dir()
os.umask(0o077);os.chdir(WORK)
from hermes_constants import get_hermes_home
assert get_hermes_home()==HOME
from run_agent import AIAgent
trace={'qa':QA,'requests':[],'tools':[],'systemPromptChecks':[],'sessions':[]}
report=HOME/'step5-discovery-trace.json'
def persist():report.write_text(json.dumps(trace,indent=2,default=str))
atexit.register(persist)
original_init=AIAgent.__init__
def init(self,*a,**kw):
 original_init(self,*a,**kw)
 trace['sessions'].append({'provider':getattr(self,'provider',None),'model':self.model,'sessionId':getattr(self,'session_id',None)})
 trace['toolAttributes']={k:v for k,v in self.__dict__.items() if 'tool' in k and isinstance(v,(set,list)) and all(isinstance(x,str) for x in v)}
 persist()
AIAgent.__init__=init
original_prompt=AIAgent._build_system_prompt
def prompt(self,*a,**kw):
 result=original_prompt(self,*a,**kw)
 trace['systemPromptChecks'].append({k:v in result for k,v in {'instructions':'SOUL-STEP5-ORCHID','memory':'MEMORY-STEP5-CEDAR','userMemory':'USER-STEP5-AMBER','enabledSkill':'qa-enabled-proof','disabledSkill':'qa-disabled-proof'}.items()});persist();return result
AIAgent._build_system_prompt=prompt
original_call=AIAgent._interruptible_api_call
def call(self,api_kwargs):
 tools=[t.get('function',{}).get('name',t.get('name')) for t in api_kwargs.get('tools',[])]
 assert 'terminal' not in tools,'Disabled terminal unexpectedly exposed'
 row={'provider':getattr(self,'provider',None),'model':self.model,'requestModel':api_kwargs.get('model'),'toolNames':tools,'status':'started'};trace['requests'].append(row);persist()
 try:
  result=original_call(self,api_kwargs);row['status']='returned';return result
 except Exception as e:row['status']='error';row['errorType']=type(e).__name__;raise
 finally:persist()
AIAgent._interruptible_api_call=call
original_tools=AIAgent._execute_tool_calls
def execute(self,assistant_message,messages,*a,**kw):
 before=len(messages)
 result=original_tools(self,assistant_message,messages,*a,**kw)
 for m in messages[before:]:
  if m.get('role')=='tool':trace['tools'].append({'name':m.get('name'),'tool_call_id':m.get('tool_call_id'),'content':m.get('content')})
 persist();return result
AIAgent._execute_tool_calls=execute
query='In this fresh acceptance session, call skills_list to inspect active installed skills and call tool_search with query terminal to inspect whether the disabled terminal tool is available. Do not enable anything or execute a shell command. Report the actual tool results. Also report whether your loaded agent memory includes the completion entry from the previous session. Do not read any profile files directly.'
sys.argv=['hermes','chat','-q',query,'--quiet','--source','tool','--max-turns','12']
from hermes_cli.main import main
try:main()
finally:persist()

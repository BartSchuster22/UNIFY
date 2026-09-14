import json,os,sys,time,atexit,functools,hashlib
from pathlib import Path
QA='qa-runtime-live-977d4eef';HOME=Path('/opt/data/profiles')/QA;WORK=Path('/opt/data/workspace')/QA
assert os.environ['HERMES_HOME']==str(HOME) and HOME.is_dir() and WORK.is_dir()
os.umask(0o077);os.chdir(WORK)
from hermes_constants import get_hermes_home
assert get_hermes_home()==HOME
from hermes_cli.config import load_config,save_config
saved_config=load_config();configured=__import__('copy').deepcopy(saved_config)
configured['fallback_providers']=[{'provider':'openai-codex','model':'gpt-5.6-terra'},{'provider':'openai-codex','model':'gpt-5.6-luna'}]
save_config(configured)
from http.server import HTTPServer,BaseHTTPRequestHandler
from threading import Thread
class Fault(BaseHTTPRequestHandler):
 def do_GET(self):
  self.send_response(429);self.send_header('Content-Type','application/json');self.end_headers();self.wfile.write(b'{"error":{"message":"QA controlled rate-limit fault","type":"rate_limit_error","code":"rate_limit_exceeded"}}')
 def log_message(self,*args):pass
server=HTTPServer(('127.0.0.1',0),Fault);worker=Thread(target=server.serve_forever,daemon=True);worker.start()
from run_agent import AIAgent
trace={'qa':QA,'requests':[],'tools':[],'systemPromptChecks':[],'sessions':[]}
report=HOME/'step5-fallback-trace.json'
def persist():report.write_text(json.dumps(trace,indent=2,default=str))
atexit.register(persist)
original_init=AIAgent.__init__
def init(self,*a,**kw):
 original_init(self,*a,**kw)
 trace['sessions'].append({'provider':getattr(self,'provider',None),'model':self.model,'sessionId':getattr(self,'session_id',None)})
 persist()
AIAgent.__init__=init
original_prompt=AIAgent._build_system_prompt
def prompt(self,*a,**kw):
 result=original_prompt(self,*a,**kw)
 trace['systemPromptChecks'].append({k:v in result for k,v in {'instructions':'SOUL-STEP5-ORCHID','memory':'MEMORY-STEP5-CEDAR','userMemory':'USER-STEP5-AMBER','enabledSkill':'qa-enabled-proof','disabledSkill':'qa-disabled-proof'}.items()});persist();return result
AIAgent._build_system_prompt=prompt
original_fallback=AIAgent._try_activate_fallback
def activate(self,*a,**kw):
 before=self.model;result=original_fallback(self,*a,**kw)
 trace.setdefault('fallbackTransitions',[]).append({'before':before,'after':self.model,'activated':result});persist();return result
AIAgent._try_activate_fallback=activate
original_call=AIAgent._interruptible_api_call
def call(self,api_kwargs):
 tools=[t.get('function',{}).get('name',t.get('name')) for t in api_kwargs.get('tools',[])]
 assert 'terminal' not in tools,'Disabled terminal unexpectedly exposed'
 row={'provider':getattr(self,'provider',None),'model':self.model,'requestModel':api_kwargs.get('model'),'toolNames':tools,'status':'started'};trace['requests'].append(row);persist()
 try:
  if self.model in ['gpt-5.6-sol','gpt-5.6-terra']:
   import httpx,openai
   response=httpx.get('http://127.0.0.1:'+str(server.server_port)+'/qa-controlled-fault',trust_env=False)
   assert response.status_code==429
   row['faultInjection']='local-http-429; no upstream inference attempted'
   raise openai.RateLimitError('QA controlled rate-limit fault',response=response,body=response.json())
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
query='Reply with exactly STEP5-FALLBACK-OK. This is an inference-only check, not a file task. Do not call any tools.'
sys.argv=['hermes','chat','-q',query,'--quiet','--source','tool','--max-turns','12']
from hermes_cli.main import main
try:main()
finally:
 server.shutdown();server.server_close();save_config(saved_config);trace['configurationRestored']=load_config()==saved_config;persist()

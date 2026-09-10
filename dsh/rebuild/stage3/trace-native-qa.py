#!/usr/bin/env python3
"""One NEW bounded native diagnostic, not replay or installed-stack acceptance."""
import json,subprocess
name='dsh2-stage3-qa2-hermes-1'
meta=json.loads(subprocess.check_output(['docker','inspect',name]))[0]
assert meta['Config']['Labels']['com.docker.compose.project']=='dsh2-stage3-qa2'
code="""import contextlib,importlib.util,json,os,traceback,uuid
from pathlib import Path
report={'diagnosticOnly':True,'existingReceiptReplayed':False}
# Match the actual service environment without printing or exporting its secrets.
for p in Path('/proc').iterdir():
 if not p.name.isdigit():continue
 try:
  cmd=(p/'cmdline').read_bytes().split(b'\\0')
  if any(x.endswith(b'/opt/unify-adapter/dist/server.js') for x in cmd):
   env=dict(x.split(b'=',1) for x in (p/'environ').read_bytes().split(b'\\0') if b'=' in x)
   os.environ.clear();os.environ.update({k.decode():v.decode() for k,v in env.items()});report['serviceEnvironmentMatched']=True;break
 except (OSError,ValueError):pass
os.chdir('/opt/unify-adapter/application-runtime')
with open(os.devnull,'w') as quiet,contextlib.redirect_stdout(quiet),contextlib.redirect_stderr(quiet):
 spec=importlib.util.spec_from_file_location('worker','/opt/unify-adapter/application-runtime/worker.py');w=importlib.util.module_from_spec(spec);spec.loader.exec_module(w)
 original=w.evaluate
 def evaluated(agent,data,evidence):
  run=agent.run_conversation
  def observe(*a,**kw):
   reply=run(*a,**kw)
   report['replyShape']={'type':type(reply).__name__}
   if isinstance(reply,dict):
    report['replyShape'].update({'keys':sorted(reply),'errorPresent':bool(reply.get('error')),'interrupted':bool(reply.get('interrupted')),'finalResponseLength':len(reply.get('final_response') or '')})
    text=str(reply.get('error','')).lower();report['errorCategories']=[x for x in ['401','403','429','expired','unauthorized','permission','read-only','rate limit','timeout'] if x in text]
   return reply
  agent.run_conversation=observe
  return original(agent,data,evidence)
 w.evaluate=evaluated
 data={'receiptId':str(uuid.uuid4()),'applicationId':'008403f4-9308-4dbb-a785-5e88d3093ed5','projectId':'installed-app-qa','subject':'customer-a','payload':{'contractVersion':'alica-application/v1','subject':'customer-a','operation':'research','question':'Which four top-level DNS names does RFC 2606 reserve? Cite the RFC and quote the exact list, preserving its whitespace.'},'sourceUrls':['https://www.rfc-editor.org/rfc/rfc2606.txt']}
 def runner(*a):
  try:return w.research(*a)
  except Exception as e:
   report['exception']=type(e).__name__;report['frames']=[{'file':os.path.basename(f.filename),'line':f.lineno,'function':f.name} for f in traceback.extract_tb(e.__traceback__)]
   raise
 store=w.NativeStore()
 try:
  out=w.handle('execute',w.validate(data,'execute'),store,runner);report['state']=out['state'];report['reference']=out['reference']
 finally:store.close()
print(json.dumps(report))
"""
p=subprocess.run(['docker','exec','-i','--user','10000:10001',name,'/usr/bin/env','PYTHONPATH=/opt/hermes','/opt/hermes/.venv/bin/python','-c',code],capture_output=True,timeout=200)
if p.returncode:raise RuntimeError('Diagnostic failed; raw stderr withheld')
print(p.stdout.decode())

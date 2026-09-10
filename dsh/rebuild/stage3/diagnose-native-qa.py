#!/usr/bin/env python3
"""No inference replay; report exception classes/frames, never provider messages or secrets."""
import json,subprocess
name='dsh2-stage3-qa2-hermes-1'
meta=json.loads(subprocess.check_output(['docker','inspect',name]))[0]
assert meta['Config']['Labels']['com.docker.compose.project']=='dsh2-stage3-qa2'
code="""import contextlib,importlib.util,json,os,traceback
report={}
with open(os.devnull,'w') as quiet,contextlib.redirect_stdout(quiet),contextlib.redirect_stderr(quiet):
 spec=importlib.util.spec_from_file_location('worker','/opt/unify-adapter/application-runtime/worker.py');w=importlib.util.module_from_spec(spec);spec.loader.exec_module(w)
 def check(name,fn):
  try:
   value=fn();report[name]={'ok':True};return value
  except Exception as e:report[name]={'ok':False,'exception':type(e).__name__,'frames':[{'file':os.path.basename(f.filename),'line':f.lineno,'function':f.name} for f in traceback.extract_tb(e.__traceback__)]}
 source=check('approvedSourceFetch',lambda:w.fetch('https://www.rfc-editor.org/rfc/rfc2606.txt'))
 store=check('nativeStore',w.NativeStore)
 if store:
  agent=check('nativeAgentConstruction',lambda:w.native_agent(store.sessions,'alica-app-05061fdf-e715-4dfb-9662-4b438c8689f8'))
  if agent:report['toolsEmpty']=not agent.tools;agent.close()
  store.close()
print(json.dumps(report))
"""
p=subprocess.run(['docker','exec','-i','--user','10000:10001',name,'/usr/bin/env','HERMES_HOME=/opt/data','HOME=/opt/data','PYTHONPATH=/opt/hermes','/opt/hermes/.venv/bin/python','-c',code],capture_output=True,timeout=75)
if p.returncode:raise RuntimeError('Diagnostic failed; raw stderr withheld')
print(p.stdout.decode())

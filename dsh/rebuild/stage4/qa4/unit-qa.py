#!/usr/bin/env python3
"""Bounded regression suites; live SDK is real, inference/transport fixtures are mocks."""
import json,re,subprocess
from qa_common import *
BASE='/srv/alica-dsh-development/repos/'
cases={
 'restricted-worker-mocked':(['python3','-m','unittest','discover','-s',BASE+'UNIFY/integrations/hermes/application-runtime','-p','test_worker.py'],27),
 'reference-app-mocked':(['python3','-m','unittest','discover','-s',BASE+'Alica-DSH/reference-app','-p','test*.py'],38),
 'native-sdk-workflow-mocked-transport':(['docker','run','--rm','--network','none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--cpus','1','--memory','768m','--pids-limit','128','--user','10000:10001','--tmpfs','/native-home:rw,uid=10000,gid=10001,mode=0700,size=64m','--tmpfs','/tmp:rw,size=64m','--mount','type=bind,src='+BASE+'UNIFY/integrations/hermes/application-runtime,dst=/fixture,readonly','--entrypoint','/usr/bin/env','sha256:96ed2f016fb159f48058f668a3baccd2d8154644dfd3519b9e683c4e7c636bd9','HERMES_HOME=/native-home','HOME=/native-home','PYTHONPATH=/opt/hermes','/opt/hermes/.venv/bin/python','/fixture/test_workflow.py'],16)}
# Exact built image pin, never an editable runtime tag.
results={}
for name,(args,expected) in cases.items():
 p=subprocess.run(args,capture_output=True,text=True,timeout=180);log=p.stdout+p.stderr;(OUT/(name+'.log')).write_text(log)
 m=re.search(r'Ran (\d+) tests',log);assert p.returncode==0 and m and int(m[1])==expected,name
 results[name]={'passed':True,'tests':int(m[1]),'liveModelCalls':False}
results['totalTests']=sum(v['tests'] for v in results.values())
(OUT/'unit-results.json').write_text(json.dumps(results,indent=2));print(json.dumps(results))

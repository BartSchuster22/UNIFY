"""Narrow, executable Stage7 QA compatibility policy; no general rollback promise."""
import json,platform,subprocess
from pathlib import Path
POLICY={'schema':'alica-stage7-compatibility/v1','osId':'ubuntu','osVersion':'26.04','architecture':'x86_64','dockerVersion':'29.1.3','storageDriver':'overlay2','composeVersionPrefix':'2.40.3','runtimeImageChanges':'deny','databaseSchemaChanges':'deny','scope':'QA3 host operations only; exact signed 2772d9c predecessor, v2-to-v2 preservation; production unqualified'}
def validate(host):
 for key in ('osId','osVersion','architecture','dockerVersion','storageDriver'):
  if host.get(key)!=POLICY[key]:raise ValueError('Unsupported '+key)
 v=host.get('composeVersion','')
 if v!='2.40.3' and not v.startswith('2.40.3+'):raise ValueError('Unsupported compose version')
 return host

def inspect():
 values={k:v.strip('"') for k,v in (line.split('=',1) for line in Path('/etc/os-release').read_text().splitlines() if '=' in line)}
 def run(a):return subprocess.check_output(a,text=True,stderr=subprocess.DEVNULL,timeout=15).strip()
 return validate({'osId':values['ID'],'osVersion':values['VERSION_ID'],'architecture':platform.machine(),'dockerVersion':run(['docker','version','--format','{{.Server.Version}}']),'storageDriver':run(['docker','info','--format','{{.Driver}}']),'composeVersion':run(['docker','compose','version','--short'])})
if __name__=='__main__':print(json.dumps({'policy':POLICY,'observed':inspect(),'passed':True}))

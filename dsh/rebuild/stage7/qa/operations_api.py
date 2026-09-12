import json
from qa_common import *
assert CELL=='dsh2-stage7-qa3'
s,_,_=http(CORE,'/api/v1/host-operations');assert s==401
s,r,_=owner('/api/v1/host-operations');assert s==200
s,_,_=owner('/api/v1/host-operations','POST',{'action':'restart','service':'postgresql'});assert s in (404,405)
raw=json.dumps(r)
secrets=[]
for line in (ROOT/'.env').read_text().splitlines():
 if '=' in line and any(x in line.split('=',1)[0].upper() for x in ('PASSWORD','TOKEN','SECRET')):
  value=line.split('=',1)[1].strip().strip('\"\'')
  if len(value)>=20:secrets.append(value)
for path in (ROOT/'secrets').iterdir():
 if path.is_file() and any(x in path.name.lower() for x in ('password','token','secret','bearer','.key')):
  value=path.read_text().strip()
  if len(value)>=20:secrets.append(value)
assert secrets and all(v not in raw for v in secrets)
result={'schema':'stage7-installed-operations-api/v1','anonymousDenied':True,'realOwnerReadAllowed':True,'mutationRouteAbsent':True,'installationSecretsNotDisclosed':True,'passed':True}
(OUT/'operations-api.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result))

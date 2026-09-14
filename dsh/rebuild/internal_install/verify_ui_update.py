import update_dev_ui as u,sys,json
sys.path.insert(0,str(u.NEW))
from install import Installer
from transaction import atomic_json
sys.path.insert(0,'/usr/local/lib/alica-dsh-ops/dsh2-internal-dev3')
from doghouse_dsh.broker import Broker,SERVICES
from doghouse_dsh.observer import request
p=u.NEW.parent/'update.json';r=json.loads(p.read_text())
i=Installer(u.NEW,r['newPin'],u.ROOT,json.loads(u.REQUEST.read_text()))
print('PLAN',i.plan())
live={x['Config']['Labels']['com.docker.compose.service']:x for x in i.owned() if x['State']['Running']}
Broker(u.ROOT/'operations/broker.json').verify_identity([live[s] for s in SERVICES])
assert u.identities()==json.loads((u.SAVE/'non-ui-before.json').read_text())
s=request('/run/alica-ops-dsh2-internal-dev3/broker.sock',{'op':'snapshot'})['status']
assert s['snapshot']['ownershipVerified'] and not s['maintenance']
r['state']='verified';atomic_json(p,r)
print(json.dumps({'update':'verified','onlyUiChanged':True,'ownership':True,'maintenance':False,'newReleaseSha256':r['newPin']}))

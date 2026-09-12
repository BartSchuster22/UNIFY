"""Read-only before/after real host reboot acceptance. Does not issue reboot."""
import hashlib,json,subprocess,sys
from pathlib import Path
import host_operations as q
from qa_common import backend,OUT,ROOT,CELL
assert CELL=='dsh2-stage7-qa3' and len(sys.argv)==2 and sys.argv[1] in ('snapshot','verify')
# SSH returns before the ordered cell -> broker -> observer startup finishes.
# Observe the real socket within one deadline; do not manually start services.
import time
end=time.monotonic()+420
while time.monotonic()<end:
 try:
  s=q.snap()
  if q.healthy(s):break
 except (FileNotFoundError,ConnectionRefusedError,BlockingIOError):pass
 time.sleep(3)
else:raise AssertionError('post-boot-readiness-timeout')
assert s['snapshot']['nativeWork']['observed'] and s['snapshot']['nativeWork']['active']==0
assert not s['maintenance']
files=[ROOT/'owner.json',ROOT/'transaction.json',ROOT/'compose.json',*sorted((ROOT/'secrets').iterdir())]
files=[p for p in files if p.is_file()]
assert all((ROOT/n) in files for n in ('owner.json','transaction.json','compose.json'))
assert len(files)>3
checksums={str(p.relative_to(ROOT)):hashlib.sha256(p.read_bytes()).hexdigest() for p in files}
containers=json.loads(q.cmd(['docker','inspect',*[CELL+'-'+n+'-1' for n in s['snapshot']['services']]]))
ids={r['Name']:r['Id'] for r in containers};assert len(ids)==7
code="import json;from hermes_cli import kanban_db;c=kanban_db.connect();rows=c.execute('SELECT id,session_id,status FROM tasks ORDER BY id').fetchall();c.close();print(json.dumps([list(r) for r in rows]))"
p=subprocess.run(['docker','exec','--user','10000:10001',CELL+'-hermes-1','env','HERMES_HOME=/opt/data','HOME=/opt/data','PYTHONPATH=/opt/hermes','/opt/hermes/.venv/bin/python','-c',code],capture_output=True,text=True,timeout=30);assert p.returncode==0
rid=json.loads((OUT/'first-result.json').read_text())['receiptId'];status,r,_=backend('/api/v1/application/requests/'+rid);assert status==200 and r['receipt']['phase']=='result-ready'
value={'bootId':Path('/proc/sys/kernel/random/boot_id').read_text().strip(),'containerIds':ids,'fileHashes':checksums,'nativeTasks':json.loads(p.stdout),'firstReceiptId':rid,'firstReceiptPhase':r['receipt']['phase']}
if sys.argv[1]=='snapshot':
 target=OUT/'pre-reboot.json';assert not target.exists();target.write_text(json.dumps(value,indent=2)+'\n');print(json.dumps({'preRebootRecorded':True,'nativeTasks':len(value['nativeTasks']),'servicesHealthy':7}))
else:
 before=json.loads((OUT/'pre-reboot.json').read_text());assert before['bootId']!=value['bootId'],'host-did-not-reboot'
 for k in ('containerIds','fileHashes','nativeTasks','firstReceiptId','firstReceiptPhase'):assert before[k]==value[k],k+'-changed'
 report={'schema':'stage7-real-reboot/v1','realBootIdChanged':True,'allSevenServicesHealthy':True,'containerIdentitiesPreserved':True,'ownerTransactionAndSecretsPreserved':True,'nativeTasksUnchanged':True,'completedReceiptPreserved':True,'noAutomaticBusinessReplay':True,'passed':True,'wholeStage7Accepted':False}
 (OUT/'reboot-result.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report))

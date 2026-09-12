from cold_restore import *
receipt=json.loads((OUT/'backup-receipt.json').read_text());stage=OUT/'verified'
assert archive.digest(stage/'manifest.json')==receipt['manifestSha256']
md=json.loads((stage/'manifest.json').read_text())['metadata']
p=json.loads((OUT/'cold-verified.json').read_text());assert p['byteAndMetadataVerification'] and p['releaseSha256']==RELEASE
import host_operations as h
end=time.monotonic()+90
while time.monotonic()<end:
 try:
  status=h.snap()
  if h.healthy(status):break
 except (FileNotFoundError,ConnectionRefusedError):pass
 time.sleep(2)
else:raise RuntimeError('Restored operations did not become healthy')
rows=json.loads(run(['docker','inspect',*NAMES]));assert all(r['Id']!=md['containerIdsBefore'][r['Name']] for r in rows)
rid=json.loads((q.OUT/'first-result.json').read_text())['receiptId'];s,value,_=q.backend('/api/v1/application/requests/'+rid);assert s==200 and value['receipt']['phase']=='result-ready'
assert status['snapshot']['nativeWork']['observed'] and status['snapshot']['nativeWork']['active']==0
assert native_tasks()==md['nativeTasks'],'Native task/session/status changed or business work replayed'
result={'schema':'stage7-qa4-cold-restore-result/v1','releaseSha256':RELEASE,'ciphertextSha256':receipt['ciphertextSha256'],'allStagedAndRestoredBytesAndMetadataVerified':True,'sevenContainersRecreated':True,'nativeTasksAndSessionLinksPreserved':True,'sevenServicesHealthy':True,'existingCompletedReceiptReadable':True,'nativeWorkObservedIdle':True,'quarantineRetained':True,'passed':True,'productionAccepted':False};save(OUT/'restore-result.json',result);print(json.dumps(result))

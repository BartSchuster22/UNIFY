"""Validate collected QA5 acceptance evidence and write a hash-linked verdict."""
import hashlib,json
from pathlib import Path
BASE=Path(__file__).parent/'evidence/dsh2-qa5'
def load(name):return json.loads((BASE/name).read_text())
def main():
 install=load('dsh2-install.json')
 assert install['installExit']==0 and install['transaction']['state']=='installed' and install['operationsEnrolled']
 assert install['plan']['cell']=='dsh2-stage5-qa5'
 gates={'installation':True}
 for name,count in [('host-operations.json',6),('extended-host.json',4),('business-faults.json',2)]:
  r=load(name);assert r['complete'] and len(r['cases'])==count and all(c['passed'] for c in r['cases']);gates[name]=True
 for name in ['ui-result.json','operations-api.json','reboot-result.json','post-boot-business.json']:
  assert load(name)['passed'];gates[name]=True
 ui=load('ui-result.json');assert ui['cell']=='dsh2-stage5-qa5' and not ui['tlsBypass'] and not ui['mockedResponses']
 oidc=load('oidc-first-login.json');assert all(oidc[k] for k in ('wrong_password_denied','mandatory_password_change','real_core_identity_session','native_inventory_through_identity_session'));gates['oidc']=True
 app=load('first-acceptance.json');assert all(app[k] for k in ('independentCustomerLogin','anonymousAndMissingCsrfDenied','appIdempotency','customerIsolation','realEndToEndResult'));assert app['finalState']=='result-ready' and app['delivery']['state']=='delivered';gates['endToEnd']=True
 reboot=load('reboot-result.json');assert all(reboot[k] for k in ('realBootIdChanged','allSevenServicesHealthy','containerIdentitiesPreserved','ownerTransactionAndSecretsPreserved','nativeTasksUnchanged','completedReceiptPreserved','noAutomaticBusinessReplay'))
 preservation=load('shared-preservation.json');assert preservation['unchanged'] and preservation['baselineWorkloadCount']>0;gates['sharedPreservation']=True
 tests=load('unit-tests.json');assert tests['exitCode']==0 and tests['passed']==24;gates['regressions']=True
 identity=load('runtime-identity.json');assert identity['releaseSha256']==install['releaseSha256'] and identity['operationsServicesActive'];gates['installedCandidateIdentity']=True
 assert hashlib.sha256((BASE/'candidate-release.json').read_bytes()).hexdigest()==install['releaseSha256']
 release=load('candidate-release.json');assert release['images']['unify-core']['id']==identity['coreImage'] and release['images']['uniui']['id']==identity['uiImage']
 files={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(BASE.iterdir()) if p.is_file() and p.name!='acceptance.json'}
 result={'schema':'stage5-acceptance/v1','cell':'dsh2-stage5-qa5','releaseSha256':install['releaseSha256'],'wholeStage5Accepted':all(gates.values()),'scope':'Stage 5 isolated-host acceptance, not general production or fleet certification','gates':gates,'evidenceSha256':files,'historicalFailuresRetained':True}
 (BASE/'acceptance.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps({'wholeStage5Accepted':result['wholeStage5Accepted'],'evidenceFiles':len(files),'gates':gates}))
if __name__=='__main__':main()

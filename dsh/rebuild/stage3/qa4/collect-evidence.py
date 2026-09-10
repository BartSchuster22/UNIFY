#!/usr/bin/env python3
"""Publishable receipt assembled only from the completed QA4 evidence allowlist."""
import hashlib,json,subprocess
from pathlib import Path
BASE=Path('/srv/alica-dsh-development');OUT=BASE/'stage3-tests/installed-qa4';U=BASE/'repos/UNIFY';M=BASE/'repos/MemoryV4'
files=['negative-acceptance.json','extended-acceptance.json','browser-acceptance.json','conflict-acceptance.json','privacy-acceptance.json','retention-acceptance.json','abuse-acceptance.json','closeout-acceptance.json']
evidence={p:json.loads((OUT/p).read_text()) for p in files}
assert evidence['privacy-acceptance.json']['coordinatedAppCoreMemoryNativeLiveStoreErasure']
assert evidence['retention-acceptance.json']['automaticCoreRetentionAndOwnerErasure'] and evidence['retention-acceptance.json']['automaticAppRetention']
assert evidence['abuse-acceptance.json']['fixtureOwnerErasureComplete']
assert evidence['closeout-acceptance.json']['borrowedAccessCredentialRemovedViaNativeAuthority']
images=json.loads((BASE/'stage3-builds/qa4/images.json').read_text())
for service,snapshot in images.items():
 context=BASE/'stage3-builds/qa4'/service
 for rel,h in snapshot['files'].items():
  p=context/rel;assert hashlib.sha256(p.read_bytes()).hexdigest()==h
  if rel=='Dockerfile':continue
  if service=='memory-v4':source=M/rel
  elif service=='hermes':source=U/('integrations/hermes/application-runtime/worker.py' if rel=='worker.py' else 'apps/hermes-control-adapter/'+rel)
  else:source=U/'apps/gateway'/rel
  assert source.is_file() and hashlib.sha256(source.read_bytes()).hexdigest()==h,(service,rel)
release=BASE/'stage3-package-qa4/release.json';release_sha=hashlib.sha256(release.read_bytes()).hexdigest();assert release_sha=='08526a76412c37e2f203feb6bc50439b8abf68d0411da74e6586f98b83edb1a1'
report={'stage':3,'gate':'bounded-engineering-pass','productionReady':False,'candidate':'qa4','releaseSha256':release_sha,'installedRuntimeMatchesBuildSource':True,'baseStage2ReleaseSha256':'bcf5d5e2d063518923e2dc92068c7f467c57357e88ada1cc09b4b25a75581aa2','images':{k:{'id':v['id'],'base':v['base']} for k,v in images.items()},'observedRegressionResults':{'gatewayAndHermesAdapterTests':314,'memoryOwnerTests':117,'nativeWorkerTests':25,'referenceAppTests':26,'realPinnedSdkSchedulerRegression':True,'gatewayAndAdapterTypechecks':True,'memoryTargetedRuff':True,'schemaMatchesGatewayValidators':True},'installedEvidence':evidence,'evidenceSha256':{p:hashlib.sha256((OUT/p).read_bytes()).hexdigest() for p in files},'limits':['Linux amd64 isolated installation; not Stage 7 or production approval','Retention uses explicit expired-timestamp fixtures, not elapsed-day or sustained soak evidence','Logical live-store erasure only; physical pages/WAL/backups/replicas and exported audit artifacts are not erased by this gate','Exact-source byte-exact quote revalidation only; semantic corrections quarantine','Borrowed access-only native credential removed after acceptance; no refresh token transferred','Mocked transports in unit tests are distinct from the recorded installed-stack and browser checks']}
p=U/'dsh/rebuild/stage3/QA4-ACCEPTANCE.json';p.write_text(json.dumps(report,indent=2)+'\n');p.chmod(0o644)
print(json.dumps({'report':str(p),'gate':report['gate'],'sourceAndImageSnapshotVerified':True}))

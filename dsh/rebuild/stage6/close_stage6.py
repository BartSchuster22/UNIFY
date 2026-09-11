"""Fail-closed evidence aggregation for the declared Stage6 QA scope, not production."""
import datetime,hashlib,json,re,subprocess,sys,time
from pathlib import Path
import release_trust as t
import restore_dsh2 as r
H=Path(__file__).parent;E=H/'evidence';Q=E/'qualification'
def load(p):return json.loads(p.read_text())
def passed(p):v=load(p);assert v['passed'] is True,str(p);return v
def main():
 backup=passed(E/'offhost-final-recheck.json');assert set(backup['hosts'])=={'ElioHermes1','ALICA-v1'}
 for v in backup['hosts'].values():assert v['authenticationVerified'] and v['contentsVerified'] and v['entriesVerified']==9513 and v['manifestSha256']==r.MANIFEST
 provider=load(E/'provider-fresh-os.json');assert provider['phase']=='fresh-os-ready' and provider['emptyDockerVerified'] and provider['oldInstallationAbsent'] and provider['pinnedSshVerified'];assert provider['before']['bootId']!=provider['after']['bootId']
 restored=load(Q/'restore-journal.json');assert restored['entriesVerifiedAfterPromotion']==9513 and not restored['retiredCellsActivated'] and restored['bootId']==provider['after']['bootId']
 first=passed(E/'live-restore/first-success.json');live=passed(Q/'live-restore-check.json');assert live['logicalDatabasesUnchangedByReplay']==7 and live['activeNativeWork']==0
 assert load(E/'live-restore/logical-before.json')==load(E/'live-restore/logical-after.json')
 delivery=passed(Q/'delivery-replay.json');assert delivery['originalDeliveryBytesHashVerified'] and delivery['duplicateAcknowledged'] and delivery['allSevenLogicalDatabasesUnchanged']
 material=passed(E/'provenance-qualification.json');passed(Q/'provenance-live-verification.json')
 t.verify(load(E/'materials-envelope.json'),load(E/'qa-release-public-trust.json'),E/'materials-attestation',r.RELEASE,0,'qa')
 faults=passed(Q/'update-qualification--acceptance.json');assert {v['fault'] for v in faults['cases']}=={'health','interrupt','schema'}
 for v in faults['cases']:assert v['phase']=='rolled-back' and v['coldPathsVerified']==8 and v['coldDataRestoredByteForByte'] and v['logicalAndSchemaPreserved']
 assert load(E/'normal-update.json')['phase']=='committed';passed(Q/'final-recovery-check.json');state=load(Q/'update-control--state.json');assert state['sequence']==5 and state['highestAttempt']==6
 migration=passed(Q/'migration-qualification.json');assert len(migration['denials'])==10
 ui=passed(Q/'ui-result.json');assert not ui['tlsBypass'] and not ui['mockedResponses'] and ui['actualObserverOutageShownUnknown'] and ui['liveObservationRestored']
 tests=subprocess.run([sys.executable,'-m','unittest','discover','-s',str(H),'-p','test_*.py'],capture_output=True,text=True);assert tests.returncode==0,tests.stderr
 (E/'unit-tests.txt').write_text(tests.stdout+tests.stderr);match=re.search(r'Ran (\d+) tests',tests.stderr);assert match;count=int(match.group(1))
 seconds=round(first['checkedAt']-provider['startedAt'],3);assert seconds>0
 report={'schema':'alica-stage6-acceptance/v1','reviewedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'wholeStage6Accepted':True,'productionAccepted':False,'scope':'Exact Stage5 QA5 -> canonical host-operations identity/v2 on DSH2; frozen runtime images and in-place preserve-only mapping','baseReleaseSha256':r.RELEASE,'operationsReleaseSha256':state['releaseSha256'],'installedSequence':state['sequence'],'highestAttempt':state['highestAttempt'],'gates':{k:True for k in ('6.1-backup-policy','6.2-fresh-os-restore','6.3-state-and-deduplicated-delivery','6.4-signing-observed-provenance-sbom-compatibility','6.5-update-and-cold-recovery','6.6-declared-predecessor-migration','6.7-cli-ui-runbooks')},'unitTests':count,'imagesWithSignedSboms':material['images'],'offhostEntriesVerifiedPerHost':9513,'updateFaultCases':len(faults['cases']),'additionalFinalRecoveryPassed':True,'migrationDenials':len(migration['denials']),'rpo':'Zero lost writes relative to the quiesced checkpoint, not arbitrary subsequent writes','observedHumanAssistedRtoSeconds':seconds,'observedHumanAssistedRtoMinutes':round(seconds/60,3),'rtoScope':'Provider submission to first live acceptance, including operator correction; not an independently established SLA','limitations':['QA signing only; no production cutover','One exact predecessor and host-operations-only updates; runtime/database upgrades and foreign merges denied','Process interruption and cold code+data recovery qualified; arbitrary power-cut local-update recovery not claimed','Observed materials provenance, not original builder attestations, reproducible builds, SLSA or licence/vulnerability clearance','Temporary project-wide provider token revocation requires operator Console action','Independent clean product acceptance remains Stage7'],'runbookSha256':t.digest(H/'RUNBOOK.md')}
 report['evidenceSha256']={str(p.relative_to(E)):t.digest(p) for p in sorted(E.rglob('*')) if p.is_file() and p.name!='stage6-acceptance.json' and not (p.parent==Q and p.name.endswith('.spdx.json'))}
 (E/'stage6-acceptance.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps({k:v for k,v in report.items() if k!='evidenceSha256'}))
if __name__=='__main__':main()

"""Fail-closed verdict builder: only the fresh-OS QA4 execution can qualify."""
import argparse,datetime,hashlib,json,subprocess
from pathlib import Path
S=Path(__file__).parent;REPO=S.parents[2];E=S/'evidence/candidates/72297c3';F=E/'fresh-os-live'
RELEASE='1486b3aa2dccb7a21941140508280b5125d816452e708e13c7640ea120a2e66c';ARCHIVE='26f98d6ffc8ecc576628b061a9851b8cd40e1e917f070a8567b9fb48ee969553'
def load(p):return json.loads(p.read_text())
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def main(check_only=False):
 progress=load(F/'progress.json');fresh=load(F/'fresh-os.json');export=load(F/'exported-evidence.json');r=export['reports']
 assert progress['releaseSha256']==RELEASE and progress['qa4RecurrenceExecuted'] and progress['runtimeRecoveryPrivacyGatesExecuted']
 required=['clean_install','oidc','native_provider','reference_image','setup_reference','first_request','operations_api','isolation','multi_fact_reuse','application_lifecycle','admission_negatives','recurring_soak','credential_lifecycle','host_operations','extended_host','business_faults','hostile_boundary','owner_recovery','owner_recovery_oidc','pre_reboot','real_reboot','cold_backup','cold_restore','signed_base_admission','signed_update_suite','privacy']
 last={v['name']:v for v in progress['stages']};assert all(last[n]['exitCode']==0 for n in required)
 def yes(name,*keys):assert all(r[name].get(k) is True for k in keys),(name,keys)
 assert fresh['phase']=='fresh-os-ready' and fresh['previousQa4StateAbsent'] and fresh['emptyDockerVerified'] and fresh['pinnedSshVerified'] and fresh['actionId']
 assert fresh['before']['bootId']!=fresh['after']['bootId']==r['clean-install']['bootId']
 yes('clean-install','passed','downloadedOnTarget','cleanDockerBefore','noStateRestored','operationsEnrolled','operationsHealthy')
 c=r['clean-install'];assert c['candidateSha256']==ARCHIVE and c['releaseSha256']==RELEASE and c['admission']['signatureVerified'] and c['admission']['artifactsVerified']==17
 assert len(c['containers'])==7 and all(x['running'] and x['health']=='healthy' and not x['oomKilled'] and x['memoryLimit']>0 and x['nanoCpus']>0 and x['pidsLimit']>0 for x in c['containers'])
 yes('first-acceptance','independentCustomerLogin','anonymousAndMissingCsrfDenied','appIdempotency','customerIsolation','realEndToEndResult')
 yes('oidc-result','former_owner_password_denied_after_recovery','mandatory_password_change','real_core_identity_session','native_inventory_through_identity_session')
 yes('browser-result','ownerOidcLogin','ownerDashboardReady','customerLogin','realModelResultVisible','separateStrictTlsProbesPassed','productionRoutesUnchanged')
 yes('credential-lifecycle','passed','realElapsedCredentialExpiry','revocationEffectiveWithoutRevokingActiveCredential','createdCredentialsRevoked');assert r['credential-lifecycle']['elapsedSeconds']>=55
 yes('negative-acceptance','crossCustomerAccessDenied','projectFrameworkProviderToolCallbackAndSubjectOverridesDenied','concurrentDurableReplayAndChangedPayloadDenied','installedRuntimeIsolationGuards')
 yes('isolation','passed');yes('operations-api','passed','anonymousDenied','mutationRouteAbsent','installationSecretsNotDisclosed')
 yes('application-lifecycle','realCallbackReplayAndTamperProtection','canonicalKnowledgeReuse','freshRetrievalAndCanonicalSupersession','conservativeExactQuoteCorrectionSupersession','customerAndCoreExport')
 yes('multi-fact-reuse','passed','customerResultReady','originalProvenanceAndRecordIdentitiesPreserved','applicationReplaySameRequest','nativeOutcomesUnchanged')
 m=r['multi-fact-reuse'];assert m['canonicalFacts']==m['nativeEvidenceEntries']==4 and m['uncompactedPlanSourceBytesLowerBound']>m['existingPlanLimitBytes']==65536 and m['syntheticNativeOutcomes'] is False
 yes('qualified-recurring-soak','passed','nativeRestartPreservedCheckpoint','realModelInference','allResultsCertainAndGoverned')
 n=r['qualified-recurring-soak'];assert 1800<=n['elapsedSeconds']<=7200 and n['successfulRecurringResults']==n['uniqueAppRequests']==n['uniqueCoreReceipts']==8 and n['clockOrOutcomeEdits'] is False and n['providerCostIsMeasured'] is False
 assert all(n['nativeAuthority'][k] is True for k in ['nativeTaskDone','nativeCronPaused','nativeCapabilityRemoved'])
 for name,count in [('host-operations',6),('extended-host',4),('business-faults',2)]:
  yes(name,'complete');assert len(r[name]['cases'])==count and all(x['passed'] for x in r[name]['cases'])
 yes('hostile-boundary','passed','actualAttackTextInNativeSession','actualReadableSyntheticCanaryNotDisclosed','positiveControlResultReady','noNativeOutcomeEdits');assert r['hostile-boundary']['nativeSessionToolCalls']==0
 yes('reboot-result','passed','realBootIdChanged','allSevenServicesHealthy','containerIdentitiesPreserved','ownerTransactionAndSecretsPreserved','nativeTasksUnchanged','noAutomaticBusinessReplay')
 yes('restore-result','passed','allStagedAndRestoredBytesAndMetadataVerified','sevenContainersRecreated','nativeTasksAndSessionLinksPreserved','sevenServicesHealthy','existingCompletedReceiptReadable','nativeWorkObservedIdle')
 yes('extraction-receipt','authenticationVerified','contentsVerified','extracted');yes('cold-verified','byteAndMetadataVerification')
 for file in ['cold-offhost-verification.json','cold-second-offhost-verification.json']:
  v=load(F/file);assert v['authenticationVerified'] and v['contentsVerified'] and v['manifestSha256']==r['backup-receipt']['manifestSha256'] and v['entriesVerified']==r['backup-receipt']['entries']
 u=r['update-suite'];assert u['complete'] and len(u['cases'])==6 and u['cases'][-1]['sequence']==5 and u['cases'][-1]['newOperationsCodeExecuted']
 assert [x['name'] for x in u['cases']]==['undeclared-payload-denied-before-mutation','real-failed-health-rollback','consumed-attempt-replay-denied','real-schema-fault-rollback','interrupted-transaction-explicit-recovery','signed-successor-committed']
 assert all(u['cases'][i]['realColdRollback'] and u['cases'][i]['schemaAndLogicalStatePreserved'] for i in [1,3,4])
 assert r['update-control-state']['sequence']==r['update-control-state']['highestAttempt']==5
 p=r['privacy-acceptance'];assert len(p)>=9 and all(v is True for v in p.values())
 yes('final-health','passed','ownershipVerified');assert set(r['final-health']['services'].values())=={'healthy'} and r['final-health']['maintenance'] is False and r['final-health']['nativeWork']['active']==0
 unit=load(F/'gateway-unit-tests.json');assert unit['testsPassed']==238 and unit['testFilesPassed']==29 and unit['gatewaySourceRevision']=='72297c3'
 # Every failed attempt remains a failure; only a matching FRESH gate disposes it.
 aliases={'qualified_recurring_soak':'recurring_soak','hostile_question':'hostile_boundary','update_suite':'signed_update_suite','privacy_after_cancellation':'privacy','verify_multifact_existing':'multi_fact_reuse'}
 failures=[]
 for candidate in ['2772d9c','72297c3']:
  hist=S/'evidence/candidates'/candidate/'live';h=load(hist/'progress.json')
  for row in h['stages']:
   if row['exitCode']==0:continue
   gate=aliases.get(row['name'],row['name']);assert gate in last and last[gate]['exitCode']==0
   failures.append({'candidate':candidate,**row,'disposition':'Retained unsuccessful attempt; excluded from acceptance. Matching gate independently passed on fresh OS.','freshGate':gate})
 for row in progress['stages']:
  if row['exitCode']!=0:
   assert last[row['name']]['exitCode']==0
   failures.append({'candidate':'72297c3-fresh-os',**row,'disposition':'Retained failed attempt; later successful attempt does not erase it.'})
 exclusions=['production approval','Stages 7.4–7.6','licensing/SBOM closure','general OS/runtime-image/schema updates','physical backup erasure','elapsed day/week retention','day/week soak','measured provider cost','smaller-host minimums or unmeasured capacity','other framework adapters']
 inputs={str(x.relative_to(S)):sha(x) for x in [F/'gateway-unit-tests.json',F/'qa-enrollment.json',F/'progress.json',F/'fresh-os.json',F/'exported-evidence.json',F/'qa-tool-archive.json',F/'cold-offhost-verification.json',F/'cold-second-offhost-verification.json',E/'live/post-privacy-safeguard.json',E/'live/exported-evidence.json']}
 private={str(x.relative_to(S)):sha(x) for root in [S/'evidence/candidates/2772d9c/live',E/'live',F] for x in root.glob('*private.log')}
 verdict={'schema':'stage7-independent-qualification/v1','verdict':'PASS','scope':['7.1','7.2','7.3'],'run':'qa4-fresh-os','candidate':'72297c3','candidateArchiveSha256':ARCHIVE,'releaseSha256':RELEASE,'productionAccepted':False,'predecessorPassInherited':False,'freshProviderActionId':fresh['actionId'],'requiredStages':required,'retainedFailedAttempts':len(failures),'exclusions':exclusions,'evidenceSha256':sha(F/'exported-evidence.json'),'createdAt':datetime.datetime.now(datetime.timezone.utc).isoformat()}
 doc=f'''# Stage 7.1–7.3 — independently qualified QA4

**PASS for the predeclared QA scope only. No production approval.**

Candidate `72297c3`, archive SHA-256 `{ARCHIVE}`; release manifest `{RELEASE}`.
Provider action `{fresh['actionId']}` rebuilt DSH2 before installation. The previous QA4 state was absent, Docker was empty, and the clean installation boot ID matches the fresh-OS receipt. No database, checkpoint or prior PASS was imported into that clean installation.

## Measured results

| Gate | Result |
|---|---|
| Anonymous published-archive download, strict signature and inventory, clean install | PASS |
| Owner OIDC/recovery, Chromium owner/customer UI, strict hostname TLS probes | PASS |
| Credential expiry/revocation, CSRF/transport and project/customer isolation | PASS |
| Real research, reuse, refresh, correction and export | PASS |
| Four-fact reuse regression | PASS: {m['uncompactedPlanSourceBytesLowerBound']} source bytes exceed the unchanged 65,536-byte plan limit; all four canonical IDs and complete provenance preserved |
| Real native recurrence | PASS: eight unique governed results over {n['elapsedSeconds']} seconds, native restart/checkpoint continuity, terminal Cron/capability cleanup |
| Host/process/daemon/storage/broker and callback/provider faults | PASS; no duplicate business effect or blind uncertain-action replay |
| Hostile input boundary | PASS for this real attempt and positive control; not universal prompt-injection resistance |
| Real reboot and authenticated cold restore | PASS; reboot preserved identities; cold restore recreated seven containers, preserved native task/session links and was independently verified on both backup hosts |
| Signed operations-only v2-to-v2 update | PASS: undeclared payload denial, health/schema rollback, interrupted recovery, replay denial, committed sequence 5 |
| Coordinated live-store privacy deletion | PASS; native cancellation, customer erasure and other-customer preservation; performed after recovery tests |

The host reported {c['cpuCount']} CPUs and {c['memoryTotalBytes']/1024**3:.2f} GiB RAM. Installation took {c['seconds']} seconds; measured peak host non-available memory during installation was {c['peakHostNonAvailableBytes']/1024**3:.2f} GiB. Container limits and OOM observations are in the evidence. These measurements do not establish a smaller-host minimum or general concurrency ceiling. Provider cost was not measured.

The unchanged gateway source also passed typechecking and 238 unit tests across 29 test files. Those labelled-mock unit tests are supplementary regression evidence, not substitutes for the live qualification.

## Failure and contradiction disposition

{len(failures)} failed attempts remain in `failure-ledger.json`; their private log hashes are retained. QA1/QA2 and all QA3/cleaned-host QA4 results are excluded from this verdict. The cleaned-host QA4 run is diagnostic evidence, not fresh-OS acceptance. Its post-privacy state, including operations high-water counters, was encrypted and independently verified on both backup hosts before the provider rebuild.

Earlier packaging trials remain rejected: `4273c86` failed PostgreSQL secret readability; `ed2f09b` reached seven healthy containers but failed observer import. The historical preparation README preserves those disclosures. Neither container-only health nor publication is acceptance.

QA3 exposed the oversized knowledge-finalization plan. The Core correction interns duplicated excerpts in the persisted plan without increasing the limit or replacing native outcomes. The earlier QA4 ordering, response-envelope and empty-customer assumptions were harness errors; their failures remain recorded. The final result uses newly executed gates on the fresh OS, not those earlier PASS flags. Subreports saying `wholeStage7Accepted=false` were truthful at their individual checkpoints; only this final reconciliation grants the scoped verdict.

## Explicit exclusions

'''+''.join('- '+x+'\n' for x in exclusions)+'''
QA signatures are not production trust. The browser uses a QA self-signed exception, separately checked by strict CA/hostname TLS probes. Storage pressure was an isolated real tmpfs probe, not a filled data filesystem. Starting the external `restart=no` reference fixture is not claimed as recovery of a DSH-owned service. Backup archives may retain synthetic deleted-customer data under operator-managed retention; physical backup erasure was not tested.

Private credentials, keys, cookies, screenshots and raw customer/native logs are not publication artifacts. Public evidence contains bounded assertions, identifiers, hashes and synthetic QA metadata. The immutable candidate was not replaced during qualification.
'''
 if check_only:return verdict
 for name,value in [('final-verdict.json',verdict),('failure-ledger.json',failures),('input-hashes.json',{'publicInputs':inputs,'privateLogHashes':private})]:(F/name).write_text(json.dumps(value,indent=2)+'\n')
 (S/'FINAL-QA4.md').write_text(doc)
 return verdict
if __name__=='__main__':
 a=argparse.ArgumentParser();a.add_argument('--check-only',action='store_true');args=a.parse_args();print(json.dumps(main(args.check_only),indent=2))

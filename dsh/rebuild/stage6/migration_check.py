"""Read-only exact-predecessor inventory/mapping gate for QA5; no import/merge."""
import copy,json,os,sys
from pathlib import Path
import migration_contract as contract
import restore_dsh2 as r
import logical_state

def inventory():
 assert r.archive.digest(r.OUT/'restored-manifest.json')==r.MANIFEST
 m=json.loads((r.OUT/'restored-manifest.json').read_text());rows={x['name']:x for x in m['entries']};root=Path('/opt')/r.CELL;out=Path('/var/lib/alica-stage5-qa5')
 owner=r.archive.digest(root/'owner.json');assert owner==rows['root-'+r.CELL+'/owner.json']['sha256'],'Foreign installation owner'
 assert r.archive.digest(out/'registration.json')==rows['qa-'+r.CELL+'/registration.json']['sha256'],'Application identity collision'
 app=json.loads((out/'registration.json').read_text())['applicationId']
 script="from cron import jobs;from hermes_cli import kanban_db;import json;c=kanban_db.connect();print(json.dumps({'tasks':[dict(r) for r in c.execute('SELECT id,session_id,status FROM tasks ORDER BY id')],'jobs':jobs.list_jobs(include_disabled=True)}))"
 native=json.loads(r.run(['docker','exec',r.CELL+'-hermes-1','/opt/hermes/.venv/bin/python','-c',script]));assert native==m['metadata']['nativeBefore'],'Native identity/schedule divergence'
 assert all(t['status'] in ('done','cancelled','failed','archived') for t in native['tasks']) and all(not j['enabled'] for j in native['jobs'])
 source={'identities':['installation:'+owner,'application:'+app]+['task:'+str(t['id'])+'/session:'+str(t['session_id']) for t in native['tasks']],'channels':['application-delivery:'+app],'schedules':['native:'+j['id'] for j in native['jobs']]}
 mapping={k:[[x,x] for x in v] for k,v in source.items()};occupied={k:{x:x for x in v} for k,v in source.items()}
 return source,mapping,occupied

def preflight():
 source,mapping,occupied=inventory();return contract.plan(r.RELEASE,source,mapping,occupied,quiescent=True,backup_verified=True)

def qualify():
 before=logical_state.snapshot();source,mapping,occupied=inventory();positive=preflight();denials=[]
 def deny(name,**kw):
  args={'predecessor':r.RELEASE,'source':source,'mapping':mapping,'occupied':occupied,'quiescent':True,'backup_verified':True,**kw}
  try:contract.plan(**args)
  except ValueError:denials.append(name);return
  raise AssertionError('Unexpected migration admission: '+name)
 for kind in contract.KINDS:
  foreign=copy.deepcopy(occupied);foreign[kind][source[kind][0]]='foreign-fixture-owner';deny(kind+'-foreign-occupant',occupied=foreign)
  duplicate=copy.deepcopy(source);duplicate[kind].append(duplicate[kind][0]);deny(kind+'-source-collision',source=duplicate)
 deny('unsupported-predecessor',predecessor='unsupported');deny('live-work',quiescent=False);deny('unverified-backup',backup_verified=False)
 rename=copy.deepcopy(mapping);rename['channels'][0][1]='foreign-channel';deny('channel-rebinding',mapping=rename)
 assert logical_state.snapshot()==before
 cfg=json.loads((Path('/opt')/r.CELL/'operations/broker.json').read_text());assert cfg['signatureSchema']=='alica-runtime-identity/v2'
 old=r.OUT/'update-control/tx-3d832829da5b446994334af45f047075/operations/broker.json';assert json.loads(old.read_text()).get('signatureSchema') is None
 faults=json.loads((r.OUT/'update-qualification/acceptance.json').read_text());assert faults['passed'] and all(c['coldDataRestoredByteForByte'] for c in faults['cases'])
 report={'schema':'stage6-declared-migration-qualification/v1','selectedPredecessor':'Stage5 QA5 '+r.RELEASE,'sourceSignatureSchema':'legacy-v1','targetSignatureSchema':cfg['signatureSchema'],'plan':positive,'denials':denials,'denialTestsUseReadOnlyDerivedInventories':True,'durableStateUnchangedByQualification':True,'successfulMigrationTransaction':'tx-3d832829da5b446994334af45f047075','rollbackEvidence':'update-qualification/acceptance.json','supportedScope':'in-place host-operations ownership migration only; no cross-installation merges or runtime database schema upgrade','passed':True,'wholeStage6Accepted':False};r.save(r.OUT/'migration-qualification.json',report);print(json.dumps(report))
if __name__=='__main__':qualify()

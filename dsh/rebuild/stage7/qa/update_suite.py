"""Exercise signed update admission and real transactional faults, QA3 only."""
import json,os,shutil,subprocess,sys
from pathlib import Path
import update_ops as u
from qa_common import OUT
BASE=Path('/srv/alica-stage7-operations-update-qa3');SCRIPT=Path(__file__).with_name('update_ops.py');checks=[]
def call(sequence=None,fault='none',bundle=None,recover=False):
 args=[sys.executable,'-B',str(SCRIPT),'recover'] if recover else [sys.executable,'-B',str(SCRIPT),'apply','--bundle',str(bundle or BASE/'bundle'),'--envelope',str(BASE/('envelope-'+str(sequence)+'.json')),'--fault',fault]
 p=subprocess.run(args,capture_output=True,text=True,timeout=1000)
 label='recover' if recover else str(sequence)+'-'+fault+('-negative' if bundle else '')
 log=OUT/('update-'+label+'.private.log');fd=os.open(log,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
 with os.fdopen(fd,'w') as f:f.write(p.stdout+'\n'+p.stderr)
 return p.returncode
def state():return u.trust.load(u.STATE)
def note(name,details):
 checks.append({'name':name,**details});(OUT/'update-suite.json').write_text(json.dumps({'schema':'stage7-signed-operations-update-suite/v1','cases':checks,'complete':False},indent=2))
def rollback_ok(sequence):
 j=u.trust.load(u.JOURNAL);s=state();assert j['phase']=='rolled-back' and j['coldDataRestoredByteForByte'] and s['releaseSha256']==u.r.RELEASE and s['highestAttempt']==sequence
 assert u.schema()==j['logicalBefore'];u.native_quiescent()
 import host_operations as h
 status=h.until(h.healthy);assert status['snapshot']['ownershipVerified']
 return {'realColdRollback':True,'schemaAndLogicalStatePreserved':True,'highestAttempt':sequence}
assert state()['sequence']==1 and state()['highestAttempt']==1;baseline=state()
negative=BASE/'extra-file-negative';shutil.copytree(BASE/'bundle',negative);(negative/'unexpected.py').write_text('raise RuntimeError("must never execute")\n')
assert call(2,bundle=negative)!=0 and state()==baseline;note('undeclared-payload-denied-before-mutation',{'unchangedControlState':True})
assert call(2,'health')!=0;note('real-failed-health-rollback',rollback_ok(2))
before=state();assert call(2)!=0 and state()==before;note('consumed-attempt-replay-denied',{'highestAttemptPreserved':2})
assert call(3,'schema')!=0;note('real-schema-fault-rollback',rollback_ok(3))
assert call(4,'interrupt')==97
assert u.trust.load(u.JOURNAL)['phase']=='code-activated';assert call(recover=True)==0;note('interrupted-transaction-explicit-recovery',rollback_ok(4))
assert call(5)==0;j=u.trust.load(u.JOURNAL);s=state();assert j['phase']=='committed' and s['sequence']==5 and s['highestAttempt']==5
assert u.schema()==j['logicalBefore'];u.native_quiescent()
code='from doghouse_dsh.identity import qualified_update_identity;print(qualified_update_identity())'
p=subprocess.run([sys.executable,'-B','-c',code],env={**os.environ,'PYTHONPATH':str(u.CODE)},capture_output=True,text=True,check=True);assert p.stdout.strip()=='stage7-qa3-operations-update/v1'
note('signed-successor-committed',{'newOperationsCodeExecuted':True,'schemaAndLogicalStatePreserved':True,'releaseSha256':s['releaseSha256'],'sequence':5})
result={'schema':'stage7-signed-operations-update-suite/v1','cases':checks,'complete':True,'scope':'operations-only v2 identity; runtime images and application schemas unchanged','productionAccepted':False}
(OUT/'update-suite.json').write_text(json.dumps(result,indent=2));print(json.dumps(result))

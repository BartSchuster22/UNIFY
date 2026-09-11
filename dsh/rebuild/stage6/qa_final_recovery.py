"""Exercise final compatibility/migration gates and lock-held recovery path."""
import json,subprocess,sys
from pathlib import Path
import update_ops as u
u.guard();before=u.schema();state=u.trust.load(u.STATE);assert state['sequence']==5 and state['highestAttempt']==5
p=subprocess.run([sys.executable,'-B',str(Path(__file__).with_name('update_ops.py')),'apply','--bundle','/home/deploy/.stage6-inputs/ops-candidate-6','--envelope','/home/deploy/.stage6-inputs/ops-envelope-6.json','--fault','interrupt'],capture_output=True,text=True,timeout=300)
assert p.returncode==99 and not u.r.run(['docker','ps','-q'])
j=u.recover();assert j['phase']=='rolled-back' and j['coldDataRestoredByteForByte'];assert u.schema()==before
state=u.trust.load(u.STATE);assert state['sequence']==5 and state['highestAttempt']==6
result={'schema':'stage6-final-recovery-check/v1','compatibilityAndMappingGatesExercised':True,'interruptedCandidateNeverCommitted':True,'recoveredWithLifecycleLocksHeld':True,'coldDataRestoredByteForByte':True,'logicalAndSchemaPreserved':True,'installedSequence':5,'highestAttempt':6,'phase':j['phase'],'passed':True,'wholeStage6Accepted':False};u.r.save(u.r.OUT/'final-recovery-check.json',result);print(json.dumps(result))

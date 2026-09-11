"""Real QA5-only failure/recovery qualification; no simulated API responses."""
import json,subprocess,sys,time
from pathlib import Path
import update_ops as u
u.guard();out=u.r.OUT/'update-qualification';out.mkdir(mode=0o700,exist_ok=True)
assert not (out/'acceptance.json').exists(),'Existing qualification: inspect before replay'
baseline=u.schema();results=[]
for sequence,fault,expected in [(2,'health',1),(3,'interrupt',99),(4,'schema',1)]:
 args=[sys.executable,'-B',str(Path(__file__).with_name('update_ops.py')),'apply','--bundle','/home/deploy/.stage6-inputs/ops-candidate-'+str(sequence),'--envelope','/home/deploy/.stage6-inputs/ops-envelope-'+str(sequence)+'.json','--fault',fault]
 started=time.monotonic();p=subprocess.run(args,text=True,capture_output=True,timeout=600)
 (out/(fault+'.log')).write_text(p.stdout+p.stderr)
 assert p.returncode==expected,'Unexpected exit for '+fault
 j=u.trust.load(u.JOURNAL)
 if fault=='interrupt':
  assert j['phase']=='candidate-installed' and not u.r.run(['docker','ps','-q'])
  assert u.trust.load(u.STATE)['sequence']==1,'Interrupted candidate committed'
  u.recover();j=u.trust.load(u.JOURNAL)
 assert j['phase']=='rolled-back' and j['coldDataRestoredByteForByte']
 assert u.schema()==baseline,'Durable schema/data changed after '+fault
 state=u.trust.load(u.STATE);assert state['sequence']==1 and state['highestAttempt']==sequence
 if fault=='health':assert j['healthFaultContainerStopped']
 if fault=='schema':assert j['schemaFaultAppliedToExistingDatabase']
 u.r.save(out/(fault+'-journal.json'),j)
 row={'fault':fault,'exitCode':p.returncode,'phase':j['phase'],'coldPathsVerified':len(j['coldHashes']),'coldDataRestoredByteForByte':True,'logicalAndSchemaPreserved':True,'installedSequence':state['sequence'],'highestAttempt':state['highestAttempt'],'seconds':round(time.monotonic()-started,3)}
 results.append(row);print(json.dumps(row),flush=True)
report={'schema':'stage6-update-fault-qualification/v1','cases':results,'passed':True,'scope':'QA5 host-operations update; unchanged runtime images','wholeStage6Accepted':False};u.r.save(out/'acceptance.json',report);print(json.dumps(report))

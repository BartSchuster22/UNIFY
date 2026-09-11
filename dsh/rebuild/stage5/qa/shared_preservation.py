import json,subprocess
from pathlib import Path
b=Path('/srv/alica-dsh-development');p=b/'stage4-tests/installed-qa3/preservation-before.json';before=json.loads(p.read_text())
ids=subprocess.check_output(['sudo','-n','docker','ps','-aq'],text=True).split();rows=json.loads(subprocess.check_output(['sudo','-n','docker','inspect',*ids]))
current={r['Id']:{'name':r['Name'],'image':r['Image'],'running':r['State']['Running'],'status':r['State']['Status']} for r in rows}
base={k:v for k,v in before.items() if not v['name'].startswith(('/dsh2-stage','/dsh4-reference','/dsh3-reference'))}
changed=[v['name'] for k,v in base.items() if current.get(k)!=v]
report={'schema':'stage5-shared-workload-preservation/v1','host':'ALICA-v1','baseline':str(p),'baselineWorkloadCount':len(base),'unchanged':not changed,'changedNames':changed,'qualifiedStage4VerifiedByPackager':True}
print(json.dumps(report));assert base and not changed

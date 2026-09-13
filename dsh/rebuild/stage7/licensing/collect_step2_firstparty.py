"""Record existing first-party declarations without creating a new licence grant.
Package-manifest matches establish repository/package identity, NOT exact build
source correspondence. The historical ALICA Ltd entity wording needs legal review.
"""
import hashlib,json,subprocess
from pathlib import Path
BASE=Path(__file__).resolve().parent;REPO=BASE.parents[3];B=BASE/'clean-candidate-review';OUT=B/'steps12-firstparty';REV='e44d8fc86849471869f10a1cb0f849cfb7c23c7b'
def main():
    OUT.mkdir(exist_ok=True);(OUT/'objects').mkdir(exist_ok=True);context=json.loads((B/'steps12-context/report.json').read_bytes());rows=[]
    for path in ['LICENSE','packages/contracts/package.json','apps/hermes-control-adapter/package.json','apps/gateway/package.json']:
        raw=subprocess.check_output(['git','show',REV+':'+path],cwd=REPO);h=hashlib.sha256(raw).hexdigest();(OUT/'objects'/h).write_bytes(raw);matches=[]
        if path.endswith('package.json'):
            name=json.loads(raw)['name'];matches=[{'image':x['image'],'path':x['path'],'sha256':x['sha256']} for x in context['files'] if x['path'].endswith('package.json') and json.loads((B/'steps12-context/objects'/x['sha256']).read_bytes()).get('name')==name]
            if not matches or any(x['sha256']!=h for x in matches):raise ValueError('First-party package manifest differs: '+name)
        rows.append({'repository':'https://github.com/BartSchuster22/UNIFY','commit':REV,'path':path,'sha256':h,'matches':matches})
    (OUT/'report.json').write_text(json.dumps({'records':rows,'newLicenceGrant':False,'exactBuildSourceCorrespondenceAsserted':False,'legalHold':'Historical notice names ALICA Ltd. Record the declaration as evidence, not proof of entity existence or authorization. Correct/finalize licensor wording in the separate commercial/legal review.'},sort_keys=True,indent=2)+'\n');print(json.dumps({'sourceRecords':len(rows),'matchedOccurrences':sum(len(x['matches']) for x in rows),'newLicenceGrant':False}))
if __name__=='__main__':main()

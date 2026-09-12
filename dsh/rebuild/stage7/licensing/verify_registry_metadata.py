"""Offline replay of retained registry declarations; integrity, not legal acceptance."""
import hashlib,json,tarfile,sys
from pathlib import Path
from unittest.mock import patch
import collect_registry_metadata as c

def require(ok,msg):
 if not ok:raise ValueError(msg)
def verify(base):
 report=json.loads((base/'report.json').read_text());queue=json.loads((base/'review-queue.json').read_text())
 require(report['stage74Accepted'] is False and report['legalReviewComplete'] is False,'Not an approval verifier')
 archive=c.BASE/'current-qa4/review-evidence.tar.gz'
 require(hashlib.sha256(archive.read_bytes()).hexdigest()==report['inputArchiveSha256'],'Input hash changed')
 with tarfile.open(archive) as t:
  f=t.extractfile('verified-run1/review-queue.json')
  if f is None:raise ValueError('Missing queue')
  original=json.load(f)
 sources={s['url']:s for s in report['sources']}
 def replay(url):
  source=sources[url];h=source['sha256'];require(len(h)==64 and all(x in '0123456789abcdef' for x in h),'Bad digest')
  data=(base/'objects'/h).read_bytes();require(hashlib.sha256(data).hexdigest()==h and len(data)==source['bytes'],'Evidence hash mismatch');return data,source
 for url in sources:replay(url)
 records={r['purl']:r for r in report['results']};added=0;replayed=0
 with patch.object(c,'get',side_effect=replay):
  for result in report['results']:
   require(result['legalDispositionApproved'] is False and result['binaryIdentityProven'] is False,'Unfounded approval')
   if result['status']!='unresolved':require(c.collect(result['purl'])==result,'Declaration replay mismatch');replayed+=1
 require(len(queue)==len(original),'Queue size changed')
 for old,new in zip(original,queue):
  expected=dict(old);evidence=records.get(old['purl'])
  if old['reviewStatus']=='licence-metadata-unresolved' and evidence and evidence['status']=='upstream-declaration-observed':
   expected.update(registryEvidence=evidence,reviewStatus='upstream-declaration-observed-obligations-unreviewed');added+=1
  elif evidence:expected['registryLookup']=evidence
  require(new==expected,'Unexpected queue alteration')
 remaining=sum(r['reviewStatus']=='licence-metadata-unresolved' for r in queue)
 require(added==report['addedMetadataOccurrences'] and remaining==report['remainingMissingMetadata'],'Counts disagree')
 return {'sourcesRehashed':len(sources),'declarationsReplayed':replayed,'addedMetadataOccurrences':added,'remainingMissingMetadata':remaining,'stage74Accepted':False}
if __name__=='__main__':print(json.dumps(verify(Path(sys.argv[1])),indent=2))

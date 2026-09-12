"""Independently verify exported collection integrity. This never grants legal clearance."""
import argparse,hashlib,json,tarfile
from pathlib import Path
from collect_current import require,sha

def verify(base):
 export=json.loads((base/'export.json').read_text())
 expected={'review-evidence.tar.gz','rust-sources.tar.gz'}
 require(set(export['files'])==expected,'Unexpected export files')
 for name in expected:require(sha(base/name)==export['files'][name]['sha256'],'Export digest mismatch: '+name)
 require(sha(base/'summary.json')==export['summarySha256'],'Summary changed')
 summary=json.loads((base/'summary.json').read_text());require(summary['stage74Accepted'] is False and summary['legalReviewComplete'] is False,'This verifier cannot accept legal clearance')
 with tarfile.open(base/'review-evidence.tar.gz') as review,tarfile.open(base/'rust-sources.tar.gz') as sources:
  cached={};total=0
  for t in [review,sources]:
   names=set();cached[t]={}
   for m in t:
    require(m.isfile() and not Path(m.name).is_absolute() and '..' not in Path(m.name).parts and '.private.' not in m.name,'Unsafe/unexpected archive member')
    require(m.name not in names,'Duplicate archive member');names.add(m.name)
    total+=m.size;require(m.size<=40*1024*1024 and total<=256*1024*1024,'Archive exceeds verification bounds')
    f=t.extractfile(m)
    if f is None:raise RuntimeError('Unreadable evidence')
    cached[t][m.name]=f.read()
  def read(t,name):return cached[t][name]
  def digest(t,name,want):require(hashlib.sha256(read(t,name)).hexdigest()==want,'Internal digest mismatch: '+name)
  digest(review,'verified-run1/summary.json',export['summarySha256'])
  receipt=json.loads(read(review,'run1/receipt.json'));notices=json.loads(read(review,'notices-run3/notice-index.json'));rust=json.loads(read(review,'rust-upstream-run1/receipt.json'))
  require(receipt['completed'] and rust['completed'],'Incomplete evidence')
  require(receipt['releaseSha256']==notices['releaseSha256']==summary['releaseSha256'],'Release linkage changed')
  require(set(notices['imageLayers'])=={v['imageId'] for v in receipt['images'].values()},'Image coverage mismatch')
  for record in receipt['images'].values():digest(review,'run1/'+record['spdx'],record['spdxSha256'])
  for row in notices['candidates']:digest(review,'notices-run3/texts/'+row['sha256'],row['sha256'])
  for row in notices['resolvedReferences']:digest(review,'notices-run3/texts/'+row['sha256'],row['sha256'])
  for row in rust['results']:
   if not row['status'].startswith('verified'):continue
   digest(sources,'crates/'+row['crateSha256']+'.crate',row['crateSha256'])
   digest(sources,'crates/'+row['crateSha256']+'.registry.json',row['metadataSha256'])
   for text in row['noticeCandidates']:digest(review,'rust-upstream-run1/texts/'+text['sha256'],text['sha256'])
 return {'exportIntegrityVerified':True,'imageSBOMs':len(receipt['images']),'rustCoordinates':len(rust['results']),'stage74Accepted':False}
if __name__=='__main__':
 parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('directory',type=Path);args=parser.parse_args();print(json.dumps(verify(args.directory),indent=2))

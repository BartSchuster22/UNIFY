"""Read-only QA4 licensing discovery. Not legal approval or a distribution clearance."""
import argparse,hashlib,json,re,tarfile
from pathlib import Path
ROOT=Path(__file__).resolve().parents[4]
S=ROOT/'dsh/rebuild';OUT=Path(__file__).parent
ARCHIVE_SHA='26f98d6ffc8ecc576628b061a9851b8cd40e1e917f070a8567b9fb48ee969553'
RELEASE_SHA='1486b3aa2dccb7a21941140508280b5125d816452e708e13c7640ea120a2e66c'
EULA_SHA='3b172e3850816750ff7b5a7d6d4b9f311f5c745159e201f42fea647c4dad1f3c'
def sha(path):
 h=hashlib.sha256()
 with Path(path).open('rb') as f:
  for block in iter(lambda:f.read(1048576),b''):h.update(block)
 return h.hexdigest()
def sbom_status(image,record,path):
 if record is None:return 'missing'
 if record['imageId']!=image:return 'stale-image'
 if not path.is_file() or sha(path)!=record['sha256']:return 'invalid-digest'
 return 'matched-observation-not-legal-clearance'
def discovery(archive):
 assert sha(archive)==ARCHIVE_SHA,'Candidate differs from qualified QA4'
 hashes={};release=None;names=[]
 with tarfile.open(archive,'r|gz') as t:
  for m in t:
   assert m.isfile() and m.name.startswith('bundle/') and len(Path(m.name).parts)==2
   assert m.name not in hashes
   names.append(m.name);h=hashlib.sha256();buf=[]
   with t.extractfile(m) as f:
    for block in iter(lambda:f.read(1048576),b''):
     h.update(block)
     if m.name=='bundle/release.json':buf.append(block)
   hashes[m.name]=h.hexdigest()
   if buf:release=json.loads(b''.join(buf))
 assert hashes['bundle/release.json']==RELEASE_SHA
 assert all(hashes.get('bundle/'+n)==d for n,d in release['files'].items())
 assert sha(ROOT/'licenses/ALICA-COMMUNITY-DSH-EULA-1.0.md')==EULA_SHA
 clean=json.loads((S/'stage7/evidence/candidates/72297c3/fresh-os-live/exported-evidence.json').read_text())['reports']['clean-install']
 for c in clean['containers']:
  role=c['name'].removeprefix('/dsh2-stage7-qa4-').removesuffix('-1')
  assert release['images'][role]['id']==c['image']
 base=S/'stage6/evidence/materials-attestation';statement=json.loads((base/'statement.json').read_text())['predicate'];rows=[];packages=[]
 for role,image in release['images'].items():
  old=statement['sboms'].get(role);p=base/(old['file'] if old else 'absent');state=sbom_status(image['id'],old,p)
  row={'role':role,'qualifiedImageId':image['id'],'priorImageId':old['imageId'] if old else None,'status':state}
  if state=='matched-observation-not-legal-clearance':
   row['sbomSha256']=sha(p);row['source']=str(p.relative_to(ROOT));pkgs=json.loads(p.read_text())['packages'];row['packageOccurrences']=len(pkgs)
   for v in pkgs:
    declared=v.get('licenseDeclared','NOASSERTION');concluded=v.get('licenseConcluded','NOASSERTION')
    usable=[x for x in [declared,concluded] if x and x not in ['NONE','NOASSERTION','UNKNOWN']]
    packages.append({'role':role,'spdxId':v['SPDXID'],'name':v['name'],'version':v.get('versionInfo'),'declared':declared,'concluded':concluded,'missingUsableLicenseMetadata':not usable,'copyleftReviewSignal':bool(re.search(r'GPL|AGPL|LGPL|MPL|EPL|CDDL', ' '.join(usable),re.I))})
  rows.append(row)
 return {'schema':'stage7.4-licensing-discovery/v1','candidateArchiveSha256':ARCHIVE_SHA,'releaseSha256':RELEASE_SHA,'archiveAndManifestVerified':True,'existingEulaPreservedSha256':EULA_SHA,'bundleMembers':names,'topLevelLegalMembers':[n for n in names if re.search(r'license|licence|notice|copying|sbom|spdx',n,re.I)],'readableFirstPartyPythonMembers':[n for n in names if n.endswith('.py')],'imageObservations':rows,'packageOccurrences':len(packages),'missingUsableLicenseMetadataOccurrences':sum(p['missingUsableLicenseMetadata'] for p in packages),'copyleftReviewSignalOccurrences':sum(p['copyleftReviewSignal'] for p in packages),'packageLicenseMetadata':packages,'limitations':['No layer-level licence text/source-offer review performed','Reference application requires separate image binding; not inferred from runtime image list','Host-side installer and Doghouse code require separate coverage','Scanner metadata and copyleft signals are not legal conclusions','No new commercial policy, reviewer approval or enforcement approved'], 'stage74Accepted':False,'productionDistributionCleared':False}
def main():
 p=argparse.ArgumentParser();p.add_argument('--archive',required=True);p.add_argument('--check-ready',action='store_true');a=p.parse_args()
 r=discovery(Path(a.archive));OUT.mkdir(exist_ok=True);(OUT/'discovery.json').write_text(json.dumps(r,indent=2)+'\n')
 print(json.dumps({k:v for k,v in r.items() if k not in ['packageLicenseMetadata','bundleMembers']},indent=2))
 if a.check_ready:raise SystemExit(2) # Discovery-only audit cannot authorize legal/distribution release.
if __name__=='__main__':main()

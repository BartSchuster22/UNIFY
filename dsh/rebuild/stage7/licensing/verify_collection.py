"""Verify collected evidence and export a bounded review package, never licence clearance."""
import ast,collections,hashlib,json,re,tarfile
from pathlib import Path
from collect_current import B,RELEASE,require,sha,snapshot
BASE=Path('/var/lib/alica-stage74-licensing')
O=BASE/'verified-run1'
def main():
 scan=BASE/'run1';notices=BASE/'notices-run3';rust=BASE/'rust-upstream-run1'
 r=json.loads((scan/'receipt.json').read_text());n=json.loads((notices/'notice-index.json').read_text());u=json.loads((rust/'receipt.json').read_text())
 require(r.get('completed') and u.get('completed'),'Incomplete collections');require(r['releaseSha256']==n['releaseSha256']==RELEASE==sha(B/'release.json'),'Release mismatch')
 require(u['scanReceiptSha256']==sha(scan/'receipt.json'),'Upstream evidence not bound to scan')
 release=json.loads((B/'release.json').read_text())
 for name,digest in release['files'].items():require(sha(B/name)==digest,'Original bundle changed: '+name)
 require(snapshot()==json.loads((scan/'before.private.json').read_text()),'QA state changed')
 require(set(n['imageLayers'])=={v['imageId'] for v in r['images'].values()},'Shipped/declared image sets differ')
 O.mkdir(mode=0o700,exist_ok=False)
 enriched={};rust_counter=collections.Counter()
 for row in u['results']:
  rust_counter[row['status']]+=1
  if not row['status'].startswith('verified'):continue
  require(sha(rust/'crates'/(row['crateSha256']+'.crate'))==row['crateSha256'],'Rust source changed')
  require(sha(rust/'crates'/(row['crateSha256']+'.registry.json'))==row['metadataSha256'],'Registry metadata changed')
  for t in row['noticeCandidates']:require(sha(rust/'texts'/t['sha256'])==t['sha256'],'Rust notice changed')
  enriched[(row['name'],row['version'])]=row
 for row in n['candidates']:require(sha(notices/'texts'/row['sha256'])==row['sha256'],'Image notice changed')
 for row in n['resolvedReferences']:require((notices/'texts'/row['sha256']).is_file(),'Resolved notice missing')
 queue=[];images={};unresolved=collections.Counter();copyleft=re.compile(r'AGPL|LGPL|GPL|MPL|CDDL|EPL|Artistic',re.I)
 for role,record in r['images'].items():
  spdx=scan/record['spdx'];raw=scan/(role+'.syft.private.json');require(sha(spdx)==record['spdxSha256'] and sha(raw)==record['syftPrivateSha256'],'Scanner evidence changed')
  d=json.loads(raw.read_text());require(d['source']['metadata']['imageID']==record['imageId'],'Scanner returned wrong image')
  stats=collections.Counter()
  for a in d['artifacts']:
   original=[x.get('spdxExpression') or x.get('value') for x in a.get('licenses',[])];original=[x for x in original if x and x not in ['UNKNOWN','NOASSERTION','NONE']]
   upstream=enriched.get((a['name'],a['version'])) if a.get('metadata',{}).get('source')=='crates.io' else None
   extra=[upstream.get('cargoDeclaredLicense'),upstream.get('declaredRegistryLicense')] if upstream else []
   effective=sorted(set(original+[x for x in extra if x]))
   status='declared-metadata-present-obligations-unreviewed' if original else ('verified-upstream-metadata-obligations-unreviewed' if effective else 'licence-metadata-unresolved')
   stats['softwareRecords']+=1;stats['missingOriginalMetadata']+=not bool(original);stats['missingMetadataAfterUpstreamEvidence']+=not bool(effective);stats['upstreamMetadataAdded']+=bool(effective) and not bool(original);stats['heuristicCopyleftReviewSignals']+=any(copyleft.search(x) for x in effective)
   if not effective:unresolved[a['foundBy']]+=1
   queue.append({'image':role,'artifactId':a['id'],'name':a['name'],'version':a['version'],'type':a['type'],'foundBy':a['foundBy'],'purl':a.get('purl'),'declaredLicenses':original,'upstreamEvidenceLicenses':sorted(set(x for x in extra if x)),'locations':[{'path':x['path'],'layerID':x.get('layerID')} for x in a.get('locations',[])],'reviewStatus':status,'legalDispositionApproved':False})
  images[role]={'imageId':record['imageId'],'spdxPackageOccurrences':record['packageOccurrences'],**dict(stats)}
 host=json.loads((scan/'host-code-inventory.json').read_text())
 for entry in host['files']:
  p=scan/'host-code'/entry['path'];require(sha(p)==entry['sha256'],'Delivered host source changed')
  if p.suffix=='.py':
   tree=ast.parse(p.read_bytes());entry['importRoots']=sorted({a.name.split('.')[0] for x in ast.walk(tree) if isinstance(x,ast.Import) for a in x.names}|{(x.module or '').split('.')[0] for x in ast.walk(tree) if isinstance(x,ast.ImportFrom)})
 totals=collections.Counter()
 for image in images.values():
  for k,v in image.items():
   if isinstance(v,int):totals[k]+=v
 summary={'schema':'stage74-verified-collection/v1','releaseSha256':RELEASE,'scope':'exact QA4 images, all shipped layers, host code; discovery and upstream evidence, not legal clearance','images':images,'totals':dict(totals),'unresolvedByCataloger':dict(unresolved),'noticeLayers':len(n['layers']),'noticeCandidates':len(n['candidates']),'uniqueImageNoticeContents':n['uniqueContents'],'resolvedImageLocalReferences':len(n['resolvedReferences']),'noticeExtractionGaps':len(n['gaps']),'noticeExtractionScopeComplete':False,'rustCoordinates':len(u['results']),'rustStatus':dict(rust_counter),'rustNonRegistryOccurrencesUnfetched':len(u['unfetchedNonRegistryRecords']),'deliveredHostCodeFiles':len(host['files']),'containersAndImagesUnchanged':True,'originalBundleUnchanged':True,'stage74Accepted':False,'legalReviewComplete':False,'requiredRemaining':['Final commercial/delivered-source terms and rightsholder authority','Resolve remaining metadata and review every applicable licence/attribution/source/build/relink obligation','Appropriate legal approval tied to exact materials','New immutable approved assembly and integrated release gate; Stage 7.5 separate']}
 for name,data in [('summary.json',summary),('review-queue.json',queue),('host-code-inventory.json',host)]: (O/name).write_text(json.dumps(data,indent=2)+'\n')
 # Export only allowlisted evidence. Private image config, owner/container state and host source copies stay local.
 selections=[*scan.glob('*.spdx.json'),scan/'receipt.json',notices/'notice-index.json',*list((notices/'texts').iterdir()),rust/'receipt.json',*list((rust/'texts').iterdir()),*O.glob('*.json')]
 secret=re.compile(rb'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bghp_[A-Za-z0-9]{30,}|\bAKIA[A-Z0-9]{16}\b|\bsk-proj-[A-Za-z0-9_-]{40,}')
 for p in selections:require(not secret.search(p.read_bytes()),'Credential-pattern review required: '+p.name)
 with tarfile.open(O/'review-evidence.tar.gz','w:gz') as t:
  for p in sorted(selections):t.add(p,arcname=str(p.relative_to(BASE)),recursive=False)
 with tarfile.open(O/'rust-sources.tar.gz','w:gz') as t:
  for p in sorted((rust/'crates').iterdir()):t.add(p,arcname='crates/'+p.name,recursive=False)
 exported={'schema':'stage74-evidence-export/v1','files':{p.name:{'sha256':sha(p),'bytes':p.stat().st_size} for p in O.glob('*.tar.gz')},'summarySha256':sha(O/'summary.json'),'credentialPatternScan':'passed for allowlisted text evidence; not a general proof of absence','stage74Accepted':False}
 (O/'export.json').write_text(json.dumps(exported,indent=2)+'\n');print(json.dumps(summary,indent=2));print(json.dumps(exported,indent=2))
if __name__=='__main__':main()

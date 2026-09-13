"""Rebind findings to the cleaned candidate; never inherit an acceptance verdict.
A matching name alone is insufficient: new declarations or unchanged, previously
inspected bytes must support metadata. Dispositions require additional notice or
primary-byte continuity. All inputs are pinned in a replayable manifest.
"""
import argparse,collections,copy,hashlib,json
from pathlib import Path
BASE=Path(__file__).resolve().parent
OUT=BASE/'clean-candidate-review'
DIMS=['identity','metadata','noticeDelivery','correspondingSource','buildInstructions','relinkMaterials']
def sha(data):return hashlib.sha256(data).hexdigest()
def dump(v):return (json.dumps(v,sort_keys=True,indent=2)+'\n').encode()
def paths(r):return {p['path'].lstrip('/') for p in r['locations']}
def evidence_pairs(value):
    if isinstance(value,dict):
        if isinstance(value.get('path'),str) and isinstance(value.get('sha256'),str):yield value['path'].lstrip('/'),value['sha256']
        for v in value.values():yield from evidence_pairs(v)
    elif isinstance(value,list):
        for v in value:yield from evidence_pairs(v)
def continuity(new,old,files):
    current=paths(new)
    return [{'path':p,'sha256':h} for p,h in sorted(set(evidence_pairs(old))) if p in current and files.get(p,{}).get('sha256')==h]
def derive():
    inputs={}
    def load(path):
        raw=(BASE/path).read_bytes();inputs[path]=sha(raw);return json.loads(raw)
    prefix='clean-candidate-review/'
    build=load(prefix+'build-receipt.json');verification=load(prefix+'build-verification.json');scan=load(prefix+'scans/receipt.json');queue=load(prefix+'scans/review-queue.json');source=load(prefix+'debian-sources/report.json');probes=load(prefix+'runtime-probes/report.json');materials=load(prefix+'materials/receipt.json');docs=load(prefix+'materials/retained-documents.json')
    if verification['buildReceiptSha256']!=inputs[prefix+'build-receipt.json'] or scan['queueSha256']!=inputs[prefix+'scans/review-queue.json']:raise ValueError('Changed build/scan')
    if source['scanReceiptSha256']!=inputs[prefix+'scans/receipt.json'] or materials['sourceReportSha256']!=inputs[prefix+'debian-sources/report.json']:raise ValueError('Changed source relation')
    if materials['retainedDocumentIndexSha256']!=inputs[prefix+'materials/retained-documents.json']:raise ValueError('Changed document inventory')
    notice=BASE/prefix/'materials/retained-notice-documents.tar'
    inputs[prefix+'materials/retained-notice-documents.tar']=sha(notice.read_bytes())
    if inputs[prefix+'materials/retained-notice-documents.tar']!=materials['archives']['retained-notice-documents.tar']['sha256']:raise ValueError('Changed notice delivery')
    import build_source_dispositions as prior_builder
    prior_files=prior_builder.derive()
    for name,data in prior_files.items():
        path='source-disposition-review/'+name
        if (BASE/path).read_bytes()!=data:raise ValueError('Prior evidence replay failed: '+name)
        inputs[path]=sha(data)
    old=load('go-origin-review/review-queue.json');prior=load('source-disposition-review/package-evidence.json')
    prior_by={(r['image'],r['artifactId']):r for r in prior};by_id={(r['image'],r['artifactId']):r for r in old};by_name=collections.defaultdict(list)
    for r in old:by_name[(r['image'],r['type'],r['name'],r['version'])].append(r)
    file_maps={}
    for role,image in build['images'].items():
        rel=prefix+role+'/transformation.json';t=load(rel)
        if inputs[rel]!=image['transformationSha256']:raise ValueError('Changed transformation')
        file_maps[role]={r['path']:r for r in t['retained']}
    archived=load(prefix+'original-byte-continuity.json');requests=load(prefix+'original-continuity-requests.json')
    if archived['requestSha256']!=inputs[prefix+'original-continuity-requests.json'] or archived['buildReceiptSha256']!=inputs[prefix+'build-receipt.json']:raise ValueError('Changed continuity inputs')
    members={(r['image'],r['layer'],r['path']):r for r in archived['members']}
    if len(members)!=len(archived['members']):raise ValueError('Duplicate continuity member')
    for r in old:
        r['archivedPrimaryEvidence']=[members[(r['image'],p['layerID'],p['path'].lstrip('/'))] for p in r['locations'] if (r['image'],p['layerID'],p['path'].lstrip('/')) in members]
    sources={}
    for r in source['results']:
        if r['status']!='exact-dsc-source-materials-collected':continue
        for p in r['occurrences']:sources[(p['image'],p['artifactId'])]={'sourcePackage':r['name'],'sourceVersion':r['version'],'dsc':r['dsc'],'materials':r['materials'],'deliveryArchiveSha256':materials['archives']['debian-source-materials.tar']['sha256'],'binarySourceEquivalenceVerified':False}
    rows=[]
    for new in queue:
        r=copy.deepcopy(new);key=(r['image'],r['artifactId']);files=file_maps[r['image']]
        if r['imageId']!=build['images'][r['image']]['imageId']:raise ValueError('Wrong candidate image')
        matches=by_name[(r['image'],r['type'],r['name'],r['version'])]
        oldrow=by_id.get(key)
        if oldrow is not None and (oldrow['type'],oldrow['name'],oldrow['version'])!=(r['type'],r['name'],r['version']):raise ValueError('Reused artifact ID')
        if oldrow is None:
            strong=[o for o in matches if continuity(r,o,files)]
            oldrow=strong[0] if len(strong)==1 else None
        proof=continuity(r,oldrow,files) if oldrow else []
        metadata=bool(r['declaredLicenses']) or bool(proof and oldrow['reviewStatus']!='licence-metadata-unresolved')
        r['engineeringChecks']={k:'unresolved' for k in DIMS};r['engineeringChecks']['identity']='verified';r['engineeringChecks']['metadata']='verified' if metadata else 'unresolved'
        r['originalByteContinuity']=proof;r['priorArtifactId']=oldrow['artifactId'] if oldrow else None;r['legalDispositionApproved']=False
        previous=prior_by.get((r['image'],oldrow['artifactId'])) if oldrow else None
        if previous and previous.get('engineeringDisposition') and metadata:
            notices=[n for n in previous['observedNoticeDocuments'] if files.get(n['path'].lstrip('/'),{}).get('sha256')==n['sha256']]
            declaration_match=bool(r['declaredLicenses']) and set(r['declaredLicenses'])==set(oldrow['declaredLicenses'])
            if proof or (declaration_match and notices):
                r['engineeringDisposition']=copy.deepcopy(previous['engineeringDisposition']);r['engineeringChecks']=copy.deepcopy(previous['engineeringChecks']);r['dispositionContinuityBasis']='unchanged-inspected-primary-bytes' if proof else 'fresh-declaration-and-identical-shipped-notice';r['priorNoticeEvidence']=previous['observedNoticeDocuments']
        if key in sources:r['debianSourceMaterials']=sources[key]
        rows.append(r)
    unresolved=[r for r in rows if any(v=='unresolved' for v in r['engineeringChecks'].values())]
    gaps=[{k:r[k] for k in ['image','artifactId','name','version','type','priorArtifactId','declaredLicenses']} for r in rows if r['engineeringChecks']['metadata']=='unresolved']
    summary={'schema':'stage74-clean-engineering/v1','candidateImages':len(build['images']),'softwareOccurrences':len(rows),'metadataUnresolved':len(gaps),'reboundTechnicalDispositions':sum(bool(r.get('engineeringDisposition')) for r in rows),'occurrencesWithUnresolvedEngineeringChecks':len(unresolved),'debianSourcePackagesCollected':len(source['results']),'debianOccurrencesWithMaterials':len(sources),'imageProbesPassed':probes['allImageProbesPassed'],'fullStackRequalified':probes['fullStackRequalified'],'originalQAUnchanged':verification['originalContainersUnchanged'] and probes['originalQAUnchanged'],'engineeringComplete':False,'stage74Accepted':False,'legalIdentityAndReview':'outside-engineering-scope','note':'Raw scanner gaps and verified metadata gaps differ. Previous image acceptance is never inherited. Source collection does not establish binary/source equality, builds or relinking.'}
    summary['engineeringComplete']=bool(rows) and not unresolved and probes['allImageProbesPassed'] and probes['fullStackRequalified'] and summary['originalQAUnchanged']
    summary['reboundNoticeArchiveSha256']=sha(prior_files['notice-evidence.tar'])
    return {'candidate-upstream-notice-evidence.tar':prior_files['notice-evidence.tar'],'candidate-package-evidence.json':dump(rows),'candidate-metadata-gaps.json':dump(gaps),'candidate-summary.json':dump(summary),'candidate-inputs.json':dump(inputs)}
def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--verify',action='store_true');p.add_argument('--require-complete',action='store_true');a=p.parse_args();files=derive()
    for n,data in files.items():
        if a.verify:
            if (OUT/n).read_bytes()!=data:raise ValueError('Changed candidate evidence: '+n)
        else:(OUT/n).write_bytes(data)
    print(files['candidate-summary.json'].decode(),end='')
    if a.require_complete and not json.loads(files['candidate-summary.json'])['engineeringComplete']:raise SystemExit(2)
if __name__=='__main__':main()

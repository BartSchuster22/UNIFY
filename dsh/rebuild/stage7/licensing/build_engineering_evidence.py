"""Deterministic per-package engineering evidence handoff and fail-closed gate.
A notice candidate is not proof of complete obligations. Upstream sources are
not automatically corresponding source. This module never creates approvals.
"""
import argparse,collections,contextlib,hashlib,io,json,posixpath,re,tarfile,zipfile
from pathlib import Path
import collect_go_origin as upstream
import collect_go_notices as go
BASE=Path(__file__).resolve().parent
OUT=BASE/'engineering-review'

def sha(b):return hashlib.sha256(b).hexdigest()
def clean(p):
    p=posixpath.normpath(p).lstrip('/')
    if p=='..' or p.startswith('../'):raise ValueError('Image path escape')
    return p

def relation(row,notice):
    p=clean(notice['path'])
    for loc in row['locations']:
        if loc['layerID']!=notice['layer']:continue
        target=clean(loc['path']);parent=posixpath.dirname(target)
        if target==p:return 'scanner-listed-exact-notice-location'
        if row['type']=='python' and parent.endswith('.dist-info') and p.startswith(parent+'/'):return 'same-distribution-directory-and-layer'
        if row['type']=='npm' and posixpath.basename(target)=='package.json' and posixpath.dirname(p)==parent:return 'same-package-root-and-layer'
        if row['type']=='java-archive' and p.startswith(target+'!/'):return 'nested-document-in-shipped-JAR-not-whole-JAR-clearance'
    return None

def bounded_mit_disposition(row, refs, texts):
    # A deliberately narrow engineering rule: it does not choose between licences,
    # infer a parent's licence, or approve a source build or distribution contract.
    if row['type'] not in {'npm','python'} or row['declaredLicenses']!=['MIT']:
        return None
    local=[r for r in refs if r['relation'] in {'same-distribution-directory-and-layer','same-package-root-and-layer'} and re.fullmatch(r'(?i)(license|licence|copying)([._-].*)?',posixpath.basename(r['path']))]
    if not local or not row.get('locations') or {l['layerID'] for l in row['locations']} - {r.get('layer') for r in local}:
        return None
    import match_go_licence_texts as matcher
    records=json.loads((BASE/'go-text-review/report.json').read_bytes())['templates']
    templates={n:(BASE/'go-text-review/objects'/r['sha256']).read_text() for n,r in records.items()}
    for r in local:
        if matcher.match(texts[r['sha256']].decode('utf-8'),templates)!='MIT':
            return None
    return {'rule':'declared-MIT-and-all-local-licence-documents-exact-MIT',
            'scope':'this inventory occurrence only; not bundled dependencies or final legal acceptance',
            'noticeDelivery':[{'sha256':r['sha256'],'bundlePath':'notices/'+r['sha256']} for r in local],
            'sourceBuildRelinkBasis':'Observed MIT text requires copyright/permission notice retention, not source/build/relink delivery',
            'legalDispositionApproved':False}


def gate(rows):
    expected={'identity','metadata','noticeDelivery','correspondingSource','buildInstructions','relinkMaterials'}
    for row in rows:
        checks=row['engineeringChecks']
        if set(checks)!=expected:raise ValueError('Changed gate dimensions')
        if any(v not in {'verified','not-required-with-evidence','unresolved'} for v in checks.values()):raise ValueError('Unsupported engineering status')
        if any(v=='not-required-with-evidence' for v in checks.values()):
            d=row.get('engineeringDisposition',{})
            if d.get('rule')!='declared-MIT-and-all-local-licence-documents-exact-MIT' or not d.get('noticeDelivery') or d.get('legalDispositionApproved') is not False:
                raise ValueError('N/A has no bounded MIT evidence')
    return bool(rows) and all(all(v in {'verified','not-required-with-evidence'} for v in r['engineeringChecks'].values()) for r in rows)

def derive():
    with contextlib.redirect_stdout(io.StringIO()):prior=upstream.derive()
    for n,b in prior.items():
        if (BASE/'go-origin-review'/n).read_bytes()!=b:raise ValueError('Changed format queue')
    queue=json.loads(prior['review-queue.json']);rows=[];texts={};sources={}
    go_sources={r['purl']:r for r in json.loads((BASE/'go-notice-review/report.json').read_bytes())['results']}
    with tarfile.open(BASE/'current-qa4/review-evidence.tar.gz') as t:
        index=json.load(t.extractfile('notices-run3/notice-index.json'));images=json.load(t.extractfile('run1/receipt.json'))['images']
        notices=index['candidates']+index['resolvedReferences'];bylayer=collections.defaultdict(list)
        for n in notices:bylayer[n['layer']].append(n)
        for row in queue:
            image=images[row['image']]['imageId'];refs=[]
            for layer in sorted({l['layerID'] for l in row['locations']}):
                if image not in index['layers'][layer]['images']:raise ValueError('Foreign image layer')
                for n in bylayer[layer]:
                    if n.get('imageId',image)!=image:continue
                    why=relation(row,n)
                    if not why:continue
                    h=n['sha256'];b=t.extractfile('notices-run3/texts/'+h).read()
                    if sha(b)!=h:raise ValueError('Changed shipped notice text')
                    texts[h]=b;refs.append({'path':n['path'],'layer':layer,'sha256':h,'relation':why,'bytes':len(b)})
            archive_refs=[]
            g=go_sources.get(row['purl'],{}) if row['type']=='go-module' else {}
            if 'archiveSha256' in g:
                h=g['archiveSha256'];p=BASE/'go-notice-review/objects'/h
                if sha(p.read_bytes())!=h:raise ValueError('Changed upstream source')
                sources[h]={'path':str(p.relative_to(BASE)),'sha256':h,'bytes':p.stat().st_size,'relation':'exact-coordinate-upstream-archive-not-proven-corresponding-source'}
                archive_refs.append(sources[h])
                module,version=go.coordinates(row['purl'])
                with zipfile.ZipFile(p) as z:
                    for n in g['notices']:
                        b=z.read(module+'@'+version+'/'+n['path'])
                        if sha(b)!=n['sha256']:raise ValueError('Changed upstream notice')
                        texts[n['sha256']]=b;refs.append({**n,'archiveSha256':h,'relation':'exact-coordinate-upstream-document-not-binary-source-equivalence'})
            if 'goOriginEvidence' in row:
                ev=row['goOriginEvidence'];r=ev['sources']['licence'];b=upstream.decode(ev['module'],(BASE/'go-origin-review/objects'/r['sha256']).read_bytes());h=sha(b)
                if h!=ev['licenceTextSha256']:raise ValueError('Changed origin licence')
                texts[h]=b;refs.append({'path':'LICENSE','sha256':h,'bytes':len(b),'originCommit':ev['originCommit'],'source':r,'relation':'proxy-origin-and-module-mod-bound-root-document-not-binary-source-equivalence'})
            for ev in row.get('distlibBinaryEvidence',[]):
                h=ev['wheelSha256'];p=BASE/'distlib-review/objects'/h
                with zipfile.ZipFile(p) as z:
                    for n in ev['licenceDocuments']:
                        b=z.read(n['path'])
                        if sha(b)!=n['sha256']:raise ValueError('Changed distlib licence')
                        texts[n['sha256']]=b;refs.append({**n,'bytes':len(b),'relation':'exact-byte-matched-upstream-distlib-wheel'})
            known=row['reviewStatus']!='licence-metadata-unresolved'
            checks={'identity':'verified','metadata':'verified' if known else 'unresolved','noticeDelivery':'unresolved','correspondingSource':'unresolved','buildInstructions':'unresolved','relinkMaterials':'unresolved'}
            disposition=bounded_mit_disposition(row,refs,texts)
            if disposition:
                checks['noticeDelivery']='verified'
                for dimension in ['correspondingSource','buildInstructions','relinkMaterials']:
                    checks[dimension]='not-required-with-evidence'
            rows.append({'image':row['image'],'imageId':image,'artifactId':row['artifactId'],'name':row['name'],'version':row['version'],'type':row['type'],'scannerPurl':row['purl'],'locations':row['locations'],'metadataStatus':row['reviewStatus'],'observedNoticeDocuments':refs,'upstreamSourceArchives':archive_refs,'engineeringChecks':checks,'engineeringDisposition':disposition,'identityScope':'authenticated-image-and-scanner-occurrence-not-binary-source-equivalence','remainingActions':{} if disposition else {'noticeDelivery':'Determine applicable documents and verify complete delivery for this package; observed candidates alone are insufficient','sourceBuildRelink':'Determine applicability and bind exact source/build/relink materials or evidence-backed non-applicability; no default exemption'},'legalDispositionApproved':False})
    manifest={h:{'sha256':h,'bytes':len(b),'path':'notices/'+h} for h,b in sorted(texts.items())}
    missing=sum(r['engineeringChecks']['metadata']=='unresolved' for r in rows)
    summary={'schema':'stage74-engineering-evidence/v1','packageOccurrences':len(rows),'metadataGaps':missing,'occurrencesWithObservedNoticeDocuments':sum(bool(r['observedNoticeDocuments']) for r in rows),'uniqueNoticeDocuments':len(texts),'upstreamSourceArchivesReferenced':len(sources),'engineeringComplete':gate(rows),'qaExecutionRequiredOrPerformed':False,'sourceCorrespondenceOrDeliveryInferred':False,'legalIdentityAndReview':'outside-this-engineering-scope','stage74Accepted':False,'productionDistributionCleared':False,'boundedMitEngineeringDispositions':sum(bool(r['engineeringDisposition']) for r in rows),'blockers':{'metadata':missing,'noticeDeliveryDispositions':sum(r['engineeringChecks']['noticeDelivery']=='unresolved' for r in rows),'sourceBuildRelinkApplicabilityAndEvidenceDispositions':sum(r['engineeringChecks']['correspondingSource']=='unresolved' for r in rows)},'interpretation':'Unresolved source/build/relink counts are unassessed dispositions, not a claim that every package requires source or relinking.'}
    files={n:(json.dumps(v,indent=2)+'\n').encode() for n,v in {'package-evidence.json':rows,'notice-manifest.json':manifest,'source-archive-references.json':sources,'summary.json':summary,'inputs.json':{'queueSha256':sha(prior['review-queue.json']),'noticeEvidenceArchiveSha256':sha((BASE/'current-qa4/review-evidence.tar.gz').read_bytes())}}.items()}
    # Review-only bundle contains real notices and a package mapping. It is not
    # a rebuilt candidate, full source distribution, or compliance certificate.
    raw=io.BytesIO()
    with tarfile.open(fileobj=raw,mode='w') as t:
        for n,b in sorted({**files,**{'notices/'+h:b for h,b in texts.items()}}.items()):
            m=tarfile.TarInfo(n);m.size=len(b);m.mode=0o644;m.mtime=0;t.addfile(m,io.BytesIO(b))
    files['notice-evidence.tar']=raw.getvalue()
    files['bundle-manifest.json']=(json.dumps({n:{'sha256':sha(b),'bytes':len(b)} for n,b in files.items()},indent=2)+'\n').encode()
    return files

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--verify',action='store_true');p.add_argument('--require-complete',action='store_true');a=p.parse_args();files=derive()
    if a.verify:
        if {p.name for p in OUT.iterdir()}!=set(files):raise ValueError('Changed artifact set')
        for n,b in files.items():
            if (OUT/n).read_bytes()!=b:raise ValueError('Changed engineering artifact: '+n)
    else:
        OUT.mkdir(exist_ok=False)
        for n,b in files.items():(OUT/n).write_bytes(b)
    report=json.loads(files['summary.json']);print(json.dumps(report,indent=2))
    if a.require_complete and not report['engineeringComplete']:raise SystemExit(2)
if __name__=='__main__':main()

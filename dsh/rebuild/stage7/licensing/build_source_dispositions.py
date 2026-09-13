"""Package-scoped source-archive notice delivery and explicit MIT-alternative selection.
Never infer OR from slash/AND/WITH syntax. No binary/source equality or legal
approval is asserted. Prior evidence remains byte-replayable and unchanged.
"""
import argparse,collections,hashlib,io,json,posixpath,re,tarfile,tomllib
from pathlib import Path
import build_engineering_evidence as prior
import match_go_licence_texts as matcher
BASE=Path(__file__).resolve().parent
OUT=BASE/'source-disposition-review'
RULE='registry-and-cargo-explicit-MIT-alternative-with-exact-source-notices'

def sha(b):return hashlib.sha256(b).hexdigest()
def encoded(v):return (json.dumps(v,indent=2)+'\n').encode()
def read(t,name):
    m=t.getmember(name)
    if not m.isfile() or m.size>32*1024*1024:raise ValueError('Missing/oversized regular archive member')
    f=t.extractfile(m)
    if f is None:raise ValueError('Missing archive bytes')
    return f.read()
def mit_alternative(expression):
    return isinstance(expression,str) and re.fullmatch(r'[A-Za-z0-9.+-]+(?: OR [A-Za-z0-9.+-]+)*',expression) is not None and 'MIT' in expression.split(' OR ')
def safe_path(path):
    return isinstance(path,str) and not path.startswith('/') and '\\' not in path and all(p not in ('','..','.') for p in path.split('/'))
def inspect_crate(raw,registry,row,templates):
    h=sha(raw)
    if h!=row['crateSha256'] or sha(registry)!=row['metadataSha256']:raise ValueError('Changed crate/registry bytes')
    r=json.loads(registry)['version'];name=row['name'];version=row['version'];prefix=name+'-'+version+'/'
    if r['crate']!=name or r['num']!=version or r['checksum']!=h:raise ValueError('Registry coordinate/checksum mismatch')
    notices=[];texts={}
    with tarfile.open(fileobj=io.BytesIO(raw),mode='r:gz') as t:
        names=[m.name for m in t.getmembers()]
        if len(names)!=len(set(names)) or any(not safe_path(n.rstrip('/')) or not n.startswith(prefix) for n in names):raise ValueError('Unsafe/ambiguous crate members')
        p=tomllib.loads(read(t,prefix+'Cargo.toml').decode())['package']
        if p['name']!=name or p['version']!=version:raise ValueError('Cargo coordinate mismatch')
        if p.get('license')!=row['cargoDeclaredLicense'] or r.get('license')!=row['declaredRegistryLicense']:raise ValueError('Changed declarations')
        for n in row['noticeCandidates']:
            if not safe_path(n['path']) or not n['path'].startswith(prefix):raise ValueError('Unsafe notice path')
            b=read(t,n['path'])
            if sha(b)!=n['sha256'] or len(b)!=n['bytes']:raise ValueError('Changed notice bytes')
            notices.append({**n,'crateSha256':h,'relation':'exact-registry-and-cargo-coordinate-upstream-source-document'})
            texts[n['sha256']]=b
        # Re-enumerate candidate names: a modified receipt cannot omit extra notices.
        wanted=set()
        for m in t.getmembers():
            if not m.isfile():continue
            if re.fullmatch(r'(?i)(licen[cs]es?|copying|copyrights?|notices?|authors)([._-].*)?',posixpath.basename(m.name)) or m.name==prefix+str(p.get('license-file','')):wanted.add(m.name)
        if wanted!={n['path'] for n in notices}:raise ValueError('Changed notice coverage')
    # A nested third-party notice or license-file requires separate scope analysis.
    # Supplying its text does not justify treating the whole crate as MIT.
    expression=p.get('license');eligible=expression==r.get('license') and mit_alternative(expression) and not p.get('license-file')
    if any('/' in n['path'][len(prefix):] for n in notices):eligible=False
    mit=[]
    for n in notices:
        if re.fullmatch(r'(?i)(license|licence|copying|copyright)([._-].*)?',posixpath.basename(n['path'])):
            observed=matcher.match(texts[n['sha256']].decode('utf-8'),templates)
            if observed=='MIT':mit.append(n['sha256'])
            # Extra root terms are not silently treated as an alternative.
            if not observed or not isinstance(expression,str) or observed not in expression.split(' OR '):eligible=False
    if not mit:eligible=False
    disposition=None
    if eligible:
        disposition={'rule':RULE,'upstreamExpression':expression,'selectedAlternative':'MIT','selectionBasis':'explicit source and registry declaration; OR is parsed literally, not inferred','crateSha256':h,'registrySha256':sha(registry),'selectedLicenceTextSha256':sorted(set(mit)),'noticeDelivery':[{'sha256':n['sha256'],'bundlePath':'notices/'+n['sha256']} for n in notices],'scope':'this registry-origin crate occurrence only; nested documents and licence-file overrides do not qualify','binarySourceEquivalenceProven':False,'legalDispositionApproved':False}
    return notices,texts,disposition

def complete(rows):
    for row in rows:
        checks=row['engineeringChecks'];d=row.get('engineeringDisposition')
        if set(checks)!={'identity','metadata','noticeDelivery','correspondingSource','buildInstructions','relinkMaterials'}:raise ValueError('Changed engineering dimensions')
        if d and d.get('rule')==RULE:
            if row.get('type')!='rust-crate' or any(checks[k]!='verified' for k in ['identity','metadata','noticeDelivery']):raise ValueError('Source rule cannot exempt identity, metadata or notice delivery')
            if any(not re.fullmatch('[a-f0-9]{64}',d.get(k,'')) for k in ['crateSha256','registrySha256']):raise ValueError('Invalid source identity evidence')
            if not mit_alternative(d.get('upstreamExpression')) or d.get('selectedAlternative')!='MIT' or not d.get('selectedLicenceTextSha256') or not d.get('noticeDelivery') or d.get('legalDispositionApproved') is not False:raise ValueError('Invalid source-scoped disposition')
        else:prior.gate([row])
        if any(v not in {'verified','unresolved','not-required-with-evidence'} for v in checks.values()):raise ValueError('Invalid status')
    return bool(rows) and all(all(v in {'verified','not-required-with-evidence'} for v in r['engineeringChecks'].values()) for r in rows)

def derive():
    baseline=prior.derive()
    for n,b in baseline.items():
        if (prior.OUT/n).read_bytes()!=b:raise ValueError('Changed prior engineering evidence')
    rows=json.loads(baseline['package-evidence.json']);bykey={(r['image'],r['artifactId']):r for r in rows}
    templates={n:(BASE/'go-text-review/objects'/r['sha256']).read_text() for n,r in json.loads((BASE/'go-text-review/report.json').read_bytes())['templates'].items()}
    texts={}
    with tarfile.open(fileobj=io.BytesIO(baseline['notice-evidence.tar'])) as t:
        for m in t.getmembers():
            if m.name.startswith('notices/'):
                b=read(t,m.name)
                if sha(b)!=m.name.split('/')[1]:raise ValueError('Changed prior notice')
                texts[sha(b)]=b
    pin=json.loads((BASE/'current-qa4/export.json').read_bytes())['files']['rust-sources.tar.gz'];raw=(BASE/'current-qa4/rust-sources.tar.gz').read_bytes()
    if len(raw)!=pin['bytes'] or sha(raw)!=pin['sha256']:raise ValueError('Changed exported sources')
    with tarfile.open(BASE/'current-qa4/review-evidence.tar.gz') as t:receipt=json.loads(read(t,'rust-upstream-run1/receipt.json'))
    sources=json.loads(baseline['source-archive-references.json']);new=0;attached=0;ledger=[];seen=set()
    with tarfile.open(fileobj=io.BytesIO(raw),mode='r:gz') as t:
        for r in receipt['results']:
            if not r['status'].startswith('verified'):continue
            h=r['crateSha256'];data=read(t,'crates/'+h+'.crate');registry=read(t,'crates/'+h+'.registry.json')
            notices,more,disposition=inspect_crate(data,registry,r,templates);texts.update(more)
            source={'path':'current-qa4/rust-sources.tar.gz','member':'crates/'+h+'.crate','sha256':h,'bytes':len(data),'relation':'exact-registry-coordinate-source-not-proven-corresponding-source'};sources[h]=source
            for occurrence in r['occurrences']:
                key=(occurrence['image'],occurrence['artifactId'])
                if key in seen:raise ValueError('Duplicate occurrence binding')
                seen.add(key)
                if key not in bykey or occurrence['source']!='crates.io':raise ValueError('Unknown/nonregistry occurrence')
                row=bykey[key]
                if row['name']!=r['name'] or row['version']!=r['version'] or row['type']!='rust-crate':raise ValueError('Source/occurrence identity mismatch')
                row['observedNoticeDocuments'].extend(notices);row['upstreamSourceArchives'].append(source);attached+=1
                if disposition:
                    if row['engineeringDisposition'] is not None or row['engineeringChecks']['metadata']!='verified':raise ValueError('Conflicting or unresolved source disposition')
                    row['engineeringDisposition']=disposition;row['engineeringChecks']['noticeDelivery']='verified'
                    for k in ['correspondingSource','buildInstructions','relinkMaterials']:row['engineeringChecks'][k]='not-required-with-evidence'
                    row['remainingActions']={};new+=1
            ledger.append({'name':r['name'],'version':r['version'],'crateSha256':h,'occurrenceCount':len(r['occurrences']),'noticeDocuments':len(notices),'explicitMitAlternativeSelected':disposition is not None,'binarySourceEquivalenceProven':False})
    total=sum(r.get('engineeringDisposition') is not None for r in rows)
    summary={**json.loads(baseline['summary.json']),'schema':'stage74-source-dispositions/v1','newSourceNoticeOccurrences':attached,'newExplicitMitSourceDispositions':new,'totalBoundedEngineeringDispositions':total,'occurrencesWithObservedNoticeDocuments':sum(bool(r['observedNoticeDocuments']) for r in rows),'uniqueNoticeDocuments':len(texts),'upstreamSourceArchivesReferenced':len(sources),'engineeringComplete':complete(rows),'blockers':{'metadata':sum(r['engineeringChecks']['metadata']=='unresolved' for r in rows),'noticeDeliveryDispositions':sum(r['engineeringChecks']['noticeDelivery']=='unresolved' for r in rows),'sourceBuildRelinkApplicabilityAndEvidenceDispositions':sum(r['engineeringChecks']['correspondingSource']=='unresolved' for r in rows)}}
    manifest={h:{'sha256':h,'bytes':len(b),'path':'notices/'+h} for h,b in sorted(texts.items())}
    files={n:encoded(v) for n,v in {'package-evidence.json':rows,'notice-manifest.json':manifest,'source-archive-references.json':sources,'summary.json':summary,'crate-ledger.json':ledger,'inputs.json':{'priorPackageEvidenceSha256':sha(baseline['package-evidence.json']),'rustSourcesArchiveSha256':pin['sha256'],'reviewEvidenceArchiveSha256':sha((BASE/'current-qa4/review-evidence.tar.gz').read_bytes())}}.items()}
    stream=io.BytesIO()
    with tarfile.open(fileobj=stream,mode='w',format=tarfile.USTAR_FORMAT) as t:
        for n,b in sorted({**files,**{'notices/'+h:b for h,b in texts.items()}}.items()):
            m=tarfile.TarInfo(n);m.size=len(b);m.mode=0o644;m.mtime=0;t.addfile(m,io.BytesIO(b))
    files['notice-evidence.tar']=stream.getvalue();files['bundle-manifest.json']=encoded({n:{'sha256':sha(b),'bytes':len(b)} for n,b in files.items()})
    return files

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--verify',action='store_true');p.add_argument('--require-complete',action='store_true');a=p.parse_args();files=derive()
    if not a.verify:OUT.mkdir(exist_ok=False)
    for n,b in files.items():
        if a.verify:
            if (OUT/n).read_bytes()!=b:raise ValueError('Changed source disposition artifact: '+n)
        else:(OUT/n).write_bytes(b)
    summary=json.loads(files['summary.json']);print(files['summary.json'].decode())
    if a.require_complete and not summary['engineeringComplete']:raise SystemExit(2)
if __name__=='__main__':main()

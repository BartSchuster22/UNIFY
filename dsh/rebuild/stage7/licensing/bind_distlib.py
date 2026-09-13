"""Exact shipped vendored distlib launcher / upstream wheel equality.
Neither pip's MIT licence nor a filename is substituted for distlib's own evidence.
"""
import argparse,collections,csv,hashlib,io,json,re,tarfile,urllib.parse,urllib.request,zipfile
from pathlib import Path
import bind_package_context as context
BASE=Path(__file__).resolve().parent
OUT=BASE/'distlib-review'
META='https://pypi.org/pypi/distlib/0.3.9/json'

def fetch(url):
    u=urllib.parse.urlsplit(url)
    if u.scheme!='https' or u.hostname not in {'pypi.org','files.pythonhosted.org'} or u.username or u.password or u.port not in (None,443):raise ValueError('Unsafe PyPI source')
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self,*a,**k):raise ValueError('Unexpected redirect')
    with urllib.request.build_opener(NoRedirect()).open(url,timeout=30) as f:b=f.read(8*1024*1024+1)
    if len(b)>8*1024*1024:raise ValueError('Object exceeds bound')
    return b

def wheel_manifest(meta):
    if meta['info']['name']!='distlib' or meta['info']['version']!='0.3.9' or meta['info']['license']!='PSF-2.0':raise ValueError('Changed package identity/declaration')
    rows=[r for r in meta['urls'] if r['filename']=='distlib-0.3.9-py2.py3-none-any.whl']
    if len(rows)!=1:raise ValueError('Ambiguous wheel')
    return rows[0]

def derive():
    prior=context.derive()
    for n,b in prior.items():
        if (BASE/'package-context-review'/n).read_bytes()!=b:raise ValueError('Changed context derivation')
    records=json.loads((OUT/'sources.json').read_bytes());objects={}
    if set(records)!={'metadata','wheel'} or records['metadata']['url']!=META:raise ValueError('Unexpected sources')
    for name,r in records.items():
        if not re.fullmatch('[a-f0-9]{64}',r['sha256']):raise ValueError('Unsafe digest')
        b=(OUT/'objects'/r['sha256']).read_bytes()
        if context.sha(b)!=r['sha256'] or len(b)!=r['bytes']:raise ValueError('Changed object')
        objects[name]=b
    if {p.name for p in (OUT/'objects').iterdir()}!={r['sha256'] for r in records.values()}:raise ValueError('Unexpected objects')
    wh=wheel_manifest(json.loads(objects['metadata']))
    if wh['url']!=records['wheel']['url'] or wh['digests']['sha256']!=context.sha(objects['wheel']) or wh['size']!=len(objects['wheel']):raise ValueError('Wheel registry digest mismatch')
    q=json.loads(prior['review-queue.json']);c=json.loads((BASE/'package-context-review/context.json').read_bytes());orig=json.loads((BASE/'original-review/inspection.json').read_bytes());idx=context.validate_context(c,orig)
    with tarfile.open(BASE/'current-qa4/review-evidence.tar.gz') as t:images=json.load(t.extractfile('run1/receipt.json'))['images']
    added=0
    with zipfile.ZipFile(io.BytesIO(objects['wheel'])) as z:
        names=z.namelist()
        if len(names)!=len(set(names)) or any('..' in n.split('/') or n.startswith('/') for n in names):raise ValueError('Unsafe wheel')
        licences=[n for n in names if n.lower().endswith('/license.txt')]
        if not licences:raise ValueError('No upstream licence document')
        for row in q:
            if row['type']!='binary' or row['reviewStatus']!='licence-metadata-unresolved':continue
            refs=[];image=images[row['image']]['imageId']
            for loc in row['locations']:
                p=context.norm(loc['path']);m=re.fullmatch(r'(.+)/pip/_vendor/distlib/([tw](?:32|64|64-arm)\.exe)',p)
                if not m:refs=[];break
                root,leaf=m.groups();at=c['images'][image].index(loc['layerID']);binary=context.resolve(c,idx,image,p,at);vendor=context.resolve(c,idx,image,root+'/pip/_vendor/vendor.txt',at);record=context.resolve(c,idx,image,root+'/pip-25.0.1.dist-info/RECORD',at)
                if not binary or not vendor or not record or 'distlib==0.3.9' not in vendor['text'].splitlines() or not context.record_contains(record['text'],'pip/_vendor/distlib/'+leaf,binary):refs=[];break
                b=z.read('distlib/'+leaf)
                if context.sha(b)!=binary['sha256'] or len(b)!=binary['bytes']:refs=[];break
                refs.append({'binary':context.ref(binary),'vendorManifest':context.ref(vendor),'pipRecord':context.ref(record),'wheelMember':'distlib/'+leaf,'wheelSha256':context.sha(objects['wheel']),'declaredLicence':'PSF-2.0','licenceDocuments':[{'path':n,'sha256':context.sha(z.read(n))} for n in licences],'relation':'pip-RECORD-and-exact-upstream-distlib-launcher-bytes','legalDispositionApproved':False})
            if refs:
                row['distlibBinaryEvidence']=refs;row['reviewStatus']='byte-matched-distlib-licence-metadata-observed-obligations-unreviewed';added+=1
    remaining={(r['image'],r['artifactId']) for r in q if r['reviewStatus']=='licence-metadata-unresolved'}
    gaps=[r for r in json.loads(prior['gaps.json']) if (r['image'],r['artifactId']) in remaining]
    summary=json.loads(prior['summary.json']);summary.update(schema='stage74-distlib-review/v1',newByteMatchedLauncherOccurrences=added,remainingMissingMetadata=len(gaps),remainingByType=dict(sorted(collections.Counter(r['type'] for r in gaps).items())))
    return {n:(json.dumps(v,indent=2)+'\n').encode() for n,v in {'review-queue.json':q,'gaps.json':gaps,'summary.json':summary,'inputs.json':{'queueSha256':context.sha(prior['review-queue.json']),'sourcesSha256':context.sha((OUT/'sources.json').read_bytes())}}.items()}

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--verify',action='store_true');a=p.parse_args()
    if not a.verify:
        OUT.mkdir(exist_ok=False);(OUT/'objects').mkdir();mb=fetch(META);w=wheel_manifest(json.loads(mb));wb=fetch(w['url']);sources={}
        for n,url,b in [('metadata',META,mb),('wheel',w['url'],wb)]:
            h=context.sha(b);(OUT/'objects'/h).write_bytes(b);sources[n]={'url':url,'sha256':h,'bytes':len(b)}
        (OUT/'sources.json').write_text(json.dumps(sources,indent=2)+'\n')
    files=derive()
    for n,b in files.items():
        if a.verify:
            if (OUT/n).read_bytes()!=b:raise ValueError('Changed distlib result: '+n)
        else:(OUT/n).write_bytes(b)
    print(files['summary.json'].decode())
if __name__=='__main__':main()

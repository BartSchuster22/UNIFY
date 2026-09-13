"""Bounded Go origin-commit licence retrieval when complete ZIPs exceed the cap.
Uses proxy .info Origin plus exact commit go.mod equality, not guessed tags.
No ZIP cap is relaxed and no source/binary equivalence is asserted.
"""
import argparse,base64,collections,json,re,urllib.parse,urllib.request
from pathlib import Path
import match_document_formats as prior
BASE=Path(__file__).resolve().parent
OUT=BASE/'go-origin-review'
TARGETS={'golang.org/x/text':('v0.27.0','https://go.googlesource.com/text'),'google.golang.org/api':('v0.240.0','https://github.com/googleapis/google-api-go-client')}

def fetch(url):
    u=urllib.parse.urlsplit(url)
    if u.scheme!='https' or u.hostname not in {'proxy.golang.org','go.googlesource.com','raw.githubusercontent.com'} or u.username or u.password or u.port not in (None,443):raise ValueError('Unsafe origin source')
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self,*a,**k):raise ValueError('Unexpected redirect')
    with urllib.request.build_opener(NoRedirect()).open(url,timeout=30) as f:b=f.read(2*1024*1024+1)
    if len(b)>2*1024*1024:raise ValueError('Bounded object exceeded')
    return b

def origin(info,module):
    v,url=TARGETS[module];o=info['Origin']
    if info['Version']!=v or o['VCS']!='git' or o['URL']!=url or o['Ref']!='refs/tags/'+v or not re.fullmatch('[a-f0-9]{40}',o['Hash']):raise ValueError('Changed proxy origin binding')
    return o['Hash']

def source_url(module,commit,path):
    root=TARGETS[module][1]
    return root+'/+/'+commit+'/'+path+'?format=TEXT' if 'googlesource.com' in root else root.replace('https://github.com/','https://raw.githubusercontent.com/')+'/'+commit+'/'+path

def decode(module,b):return base64.b64decode(b,validate=True) if 'googlesource.com' in TARGETS[module][1] else b

def collect():
    queue=json.loads((BASE/'format-review/review-queue.json').read_bytes())
    for module,(version,_) in TARGETS.items():
        if not any(r['type']=='go-module' and r['name']==module and r['version']==version and r['reviewStatus']=='licence-metadata-unresolved' for r in queue):
            raise ValueError('Target is not an exact unresolved shipped module coordinate')
    OUT.mkdir(exist_ok=False);(OUT/'objects').mkdir();records={}
    for module,(version,url) in TARGETS.items():
        sources={}
        def get(name,url):
            b=fetch(url);h=prior.prior.context.sha(b);(OUT/'objects'/h).write_bytes(b);sources[name]={'url':url,'sha256':h,'bytes':len(b)};return b
        info=json.loads(get('info','https://proxy.golang.org/'+module+'/@v/'+version+'.info'));commit=origin(info,module)
        get('proxyMod','https://proxy.golang.org/'+module+'/@v/'+version+'.mod')
        for name,path in [('originMod','go.mod'),('licence','LICENSE')]:get(name,source_url(module,commit,path))
        records[module]=sources
    (OUT/'sources.json').write_text(json.dumps(records,indent=2)+'\n')

def derive():
    previous=prior.derive()
    for n,b in previous.items():
        if (BASE/'format-review'/n).read_bytes()!=b:raise ValueError('Changed format review')
    records=json.loads((OUT/'sources.json').read_bytes())
    if set(records)!=set(TARGETS):raise ValueError('Changed targets')
    digestset={r['sha256'] for m in records.values() for r in m.values()}
    if {p.name for p in (OUT/'objects').iterdir()}!=digestset:raise ValueError('Changed origin object set')
    templates={}
    for directory,filename,key in [('go-text-review','report.json','templates'),('original-bsd-review','templates.json',None)]:
        rr=json.loads((BASE/directory/filename).read_bytes());rr=rr[key] if key else rr
        for n,r in rr.items():templates[n]=(BASE/directory/'objects'/r['sha256']).read_text()
    bound={}
    for module,sources in records.items():
        if set(sources)!={'info','proxyMod','originMod','licence'}:raise ValueError('Changed source set')
        objects={}
        for n,r in sources.items():
            if not re.fullmatch('[a-f0-9]{64}',r['sha256']):raise ValueError('Unsafe object digest')
            b=(OUT/'objects'/r['sha256']).read_bytes()
            if prior.prior.context.sha(b)!=r['sha256'] or len(b)!=r['bytes']:raise ValueError('Changed origin bytes')
            objects[n]=b
        commit=origin(json.loads(objects['info']),module);version=TARGETS[module][0]
        urls={'info':'https://proxy.golang.org/'+module+'/@v/'+version+'.info','proxyMod':'https://proxy.golang.org/'+module+'/@v/'+version+'.mod','originMod':source_url(module,commit,'go.mod'),'licence':source_url(module,commit,'LICENSE')}
        if any(sources[n]['url']!=u for n,u in urls.items()):raise ValueError('Changed source URL')
        if decode(module,objects['originMod'])!=objects['proxyMod'] or not re.search(r'(?m)^module '+re.escape(module)+r'\s*$',objects['proxyMod'].decode()):raise ValueError('Commit go.mod differs from exact module version')
        text=decode(module,objects['licence']);observed=prior.observe(text.decode(),templates)
        if not observed:raise ValueError('Unrecognised root licence document')
        bound['pkg:golang/'+module+'@'+version]={'originCommit':commit,'module':module,'sources':sources,'licenceTextSha256':prior.prior.context.sha(text),'observedTextId':observed,'moduleOriginModByteEquality':True,'binaryIdentityProven':False,'legalDispositionApproved':False}
    queue=json.loads(previous['review-queue.json']);added=0
    for r in queue:
        if r['type']=='go-module' and r['reviewStatus']=='licence-metadata-unresolved' and r['purl'] in bound:
            r['goOriginEvidence']=bound[r['purl']];r['reviewStatus']='origin-commit-and-module-mod-byte-bound-licence-metadata-observed-obligations-unreviewed';added+=1
    remaining={(r['image'],r['artifactId']) for r in queue if r['reviewStatus']=='licence-metadata-unresolved'};gaps=[r for r in json.loads(previous['gaps.json']) if (r['image'],r['artifactId']) in remaining];summary=json.loads(previous['summary.json']);summary.update(schema='stage74-go-origin-review/v1',newOriginBoundMetadataOccurrences=added,remainingMissingMetadata=len(gaps),remainingByType=dict(sorted(collections.Counter(r['type'] for r in gaps).items())))
    return {n:(json.dumps(v,indent=2)+'\n').encode() for n,v in {'review-queue.json':queue,'gaps.json':gaps,'summary.json':summary,'inputs.json':{'queueSha256':prior.prior.context.sha(previous['review-queue.json']),'sourcesSha256':prior.prior.context.sha((OUT/'sources.json').read_bytes())}}.items()}

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--verify',action='store_true');a=p.parse_args()
    if not a.verify:collect()
    files=derive()
    for n,b in files.items():
        if a.verify:
            if (OUT/n).read_bytes()!=b:raise ValueError('Changed origin evidence: '+n)
        else:(OUT/n).write_bytes(b)
    print(files['summary.json'].decode())
if __name__=='__main__':main()

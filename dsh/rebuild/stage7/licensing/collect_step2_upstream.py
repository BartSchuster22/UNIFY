"""Bounded upstream metadata acquisition for the frozen 34-record review.
Downloads are data only. Full runtime archives stay in a local private cache.
"""
import base64,hashlib,io,json,tarfile,time,urllib.request,zipfile
from pathlib import Path
BASE=Path(__file__).resolve().parent;OUT=BASE/'clean-candidate-review/steps12-upstream';CACHE=Path.home()/'.cache/stage74-step2-downloads'
def digest(data):return hashlib.sha256(data).hexdigest()
def member_bytes(t,name):
    f=t.extractfile(name)
    if f is None:raise ValueError('Missing archive member')
    return f.read()
def save(data):
    h=digest(data);p=OUT/'objects'/h
    if not p.exists():p.write_bytes(data)
    elif p.read_bytes()!=data:raise ValueError('Object changed')
    return {'sha256':h,'bytes':len(data)}
def fetch(url,small=True):
    data=b''
    key=CACHE/digest(url.encode())
    if key.exists():data=key.read_bytes()
    else:
        for attempt in range(3):
            try:
                with urllib.request.urlopen(urllib.request.Request(url,headers={'User-Agent':'Stage74-evidence-collector'}),timeout=90) as r:data=r.read(160*1024*1024+1)
                if len(data)>160*1024*1024:raise ValueError('Oversized response')
                key.write_bytes(data);break
            except Exception:
                if attempt==2:raise
                time.sleep(2)
    ref={'url':url,'sha256':digest(data),'bytes':len(data)}
    if small:save(data)
    return data,ref

def main():
    OUT.mkdir(exist_ok=True);(OUT/'objects').mkdir(exist_ok=True);CACHE.mkdir(parents=True,exist_ok=True,mode=0o700);report={}
    # Official Node tarball checksums and executable byte matches, not name-only associations.
    for v,roles in [('22.22.2',['hermes']),('22.23.2',['unify-core','uniui'])]:
        root='node-v'+v+'-linux-x64';url='https://nodejs.org/dist/v'+v+'/';s,sr=fetch(url+'SHASUMS256.txt');checks={line.split()[1]:line.split()[0] for line in s.decode().splitlines()};raw,rr=fetch(url+root+'.tar.xz',False)
        if digest(raw)!=checks[root+'.tar.xz']:raise ValueError('Node vendor checksum mismatch')
        with tarfile.open(fileobj=io.BytesIO(raw)) as t:
            binary=member_bytes(t,root+'/bin/node');licence=member_bytes(t,root+'/LICENSE')
        matches=[]
        for role in roles:
            path='usr/local/bin/node' if role=='hermes' else 'nodejs/bin/node';tr=json.loads((BASE/'clean-candidate-review'/role/'transformation.json').read_bytes());expected=next(x['sha256'] for x in tr['retained'] if x['path']==path)
            if digest(binary)!=expected:raise ValueError('Node binary differs from official runtime: '+role)
            matches.append({'image':role,'path':path,'sha256':expected})
        report['node-'+v]={'checksumManifest':sr,'runtimeArchive':rr,'binaryMatches':matches,'completeLicenceBundle':save(licence),'signaturesVerified':False};print('Node verified',v,flush=True)
    raw,ref=fetch('https://proxy.golang.org/github.com/klauspost/compress/@v/v1.18.0.zip',False)
    with zipfile.ZipFile(io.BytesIO(raw)) as z:
        h=hashlib.sha256()
        for n in sorted(z.namelist()):
            if n.endswith('/'):continue
            h.update((digest(z.read(n))+'  '+n+'\n').encode())
        checksum='h1:'+base64.b64encode(h.digest()).decode()
        if checksum!='h1:c/Cqfb0r+Yi+JtIEq73FWXVkRonBlf0CRNYc8Zttxdo=':raise ValueError('Go compiler module checksum mismatch')
        docs=[{'path':n.split('@v1.18.0/',1)[1],**save(z.read(n))} for n in z.namelist() if n.rsplit('/',1)[-1].upper().startswith(('LICENSE','COPYING','NOTICE')) and not n.endswith('/')]
    report['compress']={'archive':ref,'compilerModuleChecksum':checksum,'documents':docs}
    raw,ref=fetch('https://pypi.org/pypi/hindsight-client/0.6.1/json');meta=json.loads(raw);arts=[]
    for entry in meta['urls']:
        data,ar=fetch(entry['url'],False)
        if digest(data)!=entry['digests']['sha256']:raise ValueError('PyPI archive hash mismatch')
        if entry['packagetype']=='bdist_wheel':
            with zipfile.ZipFile(io.BytesIO(data)) as z:
                members={n:save(z.read(n)) for n in z.namelist() if n.endswith(('/METADATA','/__init__.py')) or 'LICENSE' in n.upper()}
        else:
            with tarfile.open(fileobj=io.BytesIO(data)) as t:
                members={m.name:save(member_bytes(t,m)) for m in t.getmembers() if m.isfile() and (m.name.endswith(('pyproject.toml','PKG-INFO')) or 'LICENSE' in m.name.upper())}
        arts.append({'archive':ar,'members':members})
    tag,tref=fetch('https://api.github.com/repos/vectorize-io/hindsight/git/ref/tags/v0.6.1');obj=json.loads(tag)['object'];tagrefs=[tref]
    while obj['type']=='tag':
        data,ref=fetch(obj['url']);tagrefs.append(ref);obj=json.loads(data)['object']
    commit=obj['sha'];tree,tr=fetch('https://api.github.com/repos/vectorize-io/hindsight/git/trees/'+commit+'?recursive=1');tree=json.loads(tree)
    if tree.get('truncated'):raise ValueError('Truncated source tree')
    paths=[x['path'] for x in tree['tree'] if x['type']=='blob' and (x['path'].upper() in ['LICENSE','LICENSE.MD','LICENSE.TXT'] or x['path'].endswith('hindsight_client/__init__.py') or ('clients/python' in x['path'] and (x['path'].endswith('pyproject.toml') or 'LICENSE' in x['path'].upper())))]
    docs=[]
    for path in paths:
        data,ref=fetch('https://raw.githubusercontent.com/vectorize-io/hindsight/'+commit+'/'+path);docs.append({'path':path,'source':ref})
    tree_by={x['path']:x for x in tree['tree'] if x['type']=='blob'}
    wheel=next(a for a in arts if a['archive']['url'].endswith('.whl'));raw_wheel,_=fetch(wheel['archive']['url'],False)
    retained={x['path']:x for x in json.loads((BASE/'clean-candidate-review/hermes/transformation.json').read_bytes())['retained']};payload=[]
    with zipfile.ZipFile(io.BytesIO(raw_wheel)) as z:
        for n in z.namelist():
            if n.endswith('/') or not n.startswith(('hindsight_client/','hindsight_client_api/')):continue
            data=z.read(n);installed='opt/hermes/.venv/lib/python3.13/site-packages/'+n;source_path='hindsight-clients/python/'+n;gitsha=hashlib.sha1(b'blob '+str(len(data)).encode()+b'\0'+data).hexdigest()
            if retained.get(installed,{}).get('sha256')!=digest(data):raise ValueError('Hindsight installed payload differs: '+n)
            if tree_by.get(source_path,{}).get('sha')!=gitsha:raise ValueError('Hindsight release source differs: '+n)
            payload.append({'installedPath':installed,'sourcePath':source_path,'sha256':digest(data),'gitBlobSha1':gitsha})
    report['hindsight']={'registry':{'url':'https://pypi.org/pypi/hindsight-client/0.6.1/json','sha256':digest(raw)},'artifacts':arts,'tagReferences':tagrefs,'commit':commit,'tree':tr,'sourceDocuments':docs,'completeClientPayloadMatches':payload}
    for name,url in [('postgresql','https://raw.githubusercontent.com/postgres/postgres/REL_16_6/COPYRIGHT'),('gosu','https://raw.githubusercontent.com/tianon/gosu/1.17/LICENSE'),('caddy','https://raw.githubusercontent.com/caddyserver/caddy/v2.10.2/LICENSE')]:
        data,ref=fetch(url);report[name]={'licence':ref}
    # Authenticate gosu's version with exact release binary bytes as well as its image environment.
    data,ref=fetch('https://github.com/tianon/gosu/releases/download/1.17/gosu-amd64',False)
    tr=json.loads((BASE/'clean-candidate-review/postgresql/transformation.json').read_bytes());expected=next(r['sha256'] for r in tr['retained'] if r['path']=='usr/local/bin/gosu')
    if digest(data)!=expected:raise ValueError('gosu release binary differs')
    report['gosu']['binaryMatch']={**ref,'path':'usr/local/bin/gosu'}
    (OUT/'report.json').write_text(json.dumps(report,sort_keys=True,indent=2)+'\n');print(json.dumps({'upstreamRecords':list(report),'completed':True}))
if __name__=='__main__':main()
